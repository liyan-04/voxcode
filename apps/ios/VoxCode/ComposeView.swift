import SwiftUI
import AVFoundation
import VoxCodeCore

struct ComposeView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let target: TaskSnapshot?
    @State private var base: FrozenRecording
    @State private var recorder = Recorder()
    @State private var title: String
    @State private var text: String
    @State private var criteria: [CriterionInput]
    @State private var criteriaEdited = false
    @State private var titleEdited = false
    @State private var sending = false
    @State private var pending: PendingSubmission?
    @State private var rebase = false
    init(target: TaskSnapshot?, recovery: PendingSubmission? = nil) {
        self.target = target
        _base = State(initialValue: recovery?.target ?? FrozenRecording(taskId: target?.id, version: target?.version))
        _title = State(initialValue: recovery?.mutation.title ?? target?.title ?? "")
        _text = State(initialValue: recovery?.mutation.prompt ?? "")
        _criteria = State(initialValue: recovery?.mutation.criteria ?? target?.criteria?.map { CriterionInput(text: $0.text, required: $0.required) } ?? [CriterionInput(text: "根据代码与检查证据确认需求结果")])
        _pending = State(initialValue: recovery)
    }
    private var current: TaskSnapshot? { base.taskId.flatMap { id in session.tasks.first { $0.id == id } } }
    private var stale: Bool { base.taskId != nil && current?.version != base.version }
    private var instruction: String { recorder.frozen == nil ? text : recorder.transcript }
    private var invalidCriteria: Bool { !(1...12).contains(criteria.count) || criteria.contains { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.text.utf16.count > 500 } }
    private var activeTask: Bool { current.map { ["queued", "running", "waiting_approval", "stopping"].contains($0.status) } ?? false }
    var body: some View {
        NavigationStack {
            Form {
                Section("目标") {
                    Text(target?.title ?? (base.taskId == nil ? "新任务" : base.taskId!)).font(.headline)
                    if let version = base.version { Text("\(String((base.taskId ?? "").prefix(8))) · v\(version)").font(.caption).monospaced() }
                    if base.taskId == nil { TextField("任务标题", text: Binding(get: { title }, set: { title = $0; titleEdited = true })).disabled(pending != nil) }
                    if stale && pending == nil { Text("版本已变化：v\(base.version ?? 0) → v\(current?.version ?? 0)").foregroundStyle(.red); if current != nil { Button("重新审阅当前版本") { rebase = true }.disabled(recorder.recording || sending) } }
                    if pending != nil { Label("提交结果待确认", systemImage: "arrow.clockwise").foregroundStyle(.secondary) }
                    if let error = session.error { Text(error).font(.caption).foregroundStyle(.red) }
                    if activeTask { Text("当前任务仍占用执行名额，可保留草稿并查询进度").font(.caption).foregroundStyle(.secondary) }
                }
                Section("指令") { TextEditor(text: recorder.frozen == nil ? $text : Binding(get: { recorder.transcript }, set: { recorder.transcriptEdited = true; recorder.transcript = $0 })).frame(minHeight: 140).disabled(recorder.recording || pending != nil) }
                criteriaSection
                voiceSection
            }
            .safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }
            .navigationTitle(base.taskId == nil ? "新任务" : "追问与查询")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { Task { await recorder.discard(); dismiss() } }.disabled(sending) }
                ToolbarItem(placement: .confirmationAction) { Button(pending == nil ? "开始开发" : "原样重试") { submit() }.disabled(sending || recorder.recording || recorder.busy || !session.connected || (pending == nil && (stale || activeTask || invalidCriteria || instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (base.taskId == nil && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))) }
            }
            .interactiveDismissDisabled(recorder.frozen != nil || sending)
        }
        .confirmationDialog("保留文字，重新确认当前版本与条件", isPresented: $rebase, titleVisibility: .visible) { Button("确认以当前版本继续") { Task { let saved = instruction; await recorder.discard(); text = saved; base = FrozenRecording(taskId: base.taskId, version: current?.version) } } }
        .onChange(of: recorder.draft?.id) { _, _ in applyDraft() }
        .onDisappear { Task { await recorder.discard() } }
        .onChange(of: scenePhase) { _, phase in if phase == .background { recorder.interrupt("进入后台，录音与播报已停止") } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notification in if let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, value == AVAudioSession.InterruptionType.began.rawValue { recorder.interrupt("音频被系统中断") } }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { notification in if let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, value != AVAudioSession.RouteChangeReason.categoryChange.rawValue { recorder.interrupt("音频输入已变化，录音与播报已停止") } }
    }
    private var criteriaSection: some View {
        Section("验收条件") {
            ForEach(criteria.indices, id: \.self) { index in
                VStack(alignment: .leading) {
                    TextField("条件", text: Binding(get: { criteria[index].text }, set: { criteria[index].text = $0; criteriaEdited = true }), axis: .vertical)
                    HStack {
                        Toggle("必选", isOn: Binding(get: { criteria[index].required }, set: { criteria[index].required = $0; criteriaEdited = true }))
                        if criteria.count > 1 { Button(role: .destructive) { criteria.remove(at: index); criteriaEdited = true } label: { Image(systemName: "trash") }.buttonStyle(.borderless).accessibilityLabel("删除条件") }
                    }
                    if criteria[index].text.utf16.count > 500 { Text("条件不能超过 500 字").font(.caption).foregroundStyle(.red) }
                }
            }
            if criteria.count < 12 { Button { criteria.append(CriterionInput(text: "")); criteriaEdited = true } label: { Label("添加条件", systemImage: "plus") } }
        }.disabled(pending != nil || recorder.recording)
    }
    private var voiceSection: some View {
        Section("语音") {
            if recorder.recording { Button { Task { await recorder.stop() } } label: { Label("停止录音", systemImage: "stop.fill") } }
            else { Button { startRecording() } label: { Label(recorder.frozen == nil ? "录音" : "重新录音", systemImage: "mic.fill") }.disabled(recorder.busy || stale || pending != nil || session.simulation) }
            if recorder.player.playing { Label("正在播报", systemImage: "speaker.wave.2.fill") }
            if recorder.outputSupported { Button { Task { await recorder.stopSpeech() } } label: { Label("停止播报", systemImage: "speaker.slash") } }
            if let suggestion = recorder.focusSuggestion { HStack { Text("建议查看：\(session.tasks.first { $0.id == suggestion }?.title ?? String(suggestion.prefix(8)))").font(.caption); Button { recorder.focusSuggestion = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("关闭建议") } }
            if let error = recorder.error { Text(error).font(.caption).foregroundStyle(.red) }
            if recorder.frozen != nil && !recorder.recording { Button("保留文字并结束语音") { Task { let saved = instruction; await recorder.discard(); text = saved } }.disabled(pending != nil) }
        }
    }
    private func startRecording() {
        Task {
            if recorder.frozen != nil { text = instruction; await recorder.discard() }
            base = base.nextAttempt(afterClosing: recorder.closedRequestId)
            do { try await recorder.start(api: session.api, target: base) } catch { recorder.error = error.localizedDescription }
        }
    }
    private func applyDraft() {
        guard pending == nil, let draft = recorder.draft, draft.isValid(for: base) else { return }
        if !criteriaEdited { criteria = draft.criteria }
        if base.taskId == nil && !titleEdited { title = draft.title }
    }
    private func submit() {
        guard pending != nil || (!stale && !activeTask && !invalidCriteria) else { return }
        if pending == nil {
            let frozen = recorder.frozen ?? base
            let path = frozen.taskId.map { "/api/tasks/\($0)/messages" } ?? "/api/tasks"
            pending = PendingSubmission(path: path, mutation: Mutation(requestId: frozen.requestId, version: frozen.version, prompt: instruction, title: frozen.taskId == nil ? title : nil, criteria: criteria), target: frozen)
            recorder.transcriptEdited = true; session.retainSubmission(pending)
        }
        guard let pending else { return }; sending = true
        Task {
            let outcome = await session.mutate(pending.path, pending.mutation)
            if outcome == .succeeded { await recorder.discard(); dismiss() }
            else if outcome == .rejected {
                let saved = instruction
                await recorder.discard()
                text = saved; self.pending = nil
                base = FrozenRecording(taskId: base.taskId, version: base.version)
            }
            sending = false
            if outcome != .succeeded { await session.refresh() }
        }
    }
}
