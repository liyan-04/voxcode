import AVFoundation
import SwiftUI
import VoxCodeCore

@MainActor @Observable final class Recorder {
    private var lifecycle = RecordingLifecycle()
    var frozen: FrozenRecording? { lifecycle.frozen }
    var busy: Bool { get { lifecycle.busy } set { lifecycle.busy = newValue } }
    var error: String? { get { lifecycle.error } set { lifecycle.error = newValue } }
    var transcript = ""; var transcriptEdited = false; var recording = false
    var draft: VoiceDraft?
    var focusSuggestion: String?
    private(set) var outputSupported = false
    let player = PCMPlayer()
    private var outputFormat: VoiceOutputFormat?
    private let permission: @MainActor () async -> Bool
    private let capture: @MainActor (Recorder, UUID) throws -> Void
    private var uploadTasks: [UUID: Task<Void, Never>] = [:]
    private var engine: AVAudioEngine?; private var sessionId: String?; private var client: BridgeAPI?; private var poll: Task<Void, Never>?; private var uploads: Task<Void, Never>?
    init(permission: @escaping @MainActor () async -> Bool = { await AVAudioApplication.requestRecordPermission() }, capture: @escaping @MainActor (Recorder, UUID) throws -> Void = { recorder, generation in try recorder.startCapture(generation) }) {
        self.permission = permission; self.capture = capture
    }
    func start(api: BridgeAPI, target: FrozenRecording) async {
        guard let startingGeneration = lifecycle.begin(target) else { return }
        player.stop(); transcript = ""; transcriptEdited = false; draft = nil; focusSuggestion = nil; outputSupported = false; outputFormat = nil
        do {
            guard await permission() else { throw APIError(message: "麦克风权限未开启，请在系统设置中允许") }
            guard lifecycle.allows(startingGeneration) else { return }
            let created = try JSONDecoder().decode(VoiceCreated.self, from: await api.request("/api/voice/sessions", method: "POST", body: JSONEncoder().encode(VoiceStart(recording: target))))
            guard lifecycle.allows(startingGeneration) else { Task { _ = try? await api.request("/api/voice/sessions/\(created.id)", method: "DELETE") }; return }
            sessionId = created.id; client = api
            outputFormat = created.outputFormat
            outputSupported = created.outputSupported == true && created.outputFormat?.supported == true
            player.reset()
            try capture(self, startingGeneration); recording = true
            lifecycle.finishStart(startingGeneration)
            poll = Task { [weak self] in var cursor = VoiceCursor(); while !Task.isCancelled {
                guard let self, self.lifecycle.allows(startingGeneration) else { return }
                do {
                    let result = try await api.json(VoiceEvents.self, "/api/voice/sessions/\(created.id)/events?after=\(cursor.value)")
                    guard !Task.isCancelled, self.lifecycle.allows(startingGeneration) else { return }
                    try cursor.advance(sequences: result.events.map(\.seq), cursor: result.cursor)
                    for event in result.events { try self.consume(event) }
                } catch {
                    guard !Task.isCancelled, self.lifecycle.allows(startingGeneration) else { return }
                    self.interrupt((error as? APIError)?.code == "cursor_expired" ? "语音事件已过期，已停止。请重新录音" : error.localizedDescription)
                    return
                }
                try? await Task.sleep(for: .milliseconds(500))
            } }
        } catch {
            guard lifecycle.failStart(startingGeneration, message: error.localizedDescription) else { return }
            await discard()
        }
        lifecycle.finishStart(startingGeneration)
    }
    private func consume(_ event: VoiceEvent) throws {
        switch event.type {
        case "stt": if let text = event.text, !transcriptEdited, draft == nil { transcript = text }
        case "draft":
            guard let proposal = event.draft, let frozen, proposal.isValid(for: frozen) else { error = "语音草稿的目标、版本或有效期不符"; return }
            draft = proposal
            if !transcriptEdited { transcript = proposal.prompt }
        case "focus": if let taskID = event.taskId { focusSuggestion = taskID }
        case "audio":
            guard !recording, outputSupported, let outputFormat, let data = event.data else { return }
            try player.enqueue(PCMFrame(base64: data, format: outputFormat))
        case "tts": if event.is_aborted == true { player.stop() }
        case "error": error = event.message ?? "语音服务失败"; player.stop()
        default: break
        }
    }
    func stopSpeech() async {
        player.stop()
        let current = lifecycle.epoch.id
        guard let client, let sessionId else { return }
        do { _ = try await client.request("/api/voice/sessions/\(sessionId)/abort", method: "POST") }
        catch { if lifecycle.allows(current) { self.error = error.localizedDescription } }
    }
    private func startCapture(_ generation: UUID) throws {
        let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.record, mode: .measurement); try audio.setActive(true)
        let engine = AVAudioEngine(); let input = engine.inputNode; let source = input.outputFormat(forBus: 0)
        guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true), let converter = AVAudioConverter(from: source, to: format) else { throw APIError(message: "无法转换为 16 kHz 麦克风音频") }
        input.installTap(onBus: 0, bufferSize: 4096, format: source) { [weak self] buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / source.sampleRate + 32)
            guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
            var supplied = false; var conversionError: NSError?
            converter.convert(to: output, error: &conversionError) { _, status in if supplied { status.pointee = .noDataNow; return nil }; supplied = true; status.pointee = .haveData; return buffer }
            guard conversionError == nil, let bytes = output.int16ChannelData?[0], output.frameLength > 0 else { return }
            let data = Data(bytes: bytes, count: Int(output.frameLength) * 2)
            Task { @MainActor in self?.enqueue(data, epochId: generation) }
        }
        self.engine = engine; engine.prepare(); try engine.start()
    }
    private func enqueue(_ data: Data, epochId: UUID) {
        guard lifecycle.allows(epochId), recording, let client, let sessionId else { return }
        guard uploadTasks.count < 20 else { interrupt("Audio upload is too slow. Recording stopped."); return }
        let previous = uploads; let chunkId = UUID()
        let upload = Task { [weak self] in
            await previous?.value
            defer { self?.uploadTasks.removeValue(forKey: chunkId) }
            guard !Task.isCancelled, self?.lifecycle.allows(epochId) == true else { return }
            do { _ = try await client.request("/api/voice/sessions/\(sessionId)/audio", method: "POST", body: data, binary: true) }
            catch { guard !Task.isCancelled, self?.lifecycle.allows(epochId) == true else { return }; self?.interrupt(error.localizedDescription) }
        }
        uploadTasks[chunkId] = upload; uploads = upload
    }
    private func stopEngine() { engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil; recording = false; try? AVAudioSession.sharedInstance().setActive(false) }
    func stop() async {
        let stoppingEpoch = lifecycle.epoch.id; let stoppingClient = client; let stoppingId = sessionId
        stopEngine(); busy = true; await uploads?.value
        guard lifecycle.allows(stoppingEpoch) else { return }
        if let stoppingClient, let stoppingId { do { _ = try await stoppingClient.request("/api/voice/sessions/\(stoppingId)/stop", method: "POST") } catch { if lifecycle.allows(stoppingEpoch) { self.error = error.localizedDescription } } }
        if lifecycle.allows(stoppingEpoch) { busy = false }
    }
    private func cancelUploads() { lifecycle.invalidate(); for task in uploadTasks.values { task.cancel() }; uploadTasks.removeAll(); uploads = nil }
    func interrupt(_ message: String) {
        guard recording || busy || player.playing || sessionId != nil else { return }
        error = message; player.stop(); stopEngine(); cancelUploads(); poll?.cancel(); poll = nil; busy = false
        if let client, let sessionId { Task { _ = try? await client.request("/api/voice/sessions/\(sessionId)/abort", method: "POST"); _ = try? await client.request("/api/voice/sessions/\(sessionId)/stop", method: "POST") } }
    }
    func discard() async {
        player.stop(); stopEngine(); cancelUploads(); poll?.cancel(); poll = nil
        let closingClient = client; let closingId = sessionId
        sessionId = nil; client = nil; lifecycle.discard(); transcript = ""; draft = nil; focusSuggestion = nil; outputFormat = nil; outputSupported = false
        if let closingClient, let closingId { Task { _ = try? await closingClient.request("/api/voice/sessions/\(closingId)", method: "DELETE") } }
    }
}
