import Foundation

// SecTrust checks the leaf chain; also enforce the bundled anchor's own CA flag and validity.
struct AnchorMetadata {
    let notBefore: Date
    let notAfter: Date
    init(der: Data) throws {
        let root = try DERNode.one(Array(der))
        guard root.tag == 0x30 else { throw DERNode.Invalid() }
        let certificate = try root.children()
        guard certificate.count == 3, certificate[0].tag == 0x30 else { throw DERNode.Invalid() }
        let fields = try certificate[0].children()
        let offset = fields.first?.tag == 0xa0 ? 1 : 0
        guard fields.count >= offset + 6, fields[offset + 3].tag == 0x30 else { throw DERNode.Invalid() }
        let validity = try fields[offset + 3].children()
        guard validity.count == 2, let first = Self.date(validity[0]), let last = Self.date(validity[1]), first < last else { throw DERNode.Invalid() }
        notBefore = first; notAfter = last
        guard let extensions = fields.first(where: { $0.tag == 0xa3 }) else { throw DERNode.Invalid() }
        let wrapper = try extensions.children()
        guard wrapper.count == 1, wrapper[0].tag == 0x30 else { throw DERNode.Invalid() }
        var isCA = false
        for entry in try wrapper[0].children() {
            guard entry.tag == 0x30 else { throw DERNode.Invalid() }
            let values = try entry.children()
            if values.first?.tag == 0x06, values.first?.bytes == [0x55, 0x1d, 0x13] {
                guard !isCA, let value = values.last, value.tag == 0x04 else { throw DERNode.Invalid() }
                let constraints = try DERNode.one(value.bytes)
                guard constraints.tag == 0x30 else { throw DERNode.Invalid() }
                let options = try constraints.children()
                guard options.first?.tag == 0x01, options.first?.bytes == [0xff] else { throw DERNode.Invalid() }
                isCA = true
            }
        }
        guard isCA else { throw DERNode.Invalid() }
    }
    func isValid(at date: Date) -> Bool { date >= notBefore && date <= notAfter }
    private static func date(_ node: DERNode) -> Date? {
        guard let text = String(bytes: node.bytes, encoding: .ascii) else { return nil }
        let format: String
        if node.tag == 0x17, text.count == 13 { format = "yyMMddHHmmss'Z'" }
        else if node.tag == 0x18, text.count == 15 { format = "yyyyMMddHHmmss'Z'" }
        else { return nil }
        guard text.last == "Z", text.dropLast().allSatisfy(\.isNumber) else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = format; formatter.isLenient = false
        formatter.twoDigitStartDate = Date(timeIntervalSince1970: -631152000)
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
        return date
    }
}
private struct DERNode {
    struct Invalid: Error {}
    let tag: UInt8
    let bytes: [UInt8]
    static func one(_ bytes: [UInt8]) throws -> DERNode { var index = 0; let node = try read(bytes, index: &index); guard index == bytes.count else { throw Invalid() }; return node }
    func children() throws -> [DERNode] { var index = 0; var result: [DERNode] = []; while index < bytes.count { result.append(try Self.read(bytes, index: &index)) }; return result }
    private static func read(_ bytes: [UInt8], index: inout Int) throws -> DERNode {
        guard index + 2 <= bytes.count else { throw Invalid() }
        let tag = bytes[index]; let lengthByte = bytes[index + 1]; index += 2
        let length: Int
        if lengthByte < 0x80 { length = Int(lengthByte) }
        else {
            let count = Int(lengthByte & 0x7f)
            guard (1...4).contains(count), index + count <= bytes.count, bytes[index] != 0 else { throw Invalid() }
            var value = 0
            for byte in bytes[index..<(index + count)] { value = value * 256 + Int(byte) }
            guard value >= 128 else { throw Invalid() }; length = value; index += count
        }
        guard length <= bytes.count - index else { throw Invalid() }
        let node = DERNode(tag: tag, bytes: Array(bytes[index..<(index + length)])); index += length; return node
    }
}
