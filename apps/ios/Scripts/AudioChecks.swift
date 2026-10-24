import Foundation

@main struct AudioChecks {
    static func main() throws {
        let format = VoiceOutputFormat(format: "pcm", sample_rate: 24000, channels: 1)
        let data = Data([0, 128, 0, 0, 255, 127])
        let samples = try PCMFrame(base64: data.base64EncodedString(), format: format).samples
        precondition(samples.count == 3 && samples[0] == -1 && samples[1] == 0 && samples[2] > 0.99)
        for invalid in [VoiceOutputFormat(format: "opus", sample_rate: 24000, channels: 1), VoiceOutputFormat(format: "pcm", sample_rate: 48000, channels: 1), VoiceOutputFormat(format: "pcm", sample_rate: 16000, channels: 2)] {
            do { _ = try PCMFrame(base64: data.base64EncodedString(), format: invalid); fatalError("Unsupported audio accepted") } catch is APIError {}
        }
        for invalid in ["!", Data([1]).base64EncodedString(), ""] { do { _ = try PCMFrame(base64: invalid, format: format); fatalError("Invalid PCM accepted") } catch is APIError {} }
        var cursor = VoiceCursor()
        try cursor.advance(sequences: [1, 2, 3], cursor: 3)
        do { try cursor.advance(sequences: [5], cursor: 5); fatalError("Gap accepted") } catch is APIError {}
        precondition(cursor.value == 3)
        try cursor.advance(sequences: [4], cursor: 4)
        var playback = PlaybackEpoch(); let first = playback.id
        precondition(playback.allows(first)); playback.clear(); precondition(!playback.allows(first))
        playback.suppress(); precondition(!playback.allows(playback.id)); playback.reset(); precondition(playback.allows(playback.id))
        print("PASS: signed16LE PCM, negotiated formats, bounded frame validation, ordered cursor, playback clear/suppression")
    }
}
