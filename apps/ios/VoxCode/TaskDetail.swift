import SwiftUI
import VoxCodeCore

struct TaskDetail: View {
    @Environment(Session.self) private var session
    let taskId: String
    @State private var compose = false
    @State private var events: [TaskEvent] = []
    @State private var eventError: String?
    @State private var busy = false
    @State private var tab = 0
    @State private var pending: PendingSubmission?
    @State private var decision: CriterionDecision?
    var task: TaskSnapshot? { session.tasks.first { $0.id == taskId } }
    var body: some View {
        Group {
            if let task {
                List {
                    Section {
                        LabeledContent("执行", value: task.statusLabel)
                        LabeledContent("验收", value: task.acceptance == "accepted" ? "已验收" : "待验收")
                        LabeledContent("版本", value: "v\(task.version) · \(task.shortID)")
                        if !task.summary.isEmpty { Text(task.summary) }
                        if !session.connected { Label("离线 · 当前为缓存快照", systemImage: "wifi.slash").foregroundStyle(.red) }
                        if task.status == "queued" { Text(task.waitingReason ?? (session.settings.recoveryRequired ? "Mac 需要恢复旧执行" : "等待执行名额")).font(.caption).foregroundStyle(.secondary) }
                        Picker("详情", selection: $tab) { Text("动态").tag(0); Text("结果").tag(1) }.pickerStyle(.segmented)
                    }
                    if let approval = task.approval { approvalSection(approval, task: task) }
                    if tab == 0 {
                        Section("最近活动") { if let eventError { Text(eventError).foregroundStyle(.red) }; ForEach(events) { event in VStack(alignment: .leading) { Text(event.message); if let date = WireDate.parse(event.createdAt) { Text(date.formatted()).font(.caption2).foregroundStyle(.secondary) } }.font(.caption) } }
                    } else {
                        criteriaSection(task)
                        Section("当前版本证据") {
                            if task.evidence.filter({ $0.version == task.version }).isEmpty { Text("暂无证据").foregroundStyle(.secondary) }
                            ForEach(task.evidence.filter { $0.version == task.version }) { EvidenceRow(evidence: $0) }
                        }
                        if let snapshot = task.acceptanceSnapshot { Section("验收记录") { Text("v\(snapshot.version) · \(snapshot.acceptedAt)").font(.caption); ForEach(snapshot.criteria) { Text("\($0.text) · \($0.status == "passed" ? "通过" : "未通过")").font(.caption) } } }
                        if task.evidence.contains(where: { $0.version != task.version }) { Section("历史证据") { ForEach(task.evidence.filter { $0.version != task.version }) { EvidenceRow(evidence: $0) } } }
                    }
                    if let pending { Section { Label("操作结果待确认", systemImage: "arrow.clockwise"); Button("原样重试") { perform(pending) }.disabled(busy || !session.connected) } }
                    Section {
                        Button { compose = true } label: { Label("追问或查询", systemImage: "mic") }.disabled(busy || pending != nil || task.status == "stopping" || session.pendingSubmission != nil)
                        if ["queued", "running", "waiting_input", "waiting_approval"].contains(task.status) { Button("停止执行", role: .destructive) { action("cancel", task) }.disabled(busy || pending != nil || !session.connected) }
                    }
                }.navigationTitle(task.title)
                .sheet(isPresented: $compose) { ComposeView(target: task) }
                .sheet(item: $decision) { item in CriterionReview(decision: item) }
            } else { ContentUnavailableView("任务不可用", systemImage: "exclamationmark.triangle") }
        }
        .safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }
        .task(id: taskId) { await pollEvents() }
    }
    private func approvalSection(_ approval: Approval, task: TaskSnapshot) -> some View {
        Section("操作授权") {
            Text(approval.description)
            Text(approval.command).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            Text(approval.cwd).font(.caption).foregroundStyle(.secondary)
            Button("允许操作") { action("approvals/\(approval.id)", task, decision: "accept", version: approval.version) }.disabled(busy || pending != nil || approval.version != task.version || !session.connected)
            Button("拒绝操作", role: .destructive) { action("approvals/\(approval.id)", task, decision: "decline", version: approval.version) }.disabled(busy || pending != nil || approval.version != task.version || !session.connected)
        }
    }
    private func criteriaSection(_ task: TaskSnapshot) -> some View {
        Section("验收条件 · v\(task.version)") {
            if let criteria = task.criteria {
                ForEach(criteria) { criterion in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(criterion.text)
                        HStack { Text(criterion.required ? "必选" : "可选"); Text(criterion.version != task.version ? "历史版本" : ["passed": "人工检查通过", "failed": "人工检查失败", "unverified": "未验证"][criterion.status] ?? "未验证") }.font(.caption).foregroundStyle(.secondary)
                        if !criterion.evidenceIds.isEmpty { Text("关联证据：" + criterion.evidenceIds.joined(separator: ", ")).font(.caption2).textSelection(.enabled) }
                        if criterion.verification == "manual", criterion.version == task.version, task.status == "completed", task.acceptance != "accepted" {
                            Button("人工检查") { decision = CriterionDecision(taskID: task.id, version: task.version, criterion: criterion) }.disabled(!session.connected || busy || pending != nil)
                        }
                    }.padding(.vertical, 3)
                }
            } else { Text("尚未收到当前版本条件").foregroundStyle(.secondary) }
            if task.status == "completed", task.acceptance != "accepted" { Button("验收当前版本") { action("accept", task) }.disabled(!task.canAccept || !session.connected || busy || pending != nil) }
        }
    }
    private func action(_ endpoint: String, _ task: TaskSnapshot, decision: String? = nil, version: Int? = nil) {
        let submission = PendingSubmission(path: "/api/tasks/\(task.id)/\(endpoint)", mutation: Mutation(version: version ?? task.version, decision: decision))
        pending = submission; perform(submission)
    }
    private func perform(_ submission: PendingSubmission) { busy = true; Task { if await session.mutate(submission.path, submission.mutation) { pending = nil }; busy = false; await session.refresh() } }
    private func pollEvents() async {
        var cursor = 0
        while !Task.isCancelled {
            do {
                let result = try await session.api.json(EventsEnvelope.self, "/api/tasks/\(taskId)/events?after=\(cursor)")
                guard !Task.isCancelled else { return }
                guard result.events.allSatisfy({ $0.taskId == taskId }), result.cursor >= cursor else { throw APIError(message: "任务动态身份或顺序不匹配") }
                events.append(contentsOf: result.events.filter { $0.seq > cursor }); events = Array(events.suffix(500)); cursor = result.cursor; eventError = nil
            } catch { guard !Task.isCancelled else { return }; eventError = error.localizedDescription }
            try? await Task.sleep(for: .seconds(2))
        }
    }
}
private struct EvidenceRow: View {
    let evidence: Evidence
    var body: some View {
        DisclosureGroup {
            if let command = evidence.command { Text(command).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }
            if let code = evidence.exitCode { LabeledContent("退出码", value: "\(code)").font(.caption) }
            Text(evidence.value).font(evidence.kind == "diff" ? .system(.caption, design: .monospaced) : .caption).textSelection(.enabled)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(evidence.label).font(.subheadline)
                HStack { Text("v\(evidence.version)"); Text(evidence.kind == "test" ? (["passed": "检查通过", "failed": "检查失败"][evidence.status ?? ""] ?? "检查未验证") : evidence.kind == "diff" ? "代码改动" : "证据") }.font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
private struct CriterionDecision: Identifiable { let taskID: String; let version: Int; let criterion: Criterion; var id: String { criterion.id } }
private struct CriterionReview: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    let decision: CriterionDecision
    @State private var note = ""
    @State private var busy = false
    @State private var pending: Mutation?
    var stale: Bool { session.tasks.first { $0.id == decision.taskID }?.version != decision.version }
    var body: some View {
        NavigationStack { Form {
            Section("v\(decision.version) · 人工检查") { Text(decision.criterion.text); TextField("检查记录（可选）", text: $note, axis: .vertical).disabled(pending != nil || busy) }
            Section {
                if stale { Text("任务版本已变化").foregroundStyle(.red) }
                if pending != nil { Button("原样重试") { send(pending!) }.disabled(busy || !session.connected) }
                else { Button("检查通过") { send(Mutation(version: decision.version, decision: "pass", note: note)) }; Button("检查失败", role: .destructive) { send(Mutation(version: decision.version, decision: "fail", note: note)) } }
            }.disabled(busy || !session.connected || (pending == nil && stale))
        }.safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }.navigationTitle("人工验收").toolbar { Button("关闭") { dismiss() }.disabled(busy) } }
    }
    private func send(_ mutation: Mutation) { pending = mutation; busy = true; Task { let success = await session.mutate("/api/tasks/\(decision.taskID)/criteria/\(decision.criterion.id)", mutation); busy = false; if success { dismiss() } } }
}
