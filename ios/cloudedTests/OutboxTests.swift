// The spool that keeps a captured idea when the insert cannot reach the
// database (docs/step-6-plan.md decision 2; improvement-backlog §3.2).
// README: "an idea lost because you were in a basement" is the worst thing
// the product can do, so every one of these is a guard against losing a row.

import XCTest

final class OutboxTests: XCTestCase {
    private var dir: URL!
    private var outbox: Outbox!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("outbox-tests-\(UUID().uuidString)", isDirectory: true)
        outbox = Outbox(dir: dir)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private func idea(_ raw: String, image: String? = nil, link: String? = nil) -> NewIdea {
        NewIdea(id: UUID(), raw: raw, sourceUrl: link, imagePath: image)
    }

    private func fetched(_ raw: String, id: UUID = UUID()) -> Idea {
        Idea(id: id, raw: raw, status: "extracted", isClear: true, clarifyingQuestion: nil,
             clarification: nil, objective: nil, domain: nil, imagePath: nil,
             sourceUrl: nil, createdAt: Date(timeIntervalSince1970: 1_000))
    }

    // MARK: - the spool itself

    func testAddedRowComesBackWithEveryFieldIntact() throws {
        let row = idea("a magnetic knob for the dryer",
                       image: "88976eb5/abc.jpg",
                       link: "https://example.com/knob")
        try outbox.add(row)

        let pending = outbox.pending()
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.row, row)
    }

    func testPendingIsNewestFirst() throws {
        let old = idea("captured first")
        let mid = idea("captured second")
        let new = idea("captured third")
        try outbox.add(old, at: Date(timeIntervalSince1970: 1_000))
        try outbox.add(new, at: Date(timeIntervalSince1970: 3_000))
        try outbox.add(mid, at: Date(timeIntervalSince1970: 2_000))

        XCTAssertEqual(outbox.pending().map(\.row.raw),
                       ["captured third", "captured second", "captured first"])
    }

    func testRemoveDeletesOnlyThatRow() throws {
        let keep = idea("keep me")
        let drop = idea("drop me")
        try outbox.add(keep)
        try outbox.add(drop)

        outbox.remove(drop.id)

        XCTAssertEqual(outbox.pending().map(\.row.id), [keep.id])
    }

    func testAddLeavesNoTemporaryFileBehind() throws {
        try outbox.add(idea("one sentence"))

        let files = try FileManager.default.contentsOfDirectory(atPath: dir.path)
        XCTAssertEqual(files.count, 1, "a half-written temp file must not survive the write")
    }

    func testAnUnreadableSpoolFileIsSkipped() throws {
        let good = idea("readable")
        try outbox.add(good)
        try Data("not json".utf8).write(to: dir.appendingPathComponent("\(UUID().uuidString).json"))

        XCTAssertEqual(outbox.pending().map(\.row.id), [good.id],
                       "one corrupt file must not hide the rows around it")
    }

    func testAnOldRowIsNeverAgedOut() throws {
        // Uploader.sweep() drops image spool after a day. The outbox must not
        // copy that: an idea dropped on the floor is the bug this fixes.
        let ancient = idea("queued a month ago")
        try outbox.add(ancient, at: Date(timeIntervalSinceNow: -30 * 86_400))

        XCTAssertEqual(outbox.pending().map(\.row.id), [ancient.id])
    }

    // MARK: - flushing

    func testFlushEmptiesTheSpoolWhenEverySendSucceeds() async throws {
        try outbox.add(idea("first"))
        try outbox.add(idea("second"))

        await outbox.flush { _ in .sent }

        XCTAssertTrue(outbox.pending().isEmpty)
    }

    func testFlushSendsOldestFirst() async throws {
        try outbox.add(idea("captured first"), at: Date(timeIntervalSince1970: 1_000))
        try outbox.add(idea("captured second"), at: Date(timeIntervalSince1970: 2_000))

        var order: [String] = []
        await outbox.flush { row in
            order.append(row.raw)
            return .sent
        }

        XCTAssertEqual(order, ["captured first", "captured second"],
                       "ideas must land in the order they were captured")
    }

    func testFlushKeepsTheRowWhenTheSendFails() async throws {
        let row = idea("still offline")
        try outbox.add(row)

        await outbox.flush { _ in .failed }

        XCTAssertEqual(outbox.pending().map(\.row.id), [row.id])
    }

    func testFlushStopsAtTheFirstFailure() async throws {
        try outbox.add(idea("goes through"), at: Date(timeIntervalSince1970: 1_000))
        try outbox.add(idea("network dies here"), at: Date(timeIntervalSince1970: 2_000))
        try outbox.add(idea("never tried"), at: Date(timeIntervalSince1970: 3_000))

        var attempts = 0
        await outbox.flush { row in
            attempts += 1
            return row.raw == "goes through" ? .sent : .failed
        }

        XCTAssertEqual(attempts, 2, "a dead network must not be hammered once per queued idea")
        XCTAssertEqual(outbox.pending().map(\.row.raw), ["never tried", "network dies here"])
    }

    // MARK: - how a queued row appears in the list

    func testAQueuedRowShowsAsAnIdeaWaitingToSend() {
        let row = idea("dictated in a tunnel", image: "u/i.jpg", link: "https://example.com")
        let queuedAt = Date(timeIntervalSince1970: 5_000)

        let shown = Outbox.Pending(row: row, queuedAt: queuedAt).asIdea

        XCTAssertEqual(shown.id, row.id)
        XCTAssertEqual(shown.raw, "dictated in a tunnel")
        XCTAssertEqual(shown.createdAt, queuedAt, "the list dates it from when it was captured")
        XCTAssertEqual(shown.imagePath, "u/i.jpg")
        XCTAssertEqual(shown.sourceUrl, "https://example.com")
        XCTAssertTrue(shown.isQueued)
        XCTAssertFalse(shown.isPending, "pending is the database's word; queued never reaches it")
    }

    func testAnIdeaFromTheDatabaseIsNotQueued() {
        let extracted = Idea(id: UUID(), raw: "already landed", status: "extracted",
                             isClear: true, clarifyingQuestion: nil, clarification: nil,
                             objective: nil, domain: nil, imagePath: nil, sourceUrl: nil,
                             createdAt: Date())

        XCTAssertFalse(extracted.isQueued)
    }

    // MARK: - merging the queue into the list

    func testQueuedRowsSitAboveTheFetchedOnes() {
        let waiting = Outbox.Pending(row: idea("just captured"),
                                     queuedAt: Date(timeIntervalSince1970: 9_000))
        let landed = fetched("extracted last week")

        XCTAssertEqual(Outbox.merge(queued: [waiting], with: [landed]).map(\.raw),
                       ["just captured", "extracted last week"])
    }

    func testARowTheDatabaseAlreadyHasIsNotShownTwice() {
        // the insert went through but deleting the spool file did not: the id
        // must appear once, as the database's row, not as a queued duplicate
        let row = idea("sent but still spooled")
        let waiting = Outbox.Pending(row: row, queuedAt: Date(timeIntervalSince1970: 9_000))
        let landed = fetched(row.raw, id: row.id)

        let merged = Outbox.merge(queued: [waiting], with: [landed])

        XCTAssertEqual(merged.count, 1)
        XCTAssertFalse(merged[0].isQueued)
    }

    // MARK: - telling a lost response apart from a real failure

    func testADuplicateKeyErrorMeansTheRowAlreadyLanded() {
        XCTAssertTrue(Outbox.isDuplicateRow(FakePostgresError(code: "23505")))
    }

    func testEveryOtherErrorIsARealFailure() {
        XCTAssertFalse(Outbox.isDuplicateRow(FakePostgresError(code: "42501")),  // RLS denial
                       "a policy refusal must not be mistaken for a row that landed")
        XCTAssertFalse(Outbox.isDuplicateRow(URLError(.notConnectedToInternet)))
        XCTAssertFalse(Outbox.isDuplicateRow(CocoaError(.fileNoSuchFile)))
    }

    func testFlushDropsARowTheDatabaseAlreadyHas() async throws {
        // The insert landed and the response was lost. The id is chosen
        // client-side, so the duplicate is proof of success, not a failure.
        try outbox.add(idea("sent twice"))

        await outbox.flush { _ in .alreadySent }

        XCTAssertTrue(outbox.pending().isEmpty)
    }
}

// PostgrestError is in the Supabase package, which this target deliberately
// does not link; conforming a local type to the same protocol tests the real
// classification rather than a mock of it.
private struct FakePostgresError: Error, PostgresCoded {
    let code: String?
}
