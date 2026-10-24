import SwiftUI

struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var draftAddress = "https://100.100.81.209:9899"
    @State private var limit = 4
    var body: some View {
        NavigationStack {
            Form {
                Section("演练") { Toggle("模拟演练", isOn: Binding(get: { session.simulation }, set: { enabled in Task { await session.setSimulation(enabled); limit = session.settings.executionLimit } })).disabled(busy) }
                Section("服务器连接") {
                    TextField("https://100.100.81.209:9899", text: $draftAddress).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    SecureField("配对码", text: $code)
                    Button("配对") { busy = true; Task { let paired = await session.pair(address: draftAddress, code: code); busy = false; if paired { dismiss() } } }.disabled(code.isEmpty)
                }.disabled(busy || session.simulation)
                Section("执行名额") {
                    Stepper(value: $limit, in: 1...8) { LabeledContent("并发上限", value: "\(limit)") }.disabled(busy || session.pendingSettings != nil || !session.connected)
                    Button(session.pendingSettings == nil ? "保存名额" : "重试保存") { busy = true; Task { _ = await session.saveSettings(limit: limit); limit = session.pendingSettings?.executionLimit ?? session.settings.executionLimit; busy = false } }.disabled(busy || !session.connected || (session.pendingSettings == nil && limit == session.settings.executionLimit))
                    if session.pendingSettings != nil { Label("设置提交待确认", systemImage: "arrow.clockwise").font(.caption) }
                    LabeledContent("执行中", value: "\(session.settings.activeExecutions)")
                    LabeledContent("排队", value: "\(session.settings.queuedTasks)")
                }
                Section("状态") {
                    LabeledContent("连接", value: session.connected ? "已连接" : "未连接")
                    if let error = session.error { Text(error).font(.caption).foregroundStyle(.red) }
                    if !session.token.isEmpty && !session.simulation {
                        LabeledContent("已配对地址", value: session.address)
                        Button("撤销配对", role: .destructive) { busy = true; Task { _ = await session.unpair(); busy = false } }.disabled(busy)
                        if !session.connected { Button("仅清除本机配对", role: .destructive) { session.forgetLocally() }.disabled(busy); Text("服务器上的凭据仍然有效").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }
            .navigationTitle("连接与设置")
            .toolbar { Button("完成") { dismiss() } }
        }.onAppear { if session.address != "https://" { draftAddress = session.address }; limit = session.pendingSettings?.executionLimit ?? session.settings.executionLimit }
    }
}
