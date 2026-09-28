// The outbox: a captured idea that could not reach the database waits here
// until it can (improvement-backlog §3.2, decision 2 of docs/step-6-plan.md).
// The README names "an idea lost because you were in a basement" as the worst
// thing the product can do, and until now the row insert was a plain call that
// simply threw with no network.
//
// Same shape as the Uploader spool: one file per idea in the App Group
// container, so it outlives the process that wrote it and the Share Extension
// and the app share one queue. Two rules it must keep:
//
//   * Nothing is ever aged out. Uploader.sweep() drops image spool after a
//     day because a missing picture is a cosmetic loss; a dropped row is the
//     bug this file exists to prevent.
//   * Sending is oldest-first, and stops at the first failure — the ideas
//     land in the order they were captured, and a dead network is tried once
//     per flush, not once per queued idea.
//
// Foundation only, no Supabase: the caller passes the send in, which is what
// lets cloudedTests exercise the whole thing with no host app (project.yml).

import Foundation

// Implemented by PostgrestError in Capture.swift. The protocol exists so this
// file stays Foundation-only and the classification can be unit-tested.
protocol PostgresCoded {
    var code: String? { get }
}

struct Outbox {
    static let shared = Outbox(dir: AppGroup.container.appendingPathComponent("outbox", isDirectory: true))

    let dir: URL

    struct Pending: Codable, Hashable {
        let row: NewIdea
        let queuedAt: Date
    }

    // What the caller's insert did. `alreadySent` is a duplicate-key error:
    // the row landed and the response was lost, and because the id is chosen
    // client-side that is proof of success, not a failure to retry.
    enum SendResult {
        case sent
        case alreadySent
        case failed
    }

    // Postgres unique_violation on the primary key: this row is already in the
    // table, so the insert that appeared to fail actually succeeded and only
    // the response was lost. Anything else is a real failure and stays queued.
    static func isDuplicateRow(_ error: Error) -> Bool {
        (error as? PostgresCoded)?.code == "23505"
    }

    func add(_ row: NewIdea, at queuedAt: Date = Date()) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(Pending(row: row, queuedAt: queuedAt))
        // .atomic writes to a temporary file and renames, so a process killed
        // mid-write leaves the old state, never half a row
        try data.write(to: file(for: row.id), options: .atomic)
    }

    // Newest first, the order the list shows them in. One unreadable file is
    // skipped rather than hiding the rows around it.
    func pending() -> [Pending] {
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? Data(contentsOf: $0) }
            .compactMap { try? JSONDecoder().decode(Pending.self, from: $0) }
            .sorted { $0.queuedAt > $1.queuedAt }
    }

    func remove(_ id: UUID) {
        try? FileManager.default.removeItem(at: file(for: id))
    }

    func flush(send: (NewIdea) async -> SendResult) async {
        for entry in pending().reversed() {
            switch await send(entry.row) {
            case .sent, .alreadySent:
                remove(entry.row.id)
            case .failed:
                return
            }
        }
    }

    private func file(for id: UUID) -> URL {
        dir.appendingPathComponent("\(id.uuidString).json")
    }
}

extension Outbox.Pending {
    // A queued idea is shown as a row like any other, dated from when it was
    // captured rather than when it lands, and carrying a status the database
    // never stores. Nothing is extracted yet, so it has no crux and no detail.
    var asIdea: Idea {
        Idea(id: row.id, raw: row.raw, status: Idea.queuedStatus, isClear: nil,
             clarifyingQuestion: nil, clarification: nil, objective: nil, domain: nil,
             imagePath: row.imagePath, sourceUrl: row.sourceUrl, createdAt: queuedAt)
    }
}

extension Outbox {
    // The list is the queue sitting on top of the database. A row can briefly
    // be in both — the insert went through and removing the spool file did not
    // — and the database's copy is the true one, so the queued copy gives way
    // rather than the same idea appearing twice.
    static func merge(queued: [Pending], with fetched: [Idea]) -> [Idea] {
        let landed = Set(fetched.map(\.id))
        return queued.filter { !landed.contains($0.row.id) }.map(\.asIdea) + fetched
    }
}
