// The phone list's state: own ideas newest-first, the crux of each, and the
// owner's skill levels for its mark. Polls while any row is pending and stops
// when none is (docs/step-6-plan.md decision 12). No Realtime.

import Foundation
import Supabase

@MainActor @Observable
final class IdeasModel {
    var ideas: [Idea] = []
    var capsByIdea: [UUID: [Capability]] = [:]
    var skillNames: [String: String] = [:]
    var held: [String: String] = [:]           // skill_id -> none | some | solid
    var progress: [UUID: String] = [:]         // rows whose answer is re-running, with a status line
    var error: String?
    var loaded = false

    private let userId: UUID
    private var poller: Task<Void, Never>?

    init(userId: UUID) { self.userId = userId }

    func crux(of idea: Idea) -> (name: String, status: CruxStatus)? {
        guard let cap = cruxOf(capsByIdea[idea.id] ?? []) else { return nil }
        let name = cap.skillId.flatMap { skillNames[$0] } ?? "\(cap.proposedKey ?? "?") (proposed)"
        return (name, classify(cap, held: held))
    }

    func load() async {
        do {
            // RLS would also return ideas shared to a group; the filter is the
            // product's split (own on the phone), the same as web/lib/db.js ideas()
            let ideas: [Idea] = try await supabase.from("ideas").select(Idea.columns)
                .eq("user_id", value: userId).order("created_at", ascending: false).execute().value
            let caps: [Capability] = try await supabase.from("idea_capabilities").select(Capability.columns)
                .in("idea_id", values: ideas.map(\.id)).execute().value
            let skills: [Skill] = try await supabase.from("skills").select("id, name").execute().value
            let levels: [UserSkill] = try await supabase.from("user_skills").select("skill_id, level")
                .eq("user_id", value: userId).execute().value
            self.ideas = ideas
            capsByIdea = Dictionary(grouping: caps, by: \.ideaId)
            skillNames = Dictionary(uniqueKeysWithValues: skills.map { ($0.id, $0.name) })
            held = Dictionary(uniqueKeysWithValues: levels.map { ($0.skillId, $0.level) })
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loaded = true
        pollWhilePending()
    }

    func stopPolling() {
        poller?.cancel()
        poller = nil
    }

    private func pollWhilePending() {
        guard poller == nil, ideas.contains(where: \.isPending) else { return }
        poller = Task {
            while !Task.isCancelled, ideas.contains(where: \.isPending) {
                try? await Task.sleep(for: .seconds(3))
                if Task.isCancelled { break }
                await load()   // re-enters pollWhilePending, which sees poller set and returns
            }
            poller = nil
        }
    }

    // Decision 13: one field writing `clarification`, which re-runs extraction
    // as on the web. One API call, about a cent.
    func answer(_ idea: Idea, _ text: String) async {
        let since = Date()
        progress[idea.id] = "saving your answer…"
        do {
            try await supabase.from("ideas").update(["clarification": text]).eq("id", value: idea.id).execute()
            let run = try await awaitRerun(idea.id, since: since) { progress[idea.id] = $0 }
            if run == nil { error = "The re-run has not landed yet. Pull to refresh in a moment." }
            else if let failure = run?.error { error = "Extraction failed: \(failure)" }
        } catch {
            self.error = error.localizedDescription
        }
        progress[idea.id] = nil
        await load()
    }

    // web/app.js awaitRerun, in Swift. The webhook does not reset status, so a
    // new extraction_runs row after `since` is the only sign the answer was
    // processed; then wait for the idea row to agree with the run's verdict,
    // because the run lands a moment before the columns are written.
    private func awaitRerun(_ ideaId: UUID, since: Date, onProgress: (String) -> Void) async throws -> ExtractionRun? {
        var run: ExtractionRun?
        var ticks = 0
        while run == nil && ticks < 60 {
            try await Task.sleep(for: .seconds(2))
            ticks += 1
            onProgress("waiting for extraction… \(ticks * 2)s")
            let runs: [ExtractionRun] = try await supabase.from("extraction_runs").select(ExtractionRun.columns)
                .eq("idea_id", value: ideaId).gt("created_at", value: since)
                .order("created_at", ascending: false).limit(1).execute().value
            run = runs.first
        }
        guard let run, run.error == nil else { return run }

        onProgress("saving the result…")
        for _ in 0..<10 {
            let rows: [Idea] = try await supabase.from("ideas").select(Idea.columns).eq("id", value: ideaId).execute().value
            if rows.first?.isClear == run.clear { break }
            try await Task.sleep(for: .seconds(1))
        }
        return run
    }
}
