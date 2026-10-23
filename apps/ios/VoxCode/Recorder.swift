import AVFoundation
import SwiftUI
import VoxCodeCore

struct VoiceEvent: Decodable { var seq: Int; var type: String; var text: String?; var message: String? }
struct VoiceEvents: Decodable { var events: [VoiceEvent]; var cursor: Int }
@MainActor @Observable final class Recorder {
    var frozen: FrozenRecording?; var transcript = ""; var transcriptEdited = false; var recording = false; var busy = false; var error: String?
    private var epoch = RecordingEpoch()
    private var uploadTasks: [UUID: Task<Void, Never>] = [:]
    private var engine: AVAudioEngine?; private var sessionId: String?; private var client: BridgeAPI?; private var poll: Task<Void, Never>?; private var uploads: Task<Void, Never>?
    func start(api: BridgeAPI, target: FrozenRecording) async {
        guard frozen == nil else { return }; frozen = target; transcript = ""; transcriptEdited = false; busy = true; error = nil
        let startingGeneration = epoch.id
        do {
            guard await AVAudioApplication.requestRecordPermission() else { throw APIError(message: "Microphone permission denied. Enable it in iOS Settings.") }
            guard epoch.allows(startingGeneration) else { return }
            struct Created: Decodable { var id: String }
            let created = try JSONDecoder().decode(Created.self, from: await api.request("/api/voice/sessions", method: "POST", body: JSONEncoder().encode(VoiceStart(recording: target))))
            guard epoch.allows(startingGeneration) else { Task { _ = try? await api.request("/api/voice/sessions/\(created.id)", method: "DELETE") }; return }
            sessionId = created.id; client = api
            let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.record, mode: .measurement); try audio.setActive(true)
            let engine = AVAudioEngine(); let input = engine.inputNode; let source = input.outputFormat(forBus: 0)
            guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true), let converter = AVAudioConverter(from: source, to: format) else { throw APIError(message: "16 kHz microphone conversion unavailable") }
            input.installTap(onBus: 0, bufferSize: 4096, format: source) { [weak self] buffer, _ in
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / source.sampleRate + 32)
                guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return }
                var supplied = false; var conversionError: NSError?
                converter.convert(to: output, error: &conversionError) { _, status in if supplied { status.pointee = .noDataNow; return nil }; supplied = true; status.pointee = .haveData; return buffer }
                guard conversionError == nil, let bytes = output.int16ChannelData?[0], output.frameLength > 0 else { return }
                let data = Data(bytes: bytes, count: Int(output.frameLength) * 2)
                Task { @MainActor in self?.enqueue(data, epochId: startingGeneration) }
            }
            self.engine = engine; engine.prepare(); try engine.start(); recording = true; busy = false
            poll = Task { [weak self] in var cursor = 0; while !Task.isCancelled { guard let self else { return }; do { let result = try await api.json(VoiceEvents.self, "/api/voice/sessions/\(created.id)/events?after=\(cursor)"); guard !Task.isCancelled else { return }; cursor = result.cursor; for event in result.events { if event.type == "stt", let text = event.text, !self.transcriptEdited { self.transcript = text }; if event.type == "error" { self.error = event.message ?? "Voice service failed" } } } catch { self.error = error.localizedDescription }; try? await Task.sleep(for: .milliseconds(500)) } }
        } catch { self.error = error.localizedDescription; await discard() }
        busy = false
    }
    private func enqueue(_ data: Data, epochId: UUID) {
        guard epoch.allows(epochId), recording, let client, let sessionId else { return }
        guard uploadTasks.count < 20 else { interrupt("Audio upload is too slow. Recording stopped."); return }
        let previous = uploads; let chunkId = UUID()
        let upload = Task { [weak self] in
            await previous?.value
            defer { self?.uploadTasks.removeValue(forKey: chunkId) }
            guard !Task.isCancelled, self?.epoch.allows(epochId) == true else { return }
            do { _ = try await client.request("/api/voice/sessions/\(sessionId)/audio", method: "POST", body: data, binary: true) }
            catch { guard !Task.isCancelled, self?.epoch.allows(epochId) == true else { return }; self?.interrupt(error.localizedDescription) }
        }
        uploadTasks[chunkId] = upload; uploads = upload
    }
    private func stopEngine() { engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine = nil; recording = false; try? AVAudioSession.sharedInstance().setActive(false) }
    func stop() async {
        let stoppingEpoch = epoch.id; let stoppingClient = client; let stoppingId = sessionId
        stopEngine(); busy = true; await uploads?.value
        guard epoch.allows(stoppingEpoch) else { return }
        if let stoppingClient, let stoppingId { do { _ = try await stoppingClient.request("/api/voice/sessions/\(stoppingId)/stop", method: "POST") } catch { if epoch.allows(stoppingEpoch) { self.error = error.localizedDescription } } }
        if epoch.allows(stoppingEpoch) { busy = false }
    }
    private func cancelUploads() { epoch.invalidate(); for task in uploadTasks.values { task.cancel() }; uploadTasks.removeAll(); uploads = nil }
    func interrupt(_ message: String) {
        guard recording || busy else { return }
        error = message; stopEngine(); cancelUploads(); busy = false
        if let client, let sessionId { Task { _ = try? await client.request("/api/voice/sessions/\(sessionId)/stop", method: "POST") } }
    }
    func discard() async {
        stopEngine(); cancelUploads(); poll?.cancel(); poll = nil
        let closingClient = client; let closingId = sessionId
        sessionId = nil; client = nil; frozen = nil; transcript = ""; busy = false
        if let closingClient, let closingId { Task { _ = try? await closingClient.request("/api/voice/sessions/\(closingId)", method: "DELETE") } }
    }
}
