import SwiftUI
import Supabase

// The list (docs/step-6-plan.md Phase C, decision 7): own ideas newest-first,
// each with its sentence, status, the crux with its mark, and the clarifying
// question when vague. Read-only apart from answering that question.
struct HomeView: View {
    @Environment(AuthModel.self) private var auth
    let user: User
    @State private var model: IdeasModel
    @State private var answering: Idea?
    @State private var capturing = false

    init(user: User) {
        self.user = user
        _model = State(initialValue: IdeasModel(userId: user.id))
    }

    var body: some View {
        NavigationStack {
            Group {
                if !model.loaded {
                    ProgressView()
                } else if model.ideas.isEmpty && model.error == nil {
                    ContentUnavailableView("No ideas yet", systemImage: "lightbulb",
                                           description: Text("Tap + or share a screenshot to capture one."))
                } else {
                    list
                }
            }
            .navigationTitle("clouded")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Sign out") { Task { await auth.signOut() } }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("New idea", systemImage: "plus") { capturing = true }
                }
            }
            .task { await model.load() }
            .onDisappear { model.stopPolling() }
            .sheet(item: $answering) { idea in
                AnswerSheet(idea: idea) { text in Task { await model.answer(idea, text) } }
            }
            .sheet(isPresented: $capturing) {
                // the new row arrives pending and the list polls it home
                CaptureView { Task { await model.load() } }
            }
        }
    }

    private var list: some View {
        List {
            if let error = model.error {
                Text(error).foregroundStyle(.red)
            }
            ForEach(model.ideas) { idea in
                IdeaRow(idea: idea, crux: model.crux(of: idea), progress: model.progress[idea.id]) {
                    answering = idea
                }
            }
        }
        .listStyle(.plain)
        .refreshable { await model.load() }
    }
}

private struct IdeaRow: View {
    let idea: Idea
    let crux: (name: String, status: CruxStatus)?
    let progress: String?
    let answer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(idea.raw)
            HStack(spacing: 8) {
                if idea.status != "extracted" {
                    Tag(idea.isPending ? "extracting…" : idea.status, warn: true)
                }
                if idea.imagePath != nil { Tag("▣") }
                if idea.sourceUrl != nil { Tag("link") }
                Text(idea.createdAt, style: .relative).font(.caption).foregroundStyle(.secondary)
            }
            if let crux {
                HStack(spacing: 6) {
                    Text(crux.status.mark).monospaced()
                    Text(crux.name)
                    Text("the hard part").font(.caption).foregroundStyle(.secondary)
                }
                .font(.subheadline)
            }
            if let clarification = idea.clarification {
                Text("you clarified: \(clarification)").font(.caption).foregroundStyle(.secondary)
            }
            if let progress {
                Text(progress).font(.subheadline).foregroundStyle(.secondary)
            } else if idea.asksQuestion, let question = idea.clarifyingQuestion {
                Text(question).font(.subheadline).italic()
                Button("Answer this →", action: answer)
                    .font(.subheadline)
                    .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct Tag: View {
    let text: String
    var warn = false

    init(_ text: String, warn: Bool = false) {
        self.text = text
        self.warn = warn
    }

    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(warn ? Color.orange.opacity(0.2) : Color.secondary.opacity(0.15))
            .clipShape(Capsule())
    }
}

// Decision 13: one field. The cost line is the web's, word for word.
private struct AnswerSheet: View {
    let idea: Idea
    let save: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section(idea.raw) {
                    Text(idea.clarifyingQuestion ?? "")
                }
                Section("Your answer") {
                    TextField("Say what the thing actually is", text: $text, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section {
                    Text("Answering re-runs extraction. That is one API call, about a cent.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Answer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Answer") { save(trimmed); dismiss() }
                        .disabled(trimmed.isEmpty)
                }
            }
        }
    }
}
