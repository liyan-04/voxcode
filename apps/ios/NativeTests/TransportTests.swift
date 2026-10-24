import XCTest
import Security
import VoxCodeCore
@testable import VoxCode

final class TransportTests: XCTestCase {
    func testPlaintextRejectedAndOrdinaryHTTPSNeedsNoPrivateCA() throws {
        XCTAssertThrowsError(try BridgeTransport.api(origin: URL(string: "http://100.100.81.209:9899")!, token: "fixture")) { error in XCTAssertFalse(error.localizedDescription.contains("VoxCodeCA.der")) }
        let normal = try BridgeTransport.api(origin: URL(string: "https://example.invalid")!, token: "fixture")
        XCTAssertEqual(try normal.makeRequest("/api/tasks").url?.host, "example.invalid")
    }
    func testServerEntryWithoutReviewedCAFailsBeforePairing() throws {
        guard Bundle.main.url(forResource: "VoxCodeCA", withExtension: "der") == nil else { throw XCTSkip("This build includes a reviewed CA; missing-resource case requires the source-only test build") }
        XCTAssertThrowsError(try BridgeTransport.api(origin: URL(string: "https://100.100.81.209:9899")!, token: "fixture")) { error in XCTAssertTrue(error.localizedDescription.contains("VoxCodeCA.der")) }
    }
    func testFixedIPTrustNeverAcceptsChallengeWithoutServerTrust() {
        for failures in [0, 1] {
            let space = URLProtectionSpace(host: "100.100.81.209", port: 9899, protocol: "https", realm: nil, authenticationMethod: NSURLAuthenticationMethodServerTrust)
            let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil, previousFailureCount: failures, failureResponse: nil, error: nil, sender: ChallengeSender())
            BridgeTransport.TrustDelegate().urlSession(BridgeTransport.session, didReceive: challenge) { disposition, credential in
                XCTAssertEqual(disposition, .cancelAuthenticationChallenge)
                XCTAssertNil(credential)
            }
        }
    }
    func testOrdinaryHTTPSUsesSystemTrust() {
        for host in ["example.invalid", "121.52.250.201"] {
            let space = URLProtectionSpace(host: host, port: 443, protocol: "https", realm: nil, authenticationMethod: NSURLAuthenticationMethodServerTrust)
            let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil, previousFailureCount: 0, failureResponse: nil, error: nil, sender: ChallengeSender())
            BridgeTransport.TrustDelegate().urlSession(BridgeTransport.session, didReceive: challenge) { disposition, credential in
                XCTAssertEqual(disposition, .performDefaultHandling)
                XCTAssertNil(credential)
            }
        }
    }
    func testServerOriginCannotContainCredentialsOrRoutePrefixes() {
        for raw in ["https://user@100.100.81.209:9899", "https://100.100.81.209:9899/api/tasks", "https://100.100.81.209:9899?token=fixture", "https://100.100.81.209:9899#fragment"] {
            XCTAssertThrowsError(try BridgeTransport.api(origin: URL(string: raw)!, token: "fixture")) { error in XCTAssertFalse(error.localizedDescription.contains("VoxCodeCA.der")) }
        }
    }
    func testRedirectDoesNotForwardAnAuthenticatedRequest() {
        let original = URL(string: "https://100.100.81.209:9899/api/tasks")!
        var authenticated = URLRequest(url: original)
        authenticated.setValue("Bearer fixture", forHTTPHeaderField: "Authorization")
        let task = BridgeTransport.session.dataTask(with: authenticated)
        defer { task.cancel() }
        let response = HTTPURLResponse(url: original, statusCode: 302, httpVersion: nil, headerFields: ["Location": "https://other.invalid"])!
        var completed = false
        BridgeTransport.TrustDelegate().urlSession(BridgeTransport.session, task: task, willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: "https://other.invalid")!)) { request in
            completed = true
            XCTAssertNil(request)
        }
        XCTAssertTrue(completed)
    }
    func testCAParserRejectsMissingCAFlagMalformedValidityAndExpiredAnchor() throws {
        let certificate = fixtureCA()
        let value = try AnchorMetadata(der: certificate)
        XCTAssertTrue(value.isValid(at: Date(timeIntervalSince1970: 1_800_000_000)))
        XCTAssertFalse(value.isValid(at: Date(timeIntervalSince1970: 0)))
        XCTAssertFalse(value.isValid(at: Date(timeIntervalSince1970: 9_000_000_000)))
        XCTAssertThrowsError(try AnchorMetadata(der: fixtureCA(ca: false)))
        XCTAssertThrowsError(try AnchorMetadata(der: fixtureCA(before: "not-a-date")))
        XCTAssertThrowsError(try AnchorMetadata(der: Data(certificate.dropLast())))
        XCTAssertThrowsError(try AnchorMetadata(der: Data([0x30, 0x80])))
    }
    private func fixtureCA(ca: Bool = true, before: String = "260101000000Z") -> Data {
        func node(_ tag: UInt8, _ content: [UInt8]) -> [UInt8] { [tag, UInt8(content.count)] + content }
        let validity = node(0x30, node(0x17, Array(before.utf8)) + node(0x18, Array("20360101000000Z".utf8)))
        let basic = node(0x30, node(0x01, [ca ? 0xff : 0]))
        let ext = node(0x30, node(0x06, [0x55, 0x1d, 0x13]) + node(0x04, basic))
        let fields = node(0xa0, [0x02, 0x01, 0x02]) + node(0x02, [1]) + node(0x30, []) + node(0x30, []) + validity + node(0x30, []) + node(0x30, []) + node(0xa3, node(0x30, ext))
        return Data(node(0x30, node(0x30, fields) + node(0x30, []) + node(0x03, [0])))
    }
}
private final class ChallengeSender: NSObject, URLAuthenticationChallengeSender {
    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
    func cancel(_ challenge: URLAuthenticationChallenge) {}
    func performDefaultHandling(for challenge: URLAuthenticationChallenge) {}
    func rejectProtectionSpaceAndContinue(with challenge: URLAuthenticationChallenge) {}
}
