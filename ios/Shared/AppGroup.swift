// The App Group id on its own, so the spool logic can be unit-tested without
// the Supabase client: the cloudedTests target in project.yml compiles this
// file, Outbox.swift and Records.swift, and nothing else. Config.appGroup and
// the keychain access group both read the id from here.

import Foundation

enum AppGroup {
    static let id = "group.com.monoesport.clouded"

    // The container the app and the Share Extension both write into; it is
    // what lets a spooled file outlive the process that wrote it.
    static var container: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id)!
    }
}
