import SwiftUI
import Supabase

@main
struct CloudedApp: App {
    @State private var auth = AuthModel()

    init() { Uploader.sweep() }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
        }
    }
}

// Mirrors the auth state. The first event on authStateChanges is the stored
// session (or nil), so signed-in state survives relaunch without a separate
// read; `ready` keeps the sign-in form from flashing before that arrives.
@Observable
final class AuthModel {
    var session: Session?
    var ready = false

    init() {
        Task { [weak self] in
            for await (_, session) in supabase.auth.authStateChanges {
                guard let self else { return }
                self.session = session
                self.ready = true
            }
        }
    }

    func signIn(email: String, password: String) async throws {
        try await supabase.auth.signIn(email: email, password: password)
    }

    func signOut() async {
        try? await supabase.auth.signOut()
    }
}

struct RootView: View {
    @Environment(AuthModel.self) private var auth

    var body: some View {
        if !auth.ready {
            ProgressView()
        } else if let session = auth.session {
            HomeView(user: session.user)
        } else {
            SignInView()
        }
    }
}
