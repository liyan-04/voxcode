import AVFoundation
import Observation
import VoxCodeCore

@MainActor @Observable final class PCMPlayer {
    private(set) var playing = false
    private(set) var queuedFrames = 0
    private var engine: AVAudioEngine?
    private var node: AVAudioPlayerNode?
    private var sampleRate: Int?
    private var epoch = PlaybackEpoch()
    func enqueue(_ frame: PCMFrame) throws {
        guard !epoch.suppressed else { return }
        guard queuedFrames + frame.samples.count <= frame.sampleRate * 4 else { stop(); throw APIError(message: "语音播放缓冲已满，已停止播报") }
        if sampleRate != frame.sampleRate || engine == nil { try configure(sampleRate: frame.sampleRate) }
        guard let node, let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(frame.sampleRate), channels: 1, interleaved: false), let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frame.samples.count)), let channel = buffer.floatChannelData?[0] else { throw APIError(message: "无法创建语音播放缓冲") }
        buffer.frameLength = buffer.frameCapacity
        frame.samples.withUnsafeBufferPointer { values in channel.update(from: values.baseAddress!, count: values.count) }
        let generation = epoch.id
        queuedFrames += frame.samples.count; playing = true
        node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.epoch.allows(generation) else { return }
                self.queuedFrames = max(0, self.queuedFrames - frame.samples.count)
                self.playing = self.queuedFrames > 0
            }
        }
        if !node.isPlaying { node.play() }
    }
    private func configure(sampleRate: Int) throws {
        clear()
        let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.playback, mode: .spokenAudio); try audio.setActive(true)
        let engine = AVAudioEngine(); let node = AVAudioPlayerNode()
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false) else { throw APIError(message: "不支持的语音采样率") }
        engine.attach(node); engine.connect(node, to: engine.mainMixerNode, format: format); engine.prepare(); try engine.start()
        self.engine = engine; self.node = node; self.sampleRate = sampleRate
    }
    private func clear() {
        epoch.clear(); node?.stop(); engine?.stop(); node = nil; engine = nil; sampleRate = nil; queuedFrames = 0; playing = false
    }
    func stop() { clear(); epoch.suppress(); try? AVAudioSession.sharedInstance().setActive(false) }
    func reset() { clear(); epoch.reset() }
}
