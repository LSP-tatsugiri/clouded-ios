import SwiftUI
import Supabase

// Phase B placeholder: proves the session is there and can be dropped.
// Phase C replaces the body with the list.
struct HomeView: View {
    @Environment(AuthModel.self) private var auth
    let user: User

    var body: some View {
        NavigationStack {
            List {
                Section("Signed in as") {
                    Text(user.email ?? user.id.uuidString)
                }
            }
            .navigationTitle("clouded")
            .toolbar {
                Button("Sign out") { Task { await auth.signOut() } }
            }
        }
    }
}
