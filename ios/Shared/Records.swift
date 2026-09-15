// Row shapes the app reads and writes. Column names are the database's;
// nothing here is derived or scored (CLAUDE.md: no numeric idea scores).

import Foundation

struct Idea: Codable, Identifiable, Hashable {
    let id: UUID
    let raw: String
    let status: String            // pending | extracted | failed
    let isClear: Bool?            // nil until the first run lands
    let clarifyingQuestion: String?
    let clarification: String?
    let objective: String?
    let domain: String?
    let imagePath: String?
    let sourceUrl: String?
    let createdAt: Date

    static let columns = "id, raw, status, is_clear, clarifying_question, clarification, objective, domain, image_path, source_url, created_at"

    var isPending: Bool { status == "pending" }
    // vague, with a question the owner has not answered (or answered and is waiting on)
    var asksQuestion: Bool { isClear == false && clarifyingQuestion != nil }

    enum CodingKeys: String, CodingKey {
        case id, raw, status, objective, domain, clarification
        case isClear = "is_clear"
        case clarifyingQuestion = "clarifying_question"
        case imagePath = "image_path"
        case sourceUrl = "source_url"
        case createdAt = "created_at"
    }
}

struct Capability: Codable, Hashable {
    let ideaId: UUID
    let skillId: String?          // nil while proposed
    let proposedKey: String?
    let reason: String?           // why the model thinks the idea needs it
    let cruxRank: Int?

    static let columns = "idea_id, skill_id, proposed_key, reason, crux_rank"

    enum CodingKeys: String, CodingKey {
        case ideaId = "idea_id"
        case skillId = "skill_id"
        case proposedKey = "proposed_key"
        case reason
        case cruxRank = "crux_rank"
    }
}

struct Skill: Codable, Hashable {
    let id: String
    let name: String
}

struct UserSkill: Codable, Hashable {
    let skillId: String
    let level: String             // none | some | solid

    enum CodingKeys: String, CodingKey {
        case skillId = "skill_id"
        case level
    }
}

struct ExtractionRun: Codable, Hashable {
    let id: UUID
    let createdAt: Date
    let error: String?
    let clear: Bool?              // the run's own verdict, from output->clear

    static let columns = "id, created_at, error, clear:output->clear"

    enum CodingKeys: String, CodingKey {
        case id, error, clear
        case createdAt = "created_at"
    }
}

// The two per-row facts the list shows, mirrored from extraction/src/distance.js
// (`cruxOf`, `classify`). Keep them in lockstep; the sort itself stays on the
// web (docs/step-6-plan.md decision 7).
enum CruxStatus: String {
    case have, partial, gap, proposed

    var mark: String {
        switch self {
        case .have: "[x]"
        case .partial: "[~]"
        case .gap: "[ ]"
        case .proposed: "[?]"
        }
    }
}

// The database allows one crux_rank = 1 per idea; the model sometimes marks
// two in its JSON, and `first` is the same deterministic pick cruxOf() makes.
func cruxOf(_ caps: [Capability]) -> Capability? {
    caps.first { $0.cruxRank == 1 }
}

func classify(_ cap: Capability, held: [String: String]) -> CruxStatus {
    guard let skillId = cap.skillId else { return .proposed }
    switch held[skillId] {
    case "solid": return .have
    case "some": return .partial
    default: return .gap
    }
}
