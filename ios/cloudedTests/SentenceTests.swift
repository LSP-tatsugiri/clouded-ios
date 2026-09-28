// One idea is one sentence, and blank is not an idea (docs/step-6-plan.md
// decision 3). Three capture surfaces apply that rule now — the sheet, the
// Share Extension and the App Intent — so it lives in one place.

import XCTest

final class SentenceTests: XCTestCase {
    func testSurroundingWhitespaceIsTrimmed() {
        XCTAssertEqual(Sentence.cleaned("  a magnetic knob for the dryer \n"),
                       "a magnetic knob for the dryer")
    }

    func testAnEmptySentenceIsNotAnIdea() {
        XCTAssertNil(Sentence.cleaned(""))
    }

    func testWhitespaceAloneIsNotAnIdea() {
        XCTAssertNil(Sentence.cleaned("   \n\t  "),
                     "Siri hands over an empty string when it hears nothing")
    }

    func testALineBreakInsideTheSentenceIsKept() {
        XCTAssertEqual(Sentence.cleaned("a bin for pokemon cards\nparametric, per set"),
                       "a bin for pokemon cards\nparametric, per set")
    }
}
