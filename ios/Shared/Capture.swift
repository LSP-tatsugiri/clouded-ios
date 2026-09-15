// Saving an idea from the app or the Share Extension (docs/step-6-plan.md
// Phase D). One idea = a sentence, plus at most one image and one link
// (decision 3). The sentence is required; the media is context.
//
// Write order, amended from decision 9: the id is chosen here, so the row is
// inserted with its image_path already set, then the picture is handed to a
// background URLSession. The plan had a PATCH after the upload; there is no
// process left to send it once the extension is dismissed (the system would
// have to relaunch the containing app for it), and the web page already
// says "attached but could not be loaded" when the object is missing, which
// is the honest state of a failed upload. Extraction still starts on the
// insert and never waits for the picture.

import Foundation
import UIKit

struct NewIdea: Encodable {
    let id: UUID
    let raw: String
    let sourceUrl: String?
    let imagePath: String?

    enum CodingKeys: String, CodingKey {
        case id, raw
        case sourceUrl = "source_url"
        case imagePath = "image_path"
    }
}

enum Capture {
    static let maxSide: CGFloat = 2048     // decision 10
    static let jpegQuality: CGFloat = 0.8

    @discardableResult
    static func save(sentence: String, image: UIImage?, link: URL?) async throws -> UUID {
        let session = try await supabase.auth.session   // refreshes if expired
        let id = UUID()
        // Postgres writes uuids lowercase; the storage policy compares the
        // first path segment to auth.uid()::text, so the case matters.
        let path = image == nil ? nil
            : "\(session.user.id.uuidString.lowercased())/\(id.uuidString.lowercased()).jpg"
        let row = NewIdea(id: id, raw: sentence, sourceUrl: link?.absoluteString, imagePath: path)
        try await supabase.from("ideas").insert(row).execute()
        if let image, let path {
            try Uploader.enqueue(image, to: path, token: session.accessToken)
        }
        return id
    }

    static func jpeg(_ image: UIImage) -> Data? {
        let longest = max(image.size.width, image.size.height) * image.scale
        let fitted: UIImage
        if longest > maxSide {
            let k = maxSide / longest
            let size = CGSize(width: image.size.width * image.scale * k, height: image.size.height * image.scale * k)
            fitted = image.preparingThumbnail(of: size) ?? image
        } else {
            fitted = image
        }
        return fitted.jpegData(compressionQuality: jpegQuality)
    }
}

// A background URLSession in the App Group container: the system finishes
// the upload after the extension is dismissed and retries when connectivity
// returns (decision 2). The request is a plain storage POST with the
// session's token, because a background task cannot run supabase-swift's
// upload; the token is the one at enqueue time, so an upload that waits
// longer than a token lifetime fails, and that idea shows without its
// picture. Nothing listens for completion: there is nothing to do on it.
enum Uploader {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "\(Bundle.main.bundleIdentifier!).upload")
        config.sharedContainerIdentifier = Config.appGroup
        config.sessionSendsLaunchEvents = false
        return URLSession(configuration: config)
    }()

    static var spool: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Config.appGroup)!
            .appendingPathComponent("uploads", isDirectory: true)
    }

    static func enqueue(_ image: UIImage, to path: String, token: String) throws {
        guard let data = Capture.jpeg(image) else { throw CocoaError(.fileWriteUnknown) }
        try FileManager.default.createDirectory(at: spool, withIntermediateDirectories: true)
        // the file must outlive the process, so it goes in the shared container
        let file = spool.appendingPathComponent(path.replacingOccurrences(of: "/", with: "_"))
        try data.write(to: file)

        var request = URLRequest(url: Config.url.appendingPathComponent("storage/v1/object/\(Config.bucket)/\(path)"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        session.uploadTask(with: request, fromFile: file).resume()
    }

    // Spooled files are not removed on completion (nothing listens); the app
    // sweeps anything older than a day at launch.
    static func sweep() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: spool, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-86_400)
        for f in files {
            if let modified = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
               modified < cutoff {
                try? fm.removeItem(at: f)
            }
        }
    }
}
