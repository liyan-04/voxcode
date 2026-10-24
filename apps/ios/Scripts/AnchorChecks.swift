import Foundation

@main struct AnchorChecks {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else { fatalError("Pass the public local-fixture CA DER path") }
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let anchor = try AnchorMetadata(der: data)
        precondition(anchor.isValid(at: Date()))
        precondition(!anchor.isValid(at: Date(timeIntervalSince1970: 0)))
        precondition(!anchor.isValid(at: Date(timeIntervalSince1970: 9_000_000_000)))
        for invalid in [Data(), Data([0x30, 0x80]), Data(data.dropLast()), Data([0x30, 0x81, 0x01, 0])] {
            do { _ = try AnchorMetadata(der: invalid); fatalError("Malformed CA DER accepted") } catch {}
        }
        let constraints = Data([0x30, 0x06, 0x01, 0x01, 0xff, 0x02, 0x01, 0x00])
        guard let range = data.range(of: constraints) else { fatalError("Fixture must have CA:TRUE/pathlen0") }
        var leafAnchor = data; leafAnchor[range.lowerBound + 4] = 0
        do { _ = try AnchorMetadata(der: leafAnchor); fatalError("Non-CA anchor accepted") } catch {}
        print("PASS: local public CA DER metadata, validity, CA flag, truncated/indefinite DER rejection (not network/device trust)")
    }
}
