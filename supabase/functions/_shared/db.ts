// All database access for the extract function. Runs as the service role,
// which bypasses RLS. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
// into every edge function by the platform.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Skill } from "./prompt.ts";
import type { CapabilityRow, Registry, RegistryEntry } from "./resolve.ts";

export type Idea = {
  id: string;
  user_id: string;
  raw: string;
  clarification: string | null;
  status: string;
};

export class Db {
  private c: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.c = client ?? createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
  }

  private ok<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  }

  async getIdea(id: string): Promise<Idea> {
    return this.ok(await this.c.from("ideas").select("id, user_id, raw, clarification, status").eq("id", id).single(), "getIdea");
  }

  async loadSkills(): Promise<Skill[]> {
    return this.ok(await this.c.from("skills").select("id, name, domain, aliases, hazard, sort_order").order("sort_order"), "loadSkills");
  }

  async loadRegistry(): Promise<Registry> {
    const rows = this.ok<RegistryEntry[]>(await this.c.from("proposed_skills").select("key, names, reasons, idea_ids, run_count, crux_count, rejected, promoted"), "loadRegistry");
    return new Map(rows.map((r) => [r.key, r]));
  }

  // Upserts only the entries this run touched. rejected/promoted are set by a
  // human and are never written from here.
  async saveRegistry(reg: Registry): Promise<number> {
    const rows = [...reg.values()].filter((e) => e.dirty).map((e) => ({
      key: e.key, names: e.names, reasons: e.reasons, idea_ids: e.idea_ids,
      run_count: e.run_count, crux_count: e.crux_count, updated_at: new Date().toISOString()
    }));
    if (rows.length) this.ok(await this.c.from("proposed_skills").upsert(rows, { onConflict: "key" }), "saveRegistry");
    return rows.length;
  }

  // Every extraction ever, raw. Written before resolution so nothing is lost.
  // output is the tool input as returned plus a `_meta` key (stop_reason,
  // token usage); on a bad run both output (partial) and error are set.
  async writeRun(run: { idea_id: string; model: string; prompt_hash: string; output?: Record<string, unknown> | null; error?: string }): Promise<string> {
    const row = this.ok<{ id: string }>(
      await this.c.from("extraction_runs").insert({
        idea_id: run.idea_id, model: run.model, prompt_hash: run.prompt_hash,
        output: run.output ?? null, error: run.error ?? null
      }).select("id").single(),
      "writeRun"
    );
    return row.id;
  }

  // Current capabilities are always from the latest run: replace, don't merge.
  async writeCapabilities(ideaId: string, rows: CapabilityRow[]): Promise<void> {
    this.ok(await this.c.from("idea_capabilities").delete().eq("idea_id", ideaId), "clearCapabilities");
    if (rows.length) this.ok(await this.c.from("idea_capabilities").insert(rows), "writeCapabilities");
  }

  async markIdea(id: string, fields: Partial<{
    objective: string | null; domain: string | null; is_clear: boolean;
    clarifying_question: string | null; status: "pending" | "extracted" | "failed";
  }>): Promise<void> {
    this.ok(await this.c.from("ideas").update(fields).eq("id", id), "markIdea");
  }
}
