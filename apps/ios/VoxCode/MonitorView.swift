import SwiftUI
import VoxCodeCore

struct MonitorView: View {
    @Environment(Session.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    private var polling: Bool { visible && scenePhase == .active }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            Form {
                Section("数据状态") {
                    freshness(at: timeline.date)
                    if let error = session.monitor.error { Text(error).foregroundStyle(.red) }
                    if let received = session.monitor.lastSuccess {
                        LabeledContent("手机最近读取", value: received.formatted(date: .omitted, time: .standard))
                    }
                    if let roundtrip = session.monitor.roundtripMilliseconds {
                        LabeledContent("手机监控请求往返", value: milliseconds(roundtrip))
                    }
                    Button { Task { await session.refreshMonitor() } } label: {
                        HStack { Text("刷新监控"); if session.monitor.isLoading { Spacer(); ProgressView() } }
                    }.disabled(!polling || session.monitor.isLoading)
                    Text("仅在本页可见且 App 活跃时每 5 秒读取。失败或超过 15 秒的样本显示为过期。").font(.caption).foregroundStyle(.secondary)
                }
                if let snapshot = session.monitor.snapshot {
                    Section("Mac 执行状态") {
                        LabeledContent("执行名额", value: "\(snapshot.activeExecutions) / \(snapshot.executionLimit)")
                        LabeledContent("任务容量", value: "\(snapshot.maxTasks)")
                        LabeledContent("旧执行核对", value: snapshot.recoveryRequired ? "需要在 Mac 核对" : "无需核对")
                        if snapshot.recoveryRequired {
                            Text("部分执行可能需人工核对。回任务列表查看中断项；需要时在 Mac 本地处理，手机不会自动恢复。").font(.caption).foregroundStyle(.secondary)
                        }
                        LabeledContent("Mac 样本生成", value: WireDate.parse(snapshot.generatedAt)?.formatted(date: .omitted, time: .standard) ?? "未知时间")
                        LabeledContent("桥接进程运行", value: seconds(snapshot.uptimeSeconds))
                    }
                    Section("任务计数") {
                        count("排队", snapshot.counts.queued)
                        count("执行", snapshot.counts.running)
                        count("等待操作批准", snapshot.counts.waitingApproval)
                        count("等待输入", snapshot.counts.waitingInput)
                        count("停止中", snapshot.counts.stopping)
                        count("已中断", snapshot.counts.interrupted)
                        count("失败", snapshot.counts.failed)
                        count("完成待验收", snapshot.counts.completed)
                        count("已验收", snapshot.counts.accepted)
                    }
                    Section("准备状态") {
                        LabeledContent("Codex 可执行程序", value: readiness(snapshot.readiness?.codexAvailable))
                        LabeledContent("语音配置", value: readiness(snapshot.readiness?.voiceConfigured))
                        Text("仅检查可执行程序和配置是否存在；不代表模型认证或真实语音已通过。").font(.caption).foregroundStyle(.secondary)
                    }
                    Section("Mac 桥接进程内存") {
                        LabeledContent("RSS", value: bytes(snapshot.memory.rssBytes))
                        LabeledContent("堆已用", value: bytes(snapshot.memory.heapUsedBytes))
                        Text("只包括 Node 桥接进程，不包括整台 Mac 或 Codex。").font(.caption).foregroundStyle(.secondary)
                    }
                    if let relay = snapshot.relay {
                        Section("Relay 传输") {
                            LabeledContent("Connector", value: relay.connected ? "已连接" : "未连接")
                            LabeledContent("进程运行", value: seconds(relay.uptimeSeconds))
                            count("处理中", relay.inFlight)
                            count("请求总数", relay.requestsTotal)
                            count("成功响应", relay.responsesTotal)
                            count("错误响应", relay.errorsTotal)
                            count("超时响应", relay.timeoutsTotal)
                            count("耗时样本", relay.latencySamples)
                            LabeledContent("请求耗时 P50", value: milliseconds(relay.latencyP50Ms))
                            LabeledContent("请求耗时 P95", value: milliseconds(relay.latencyP95Ms))
                            Text("进程启动后的 HTTP 汇总；耗时取最近 128 个完成请求，包含上传与 Connector/Mac 处理。它不表示模型或语音耗时，也不是网络 RTT；处理中可包含本次监控。").font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Section("Relay 传输") { Text(session.simulation ? "模拟演练未连接真实 Relay" : "此连接未提供 Relay 统计").foregroundStyle(.secondary) }
                    }
                } else {
                    Section { ContentUnavailableView("尚无监控样本", systemImage: "chart.bar.xaxis", description: Text("成功读取后显示汇总数据")) }
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { SimulationBanner() }
        .navigationTitle("运行监控")
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .task(id: polling) {
            guard polling else { return }
            while !Task.isCancelled && polling {
                await session.refreshMonitor(automatic: true)
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
    @ViewBuilder private func freshness(at date: Date) -> some View {
        switch session.monitor.freshness(at: date, connected: session.connected && scenePhase == .active) {
        case .unknown: Label("未知 · 尚无成功样本", systemImage: "questionmark.circle").foregroundStyle(.secondary)
        case .current: Label(session.simulation ? "模拟样本 · 当前" : "当前样本", systemImage: "checkmark.circle").foregroundStyle(.green)
        case .stale: Label("过期样本 · 仅供参考", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        }
    }
    private func count(_ title: String, _ value: Int) -> some View { LabeledContent(title, value: "\(value)") }
    private func readiness(_ value: Bool?) -> String { value.map { $0 ? "已具备" : "未具备" } ?? "未知（旧版未提供）" }
    private func milliseconds(_ value: Double?) -> String { value.map { String(format: "%.1f ms", $0) } ?? "暂无样本" }
    private func seconds(_ value: Double) -> String { String(format: "%.0f 秒", value) }
    private func bytes(_ value: Int) -> String { ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .memory) }
}
