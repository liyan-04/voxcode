import Foundation
import Security
import VoxCodeCore

enum BridgeTransport {
    static let fixedIP = "100.100.81.209"
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
        return URLSession(configuration: configuration, delegate: TrustDelegate(), delegateQueue: nil)
    }()
    static func api(origin: URL, token: String) throws -> BridgeAPI {
        let origin = try BridgeAPI.validateOrigin(origin)
        if origin.host == fixedIP { _ = try bundledCA() }
        return BridgeAPI(base: origin, token: token, transport: { try await session.data(for: $0) })
    }
    static func bundledCA() throws -> SecCertificate {
        guard let url = Bundle.main.url(forResource: "VoxCodeCA", withExtension: "der"), let data = try? Data(contentsOf: url) else { throw APIError(message: "此构建缺少 VoxCodeCA.der，无法验证固定 IP 的身份") }
        guard let metadata = try? AnchorMetadata(der: data), metadata.isValid(at: Date()), let certificate = SecCertificateCreateWithData(nil, data as CFData) else { throw APIError(message: "内置信任 CA 无效或已过期") }
        return certificate
    }
    final class TrustDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else { completionHandler(.performDefaultHandling, nil); return }
            guard challenge.protectionSpace.host == fixedIP else { completionHandler(.performDefaultHandling, nil); return }
            guard challenge.previousFailureCount == 0, let trust = challenge.protectionSpace.serverTrust, let anchor = try? bundledCA() else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            SecTrustSetNetworkFetchAllowed(trust, false)
            guard SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, fixedIP as CFString)) == errSecSuccess,
                  SecTrustSetAnchorCertificates(trust, [anchor] as CFArray) == errSecSuccess,
                  SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
                  SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }
}
