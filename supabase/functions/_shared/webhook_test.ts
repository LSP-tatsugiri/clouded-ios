import { assertEquals } from "jsr:@std/assert@1";
import { ideaToRun } from "./webhook.ts";

const id = "11111111-1111-1111-1111-111111111111";

Deno.test("insert on ideas runs", () => {
  assertEquals(ideaToRun({ type: "INSERT", table: "ideas", record: { id } }), id);
});

Deno.test("manual invocation runs", () => {
  assertEquals(ideaToRun({ idea_id: id }), id);
});

Deno.test("update with a changed clarification re-runs", () => {
  assertEquals(ideaToRun({ type: "UPDATE", table: "ideas", record: { id, clarification: "a knob" }, old_record: { clarification: null } }), id);
  assertEquals(ideaToRun({ type: "UPDATE", table: "ideas", record: { id, clarification: "b" }, old_record: { clarification: "a" } }), id);
});

Deno.test("the function's own status update does not loop", () => {
  assertEquals(ideaToRun({ type: "UPDATE", table: "ideas", record: { id, clarification: null }, old_record: { clarification: null } }), null);
  assertEquals(ideaToRun({ type: "UPDATE", table: "ideas", record: { id, clarification: "same" }, old_record: { clarification: "same" } }), null);
});

Deno.test("other tables, deletes and junk are ignored", () => {
  assertEquals(ideaToRun({ type: "INSERT", table: "skills", record: { id } }), null);
  assertEquals(ideaToRun({ type: "DELETE", table: "ideas", record: { id } }), null);
  assertEquals(ideaToRun({}), null);
});
