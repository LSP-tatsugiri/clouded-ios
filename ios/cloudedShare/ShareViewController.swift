// Principal class of the Share Extension (Info.plist NSExtensionPrincipalClass).
// It hosts a SwiftUI view and owns the extension context; nothing else.
//
// Phase B: proves the extension loads and can read the app's session from the
// shared Keychain. Phase D adds the attachment and the sentence field.

import SwiftUI
import UIKit

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(
            cancel: { [weak self] in
                self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
            }
        ))
        addChild(host)
        view.addSubview(host.view)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.didMove(toParent: self)
    }
}

struct ShareView: View {
    let cancel: () -> Void
    @State private var who: String?
    @State private var checked = false

    var body: some View {
        NavigationStack {
            Group {
                if !checked {
                    ProgressView()
                } else if let who {
                    Text("Signed in as \(who)")
                } else {
                    // decision 11: the extension never shows a sign-in form
                    Text("Open clouded and sign in first.")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("clouded")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
            }
        }
        .task {
            // `session` refreshes an expired token, so this is the real check
            who = (try? await supabase.auth.session)?.user.email
            checked = true
        }
    }
}
