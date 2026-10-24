import SwiftUI
import VoxCodeCore

@main struct VoxCodeApp: App {
    @State private var session = Session()
    var body: some Scene { WindowGroup { RootView().environment(session) } }
}
struct SimulationBanner: View {
    @Environment(Session.self) private var session
    var body: some View { if session.simulation { Label("模拟演练 · 非真实执行", systemImage: "testtube.2").font(.caption).foregroundStyle(.black).frame(maxWidth: .infinity).padding(.vertical, 6).background(.yellow) } }
}
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var settings = false
    @State private var creating = false
    @State private var recovering = false
    @State private var filter = TaskFilter.all
    var body: some View {
        NavigationStack {
            List {
                Section {
                    if !session.connected { Label(session.token.isEmpty && !session.simulation ? "尚未配对" : "连接中断", systemImage: "wifi.slash").foregroundStyle(.secondary) }
                    if let issue = session.health.issue { Text(issue).font(.caption).foregroundStyle(.red) }
                    if let date = session.health.lastSuccess { Text("最近同步 \(date.formatted())").font(.caption2).foregroundStyle(.secondary) }
                    HStack { Text("执行 \(session.settings.activeExecutions)/\(session.settings.executionLimit)"); Spacer(); Text("排队 \(TaskFilter.queued.apply(session.tasks).count)"); Spacer(); Text("待处理 \(TaskFilter.attention.apply(session.tasks).count)") }.font(.caption)
                    if session.settings.recoveryRequired { Label("需在 Mac 核对旧执行", systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                    Picker("任务筛选", selection: $filter) { ForEach(TaskFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                    if session.pendingSubmission != nil { Button { recovering = true } label: { Label("提交结果待确认", systemImage: "arrow.clockwise") } }
                }
                Section {
                    ForEach(filter.apply(session.tasks)) { task in NavigationLink(value: task.id) { TaskRow(task: task) } }
                } header: { Text("\(filter.apply(session.tasks).count) 个任务") }
            }
            .overlay { if session.connected && session.tasks.isEmpty { ContentUnavailableView("暂无任务", systemImage: "tray") } }
            .safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }
            .navigationTitle("VoxCode")
            .navigationDestination(for: String.self) { TaskDetail(taskId: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button { settings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("连接与设置") }
                ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Image(systemName: "plus") }.disabled((session.token.isEmpty && !session.simulation) || session.pendingSubmission != nil).accessibilityLabel("新任务") }
            }
            .refreshable { await session.refresh() }
        }
        .sheet(isPresented: $settings) { SettingsView() }
        .sheet(isPresented: $creating) { ComposeView(target: nil) }
        .sheet(isPresented: $recovering) { if let pending = session.pendingSubmission { ComposeView(target: (pending.target?.taskId).flatMap { id in session.tasks.first { $0.id == id } }, recovery: pending) } }
        .task { if session.token.isEmpty && !session.simulation { settings = true }; while !Task.isCancelled { if scenePhase == .active && (!session.token.isEmpty || session.simulation) { await session.refresh() }; try? await Task.sleep(for: .seconds(2)) } }
        .onChange(of: scenePhase) { _, phase in if phase == .active && (!session.token.isEmpty || session.simulation) { Task { await session.refresh() } } }
        .alert("操作未完成", isPresented: Binding(get: { session.error != nil }, set: { if !$0 { session.error = nil } })) { Button("确定") { session.error = nil } } message: { Text(session.error ?? "") }
    }
}
private struct TaskRow: View {
    let task: TaskSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title).font(.headline).lineLimit(2)
            HStack { Text(task.shortID).monospaced(); Text(task.statusLabel); Spacer(); Text("v\(task.version)"); if task.acceptance == "accepted" { Image(systemName: "checkmark.seal") } }.font(.caption).foregroundStyle(.secondary)
            if !task.summary.isEmpty { Text(task.summary).font(.caption).lineLimit(2).foregroundStyle(.secondary) }
            if let date = WireDate.parse(task.updatedAt) { Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary) }
        }.padding(.vertical, 3)
    }
}
