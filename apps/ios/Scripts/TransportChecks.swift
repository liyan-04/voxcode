import Foundation
import Security
import VoxCodeCore

// Runs the actual transport on macOS without an iOS SDK, network, CA asset or Keychain access.
@main struct TransportChecks {
    private struct Failure: Error { let message: String }
    private static func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw Failure(message: message) }
    }
    static func main() {
        do { try run() }
        catch {
            let message = (error as? Failure)?.message ?? error.localizedDescription
            FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
            exit(1)
        }
    }
    private static func run() throws {
        // Missing a reviewed CA must fail before pairing can send a code or receive a token.
        try expect(Bundle.main.url(forResource: "VoxCodeCA", withExtension: "der") == nil, "Run without a bundled CA asset")
        do {
            _ = try BridgeTransport.api(origin: URL(string: "https://100.100.81.209:9899")!, token: "fixture")
            throw Failure(message: "The server entry accepted a missing reviewed CA")
        } catch let failure as Failure { throw failure }
        catch { try expect(error.localizedDescription.contains("VoxCodeCA.der"), "Missing server CA did not fail clearly") }
        for raw in ["http://100.100.81.209:9899", "https://user@100.100.81.209:9899", "https://100.100.81.209:9899/api/tasks", "https://100.100.81.209:9899?token=fixture", "https://100.100.81.209:9899#fragment"] {
            do {
                _ = try BridgeTransport.api(origin: URL(string: raw)!, token: "fixture")
                throw Failure(message: "Invalid server origin accepted: \(raw)")
            } catch let failure as Failure { throw failure }
            catch let error as APIError { try expect(!error.localizedDescription.contains("VoxCodeCA.der"), "Invalid origin reached CA loading before URL validation") }
        }
        let normal = try BridgeTransport.api(origin: URL(string: "https://example.invalid:8443")!, token: "fixture")
        let request = try normal.makeRequest("/api/tasks")
        try expect(request.url?.absoluteString == "https://example.invalid:8443/api/tasks", "Ordinary HTTPS origin was changed")
        try expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture", "Authenticated request lost its bearer")
        let pairing = try normal.makeRequest("/api/pair", method: "POST")
        try expect(pairing.value(forHTTPHeaderField: "Authorization") == nil, "Pairing leaked a bearer")

        let delegate = BridgeTransport.TrustDelegate()
        for failures in [0, 1] {
            try checkChallenge(delegate, host: "100.100.81.209", method: NSURLAuthenticationMethodServerTrust, failures: failures, expected: .cancelAuthenticationChallenge)
        }
        for host in ["example.invalid", "121.52.250.201"] {
            try checkChallenge(delegate, host: host, method: NSURLAuthenticationMethodServerTrust, expected: .performDefaultHandling)
        }
        try checkChallenge(delegate, host: "100.100.81.209", method: NSURLAuthenticationMethodHTTPBasic, expected: .performDefaultHandling)

        let task = BridgeTransport.session.dataTask(with: request)
        defer { task.cancel() }
        var redirectCalled = false
        delegate.urlSession(BridgeTransport.session, task: task,
            willPerformHTTPRedirection: HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: nil, headerFields: ["Location": "https://other.invalid"])!,
            newRequest: URLRequest(url: URL(string: "https://other.invalid")!)) { redirected in
                redirectCalled = true
                precondition(redirected == nil, "Redirect could forward an authenticated request")
            }
        try expect(redirectCalled, "Redirect decision did not complete")
        print("PASS: server entry requires reviewed CA; plaintext/invalid origins rejected; authenticated routing/pairing, exact-IP challenge rejection, system trust and redirect refusal (local macOS, no iOS/network evidence)")
    }
    private static func checkChallenge(_ delegate: BridgeTransport.TrustDelegate, host: String, method: String, failures: Int = 0, expected: URLSession.AuthChallengeDisposition) throws {
        let space = URLProtectionSpace(host: host, port: 9899, protocol: "https", realm: nil, authenticationMethod: method)
        let challenge = URLAuthenticationChallenge(protectionSpace: space, proposedCredential: nil, previousFailureCount: failures, failureResponse: nil, error: nil, sender: TransportChallengeSender())
        var observed: URLSession.AuthChallengeDisposition?
        var observedCredential: URLCredential?
        delegate.urlSession(BridgeTransport.session, didReceive: challenge) { disposition, credential in
            observed = disposition; observedCredential = credential
        }
        try expect(observed == expected, "Wrong authentication disposition for \(host), \(method), failures=\(failures)")
        try expect(observedCredential == nil, "Unverified challenge received a credential")
    }
}
private final class TransportChallengeSender: NSObject, URLAuthenticationChallengeSender {
    func use(_ credential: URLCredential, for challenge: URLAuthenticationChallenge) {}
    func continueWithoutCredential(for challenge: URLAuthenticationChallenge) {}
    func cancel(_ challenge: URLAuthenticationChallenge) {}
    func performDefaultHandling(for challenge: URLAuthenticationChallenge) {}
    func rejectProtectionSpaceAndContinue(with challenge: URLAuthenticationChallenge) {}
}
