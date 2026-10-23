import XCTest
import Security
import VoxCodeCore
@testable import VoxCode

final class TransportTests: XCTestCase {
    func testPlaintextRejectedAndOrdinaryHTTPSNeedsNoPrivateCA() throws {
        XCTAssertThrowsError(try BridgeTransport.api(origin: URL(string: "http://121.52.250.201:9899")!, token: "fixture"))
        let normal = try BridgeTransport.api(origin: URL(string: "https://example.invalid")!, token: "fixture")
        XCTAssertEqual(try normal.makeRequest("/api/tasks").url?.host, "example.invalid")
    }
    func testMissingBundledPrivateCAFailsClearly() {
        guard Bundle.main.url(forResource: "VoxCodeCA", withExtension: "der") == nil else { return }
        XCTAssertThrowsError(try BridgeTransport.api(origin: URL(string: "https://121.52.250.201:9899")!, token: "fixture")) { error in XCTAssertTrue(error.localizedDescription.contains("VoxCodeCA.der")) }
    }
    func testFixedIPTrustNeverAcceptsChallengeWithoutServerTrust() {
        let space = URLProtectionSpace(host: BridgeTransport.fixedIP, port: 9899, protocol: "https", realm: nil, authenticationMethod: NSURLAuthenticationMethodServerTrust)
        let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil, previousFailureCount: 0, failureResponse: nil, error: nil, sender: ChallengeSender())
        BridgeTransport.TrustDelegate().urlSession(BridgeTransport.session, didReceive: challenge) { disposition, credential in
            XCTAssertEqual(disposition, .cancelAuthenticationChallenge)
            XCTAssertNil(credential)
        }
    }
    func testOrdinaryHTTPSUsesSystemTrust() {
        let space = URLProtectionSpace(host: "example.invalid", port: 443, protocol: "https", realm: nil, authenticationMethod: NSURLAuthenticationMethodServerTrust)
        let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil, previousFailureCount: 0, failureResponse: nil, error: nil, sender: ChallengeSender())
        BridgeTransport.TrustDelegate().urlSession(BridgeTransport.session, didReceive: challenge) { disposition, credential in
            XCTAssertEqual(disposition, .performDefaultHandling)
            XCTAssertNil(credential)
        }
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
