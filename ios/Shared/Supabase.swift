// The one Supabase client, shared by the app and the Share Extension.
//
// The session lives in the Keychain under the App Group, so the extension
// reads the sign-in the app did and never shows a form (decision 11). Items
// are stored AfterFirstUnlock, which is what lets a background upload finish
// while the phone is locked.

import Foundation
import Supabase

enum Config {
    static let appGroup = "group.com.monoesport.clouded"
    static let bucket = "idea-media"

    static let url = URL(string: plist("SupabaseURL"))!
    static let anonKey = plist("SupabaseAnonKey")

    // Values come from Config.xcconfig through Info.plist. A missing xcconfig
    // leaves the "$(...)" reference unexpanded, which is caught here rather
    // than as a confusing network error later.
    private static func plist(_ key: String) -> String {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !value.isEmpty, !value.hasPrefix("$(") else {
            fatalError("\(key) is not set: copy ios/Config.example.xcconfig to ios/Config.xcconfig and fill it in")
        }
        return value
    }
}

let supabase = SupabaseClient(
    supabaseURL: Config.url,
    supabaseKey: Config.anonKey,
    options: .init(auth: .init(
        storage: KeychainLocalStorage(service: "com.monoesport.clouded.auth", accessGroup: Config.appGroup)
    ))
)
