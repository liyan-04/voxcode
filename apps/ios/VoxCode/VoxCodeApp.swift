import SwiftUI
import AVFoundation
import VoxCodeCore

@main struct VoxCodeApp: App {
    @State private var session = Session()
    var body: some Scene { WindowGroup { RootView().environment(session) } }
}
struct RootView: View {
    @Environment(Session.self) private var session
    @State private var settings = false
    @State private var creating = false
    var body: some View {
        NavigationStack {
            List {
                if !session.connected { Label(session.token.isEmpty ? "Pair with your Mac" : "Disconnected", systemImage: "wifi.slash").foregroundStyle(.secondary) }
                if let issue = session.health.issue { VStack(alignment: .leading) { Text(issue).font(.caption); if let date = session.health.lastSuccess { Text("Last connected \(date.formatted())").font(.caption2) } }.foregroundStyle(.secondary) }
                ForEach(session.tasks) { task in NavigationLink(value: task.id) { VStack(alignment: .leading, spacing: 6) { Text(task.title).font(.headline); HStack { Text(task.status.replacingOccurrences(of: "_", with: " ")); Spacer(); Text("v\(task.version)"); if task.acceptance == "accepted" { Image(systemName: "checkmark.seal") } }.font(.caption).foregroundStyle(.secondary) } } }
            }
            .overlay { if session.connected && session.tasks.isEmpty { ContentUnavailableView("No Tasks", systemImage: "tray") } }
            .navigationTitle("VoxCode")
            .navigationDestination(for: String.self) { TaskDetail(taskId: $0) }
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button { settings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("Pairing and settings") }; ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Image(systemName: "plus") }.disabled(session.token.isEmpty).accessibilityLabel("New task") } }
            .refreshable { await session.refresh() }
        }
        .sheet(isPresented: $settings) { SettingsView() }
        .sheet(isPresented: $creating) { ComposeView(target: nil) }
        .task { if session.token.isEmpty { settings = true }; while !Task.isCancelled { if !session.token.isEmpty { await session.refresh() }; try? await Task.sleep(for: .seconds(2)) } }
        .alert("Bridge Error", isPresented: Binding(get: { session.error != nil }, set: { if !$0 { session.error = nil } })) { Button("OK") { session.error = nil } } message: { Text(session.error ?? "") }
    }
}
struct SettingsView: View {
    @Environment(Session.self) private var session; @Environment(\.dismiss) private var dismiss
    @State private var code = ""; @State private var busy = false; @State private var draftAddress = "https://"
    var body: some View {
        NavigationStack { Form {
            Section("Mac Bridge") { TextField("https://mac.example", text: $draftAddress).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).disabled(busy); SecureField("Pairing code", text: $code); Button("Pair") { busy = true; Task { let paired = await session.pair(address: draftAddress, code: code); busy = false; if paired { dismiss() } } }.disabled(busy || code.isEmpty) }
            Section { LabeledContent("Connection", value: session.connected ? "Connected" : "Disconnected"); if !session.token.isEmpty { LabeledContent("Paired Mac", value: session.address); Button("Revoke Pairing", role: .destructive) { busy = true; Task { _ = await session.unpair(); busy = false } }.disabled(busy); if !session.connected { Button("Forget Locally Only", role: .destructive) { session.forgetLocally() }.disabled(busy); Text("Local forgetting does not revoke the credential on your Mac.").font(.caption).foregroundStyle(.secondary) } } }
            Section("Audio") { Text("Speech playback unavailable").foregroundStyle(.secondary) }
        }.navigationTitle("Settings").toolbar { Button("Done") { dismiss() } } }.onAppear { draftAddress = session.address }
    }
}
struct TaskDetail: View {
    @Environment(Session.self) private var session; let taskId: String
    @State private var compose = false; @State private var events: [TaskEvent] = []; @State private var eventError: String?; @State private var busy = false
    var task: TaskSnapshot? { session.tasks.first { $0.id == taskId } }
    var body: some View {
        Group { if let task { List {
            Section { LabeledContent("Execution", value: task.status.replacingOccurrences(of: "_", with: " ")); LabeledContent("Acceptance", value: task.acceptance); LabeledContent("Version", value: "\(task.version)"); if !task.summary.isEmpty { Text(task.summary) } }
            if let approval = task.approval {
                Section("Operation Approval") { Text(approval.description); Text(approval.command).font(.system(.caption, design: .monospaced)).textSelection(.enabled); Text(approval.cwd).font(.caption).foregroundStyle(.secondary)
                    Button("Approve Operation") { action("approvals/\(approval.id)", task, decision: "accept", version: approval.version) }.disabled(busy || approval.version != task.version)
                    Button("Decline Operation", role: .destructive) { action("approvals/\(approval.id)", task, decision: "decline", version: approval.version) }.disabled(busy || approval.version != task.version)
                }
            }
            Section("Results") {
                ForEach(task.evidence.filter { $0.version == task.version }) { evidence in VStack(alignment: .leading, spacing: 6) { Text(evidence.label).font(.headline); Text(evidence.value).font(evidence.kind == "diff" ? .system(.caption, design: .monospaced) : .body).textSelection(.enabled) } }
                if let raw = task.previewUrl, let url = URL(string: raw), url.scheme == "https" { Link(destination: url) { Label("Open Preview", systemImage: "safari") } }
                if task.status == "completed", task.acceptance != "accepted" { Button("Accept Results") { action("accept", task) }.disabled(busy) }
            }
            Section("Activity") { if let eventError { Text(eventError).foregroundStyle(.red) }; ForEach(events) { event in Text(event.message).font(.caption) } }
            Section { Button { compose = true } label: { Label("Add Instruction", systemImage: "mic") }.disabled(busy || task.status == "stopping"); if ["queued", "running", "waiting_input", "waiting_approval"].contains(task.status) { Button("Cancel Execution", role: .destructive) { action("cancel", task) }.disabled(busy) } }
        }.navigationTitle(task.title).sheet(isPresented: $compose) { ComposeView(target: task) }
        } else { ContentUnavailableView("Task Unavailable", systemImage: "exclamationmark.triangle") } }
        .task(id: taskId) { var cursor = 0; while !Task.isCancelled { do { let result = try await session.api.json(EventsEnvelope.self, "/api/tasks/\(taskId)/events?after=\(cursor)"); guard result.events.allSatisfy({ $0.taskId == taskId }) else { throw APIError(message: "Received events for another task") }; cursor = result.cursor; events.append(contentsOf: result.events); eventError = nil } catch { eventError = error.localizedDescription }; try? await Task.sleep(for: .seconds(2)) } }
    }
    func action(_ endpoint: String, _ task: TaskSnapshot, decision: String? = nil, version: Int? = nil) { busy = true; Task { _ = await session.mutate("/api/tasks/\(task.id)/\(endpoint)", Mutation(version: version ?? task.version, decision: decision)); busy = false } }
}
struct ComposeView: View {
    @Environment(Session.self) private var session; @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let target: TaskSnapshot?
    @State private var recorder = Recorder(); @State private var title = ""; @State private var text = ""; @State private var sending = false
    @State private var typedRequest = UUID().uuidString
    @State private var pending: PendingSubmission?
    var currentVersion: Int? { target.flatMap { original in session.tasks.first { $0.id == original.id }?.version } }
    var stale: Bool { guard let target else { return false }; return currentVersion != (recorder.frozen?.version ?? target.version) }
    var body: some View { @Bindable var recorder = recorder
        NavigationStack { Form {
            Section { Text(target?.title ?? "New Task").font(.headline); if target == nil { TextField("Task title", text: $title).disabled(pending != nil) }; if stale && pending == nil { Text("Task changed. Close and reopen this instruction.").foregroundStyle(.red) }; if pending != nil { Text("Submission awaiting confirmation").foregroundStyle(.secondary) } }
            Section("Instruction") { TextEditor(text: recorder.frozen == nil ? $text : Binding(get: { recorder.transcript }, set: { recorder.transcriptEdited = true; recorder.transcript = $0 })).frame(minHeight: 180).disabled(recorder.recording || pending != nil) }
            Section {
                if recorder.recording { Button { Task { await recorder.stop() } } label: { Label("Stop Recording", systemImage: "stop.fill") } }
                else if recorder.frozen == nil { Button { Task { do { try await recorder.start(api: session.api, target: FrozenRecording(taskId: target?.id, version: target?.version)) } catch { recorder.error = error.localizedDescription } } } label: { Label("Record Instruction", systemImage: "mic.fill") }.disabled(recorder.busy || stale || pending != nil) }
                if let error = recorder.error { Text(error).foregroundStyle(.red) }
                if recorder.frozen != nil && !recorder.recording { Button("Discard Recording", role: .destructive) { Task { await recorder.discard() } }.disabled(pending != nil) }
            }
        }.navigationTitle(target == nil ? "New Task" : "Add Instruction").toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { Task { await recorder.discard(); dismiss() } }.disabled(sending) }
            ToolbarItem(placement: .confirmationAction) { Button(pending == nil ? "Submit" : "Retry") { submit() }.disabled(sending || recorder.recording || recorder.busy || (pending == nil && (stale || instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (target == nil && title.isEmpty)))) }
        }.interactiveDismissDisabled(recorder.frozen != nil || sending)
        }.onDisappear { Task { await recorder.discard() } }
        .onChange(of: scenePhase) { _, phase in if phase == .background { recorder.interrupt("Recording interrupted by backgrounding") } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in if let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, value == AVAudioSession.InterruptionType.began.rawValue { recorder.interrupt("Recording interrupted by the audio system") } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in if let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, value != AVAudioSession.RouteChangeReason.categoryChange.rawValue { recorder.interrupt("Audio input changed. Recording stopped.") } }
    }
    var instruction: String { recorder.frozen == nil ? text : recorder.transcript }
    func submit() {
        let frozen = recorder.frozen ?? FrozenRecording(taskId: target?.id, version: target?.version, requestId: typedRequest)
        guard pending != nil || !stale else { return }
        if pending == nil { let path = frozen.taskId.map { "/api/tasks/\($0)/messages" } ?? "/api/tasks"; pending = PendingSubmission(path: path, mutation: Mutation(requestId: frozen.requestId, version: frozen.version, prompt: instruction, title: frozen.taskId == nil ? title : nil)); recorder.transcriptEdited = true }
        guard let pending else { return }; sending = true
        Task { let success = await session.mutate(pending.path, pending.mutation); sending = false; if success { await recorder.discard(); dismiss() } else { await session.refresh() } }
    }
}
