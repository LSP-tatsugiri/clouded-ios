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
//
// Amended again (improvement-backlog §3.2): the insert itself no longer throws
// the idea away when it cannot reach the database. It goes to Outbox.shared and
// the list shows it as "waiting to send" until a flush gets it through.

import Foundation
import Supabase
import UIKit

enum Capture {
    static let maxSide: CGFloat = 2048     // decision 10
    static let jpegQuality: CGFloat = 0.8

    enum Failure: LocalizedError {
        case notSignedIn

        var errorDescription: String? {
            switch self {
            case .notSignedIn: "Open clouded and sign in first."
            }
        }
    }

    // Whether the row reached the database or is waiting in the outbox. Either
    // way the idea is kept; the caller only needs it to say which.
    enum SaveResult {
        case sent(UUID)
        case queued(UUID)

        var id: UUID {
            switch self {
            case .sent(let id), .queued(let id): id
            }
        }
    }

    @discardableResult
    static func save(sentence: String, image: UIImage?, link: URL?) async throws -> SaveResult {
        // `session` refreshes an expired token, which needs the network. With
        // no network the stored session is still the right identity, and the
        // user id is all that naming the row and the image path takes.
        let stored = (try? await supabase.auth.session) ?? supabase.auth.currentSession
        guard let user = stored?.user.id else { throw Failure.notSignedIn }

        let id = UUID()
        // Postgres writes uuids lowercase; the storage policy compares the
        // first path segment to auth.uid()::text, so the case matters.
        let path = image == nil ? nil
            : "\(user.uuidString.lowercased())/\(id.uuidString.lowercased()).jpg"
        let row = NewIdea(id: id, raw: sentence, sourceUrl: link?.absoluteString, imagePath: path)

        var queued = false
        if case .failed = await send(row) {
            // Any failure spools, not only an obviously offline one. A row that
            // sits in the queue where it can be seen is recoverable; a row
            // thrown away with the sheet is the basement bug.
            try Outbox.shared.add(row)
            queued = true
        }

        if let image, let path, let token = stored?.accessToken {
            try Uploader.enqueue(image, to: path, token: token)
        }
        return queued ? .queued(id) : .sent(id)
    }

    // The whole send: extraction starts from the webhook when the row lands,
    // and the picture goes its own way through Uploader.
    static func send(_ row: NewIdea) async -> Outbox.SendResult {
        do {
            try await supabase.from("ideas").insert(row).execute()
            return .sent
        } catch {
            return Outbox.isDuplicateRow(error) ? .alreadySent : .failed
        }
    }

    static func flushOutbox() async {
        await Outbox.shared.flush(send: send)
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
        AppGroup.container.appendingPathComponent("uploads", isDirectory: true)
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

// Outbox reads the Postgres error code through this, so the spool logic stays
// Foundation-only and testable (Outbox.isDuplicateRow).
extension PostgrestError: PostgresCoded {}
