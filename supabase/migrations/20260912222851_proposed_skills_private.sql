-- proposed_skills.reasons and .idea_ids are derived from other users' private
-- ideas (see extraction/src/resolve.js record()). With a blanket select policy,
-- any signed-in user could read them. The registry is reviewed by the owner
-- through the dashboard or the service role, so clients need no access at all.
-- RLS stays enabled with no policies: authenticated and anon read zero rows.

drop policy "proposed_skills: readable" on proposed_skills;

-- belt and braces: no table privileges for client roles either
revoke all on proposed_skills from anon, authenticated;
