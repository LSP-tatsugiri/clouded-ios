import SwiftUI

// One idea, read-only apart from answering its question: the sentence, the
// picture and link that came with it, every capability with its mark and
// the model's reason, the crux tagged. Mirrors the web idea page minus the
// share control (decision 6: no sharing on the phone).
struct IdeaDetailView: View {
    let id: UUID
    let model: IdeasModel
    @State private var imageURL: URL?
    @State private var imageChecked = false
    @State private var answering = false

    // read through the model so the page updates when an answer lands
    private var idea: Idea? { model.ideas.first { $0.id == id } }

    var body: some View {
        if let idea {
            List {
                Section {
                    Text(idea.raw).font(.headline)
                    if let objective = idea.objective, objective != idea.raw {
                        Text(objective)
                    }
                    if let clarification = idea.clarification {
                        Text("you clarified: \(clarification)").font(.subheadline).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 8) {
                        if idea.status != "extracted" { Tag(idea.isPending ? "extracting…" : idea.status, warn: true) }
                        if let domain = idea.domain { Tag(domain) }
                        Text(idea.createdAt, style: .date).font(.caption).foregroundStyle(.secondary)
                    }
                }

                // the inspiration that came with the idea; extraction never saw either
                if idea.imagePath != nil || idea.sourceUrl != nil {
                    Section {
                        if idea.imagePath != nil { picture }
                        if let source = idea.sourceUrl, let url = URL(string: source) {
                            Link(destination: url) {
                                Label(source, systemImage: "link").font(.footnote).lineLimit(2)
                            }
                        }
                    }
                }

                let caps = model.capabilities(of: idea)
                if !caps.isEmpty {
                    Section("What it needs") {
                        ForEach(caps, id: \.self) { cap in
                            let status = classify(cap, held: model.held)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(status.mark).monospaced()
                                    Text(model.name(of: cap))
                                    if cap.cruxRank == 1 {
                                        Text("the hard part").font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                if let reason = cap.reason {
                                    Text(reason).font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if let progress = model.progress[idea.id] {
                    Section { Text(progress).foregroundStyle(.secondary) }
                } else if idea.asksQuestion, let question = idea.clarifyingQuestion {
                    Section("It asked") {
                        Text(question).italic()
                        Button("Answer this →") { answering = true }
                    }
                }
            }
            .navigationTitle("Idea")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: idea.imagePath) {
                imageURL = await model.mediaURL(for: idea)
                imageChecked = true
            }
            .sheet(isPresented: $answering) {
                AnswerSheet(idea: idea) { text in Task { await model.answer(idea, text) } }
            }
        } else {
            ContentUnavailableView("Not here any more", systemImage: "questionmark")
        }
    }

    @ViewBuilder private var picture: some View {
        if let imageURL {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit()
                case .failure: unavailable
                default: ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                }
            }
        } else if imageChecked {
            unavailable
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 120)
        }
    }

    // a missing object is a failed upload (decision 9); re-share to retry
    private var unavailable: some View {
        Text("a picture was attached but could not be loaded").font(.footnote).foregroundStyle(.secondary)
    }
}

struct Tag: View {
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
