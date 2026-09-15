// Principal class of the Share Extension (Info.plist NSExtensionPrincipalClass).
// It hosts a SwiftUI view and owns the extension context; nothing else.
//
// Phase D (docs/step-6-plan.md): one image or one web URL comes in (the
// activation rule in project.yml), the sentence is typed here, Save inserts
// the row and hands the picture to the background uploader, then dismisses.
// The upload outlives this process (decision 2).

import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
            .flatMap { $0.attachments ?? [] } ?? []
        let host = UIHostingController(rootView: ShareView(
            providers: providers,
            finish: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
            cancel: { [weak self] in self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled)) }
        ))
        addChild(host)
        view.addSubview(host.view)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.didMove(toParent: self)
    }
}

enum Attachment {
    case image(UIImage)
    case link(URL)
    case none

    // A page shared from Safari can carry both a URL and a preview image;
    // the URL is the thing worth keeping then, so a web URL wins when present.
    static func load(from providers: [NSItemProvider]) async -> Attachment {
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }),
           let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
           ["http", "https"].contains(url.scheme?.lowercased()) {
            return .link(url)
        }
        if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }),
           let item = try? await p.loadItem(forTypeIdentifier: UTType.image.identifier) {
            // Photos hands a file URL, the screenshot preview a UIImage, some apps Data
            switch item {
            case let url as URL: if let img = UIImage(contentsOfFile: url.path) { return .image(img) }
            case let data as Data: if let img = UIImage(data: data) { return .image(img) }
            case let img as UIImage: return .image(img)
            default: break
            }
        }
        return .none
    }
}

struct ShareView: View {
    let providers: [NSItemProvider]
    let finish: () -> Void
    let cancel: () -> Void
    @State private var signedIn: Bool?
    @State private var attachment: Attachment?
    @State private var sentence = ""
    @State private var busy = false
    @State private var error: String?

    private var trimmed: String { sentence.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Group {
                if signedIn == nil || attachment == nil {
                    ProgressView()
                } else if signedIn == false {
                    // decision 11: the extension never shows a sign-in form
                    Text("Open clouded and sign in first.").foregroundStyle(.secondary)
                } else {
                    form
                }
            }
            .navigationTitle("clouded")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: cancel).disabled(busy)
                }
                if signedIn == true {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: save) {
                            if busy { ProgressView() } else { Text("Save") }
                        }
                        .disabled(busy || trimmed.isEmpty)
                    }
                }
            }
        }
        .task {
            // `session` refreshes an expired token, so this is the real check
            signedIn = (try? await supabase.auth.session) != nil
            attachment = await Attachment.load(from: providers)
        }
    }

    private var form: some View {
        Form {
            Section {
                switch attachment {
                case .image(let image):
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 200)
                case .link(let url):
                    Text(url.absoluteString).font(.footnote).foregroundStyle(.secondary).lineLimit(3)
                default:
                    Text("Nothing usable was shared; the sentence alone is fine.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("The idea") {
                TextField("One sentence: what is it?", text: $sentence, axis: .vertical)
                    .lineLimit(2...6)
            }
            Section {
                Text("Saving runs extraction. That is one API call, about a cent.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let error { Text(error).foregroundStyle(.red) }
            }
        }
    }

    private func save() {
        busy = true
        error = nil
        Task {
            do {
                var image: UIImage?, link: URL?
                if case .image(let i) = attachment { image = i }
                if case .link(let u) = attachment { link = u }
                try await Capture.save(sentence: trimmed, image: image, link: link)
                finish()
            } catch {
                self.error = error.localizedDescription
                busy = false
            }
        }
    }
}
