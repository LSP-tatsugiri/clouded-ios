// The Action Button, Siri, the lock-screen and Control Center widgets and the
// Shortcuts app, all from one App Intent (improvement-backlog §3.1). The README
// promises capture without opening anything, and this is the cheapest way to
// deliver it: no new screen, no new target.
//
// It does not open the app (decided 2026-09-28) — the point of the Action Button
// is that the idea is captured before the phone is even unlocked. Siri asks for
// the sentence, so this is also the voice capture decision 4 deferred.
//
// Offline is safe here only because of the outbox: the save spools and the
// spoken reply says so, instead of claiming an idea landed that has not.

import AppIntents

struct CaptureIdeaIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture an idea"
    static let description = IntentDescription(
        "Saves one sentence to clouded. Extraction runs on the server, about a cent per idea."
    )
    static let openAppWhenRun = false

    @Parameter(title: "The idea", requestValueDialog: "What's the idea?")
    var sentence: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // same rule as the sheet and the Share Extension: blank is not an idea
        guard let idea = Sentence.cleaned(sentence) else {
            return .result(dialog: "I did not catch an idea there.")
        }
        do {
            switch try await Capture.save(sentence: idea, image: nil, link: nil) {
            case .sent:
                return .result(dialog: "Saved.")
            case .queued:
                return .result(dialog: "Saved — waiting for signal.")
            }
        } catch let failure as Capture.Failure {
            // spoken, not thrown: "sign in first" is an instruction, not a crash
            return .result(dialog: IntentDialog(stringLiteral: failure.errorDescription ?? "Could not save that."))
        }
    }
}

struct CloudedShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureIdeaIntent(),
            phrases: [
                "Capture an idea in \(.applicationName)",
                "New idea in \(.applicationName)",
                "Add an idea to \(.applicationName)",
            ],
            shortTitle: "Capture an idea",
            systemImageName: "lightbulb"
        )
    }
}
