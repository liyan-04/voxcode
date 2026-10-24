import Foundation

@main struct CoreBenchmarks {
    static func main() throws {
        let samples = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? 1000 : 1000
        guard (1...100000).contains(samples) else { fatalError("Sample count must be 1...100000") }
        let revision = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "uncommitted"
        var results: [[String: Any]] = []
        for count in [24, 32] {
            let objects: [[String: Any]] = (0..<count).map { index in ["id": "fixture-\(index)", "title": "[模拟] 任务", "prompt": "fixture", "status": index < 4 ? "running" : "queued", "acceptance": "pending", "version": 1, "createdAt": "2026-10-23T00:00:00Z", "updatedAt": "2026-10-23T00:00:00Z", "summary": "fixture", "evidence": []] }
            let data = try JSONSerialization.data(withJSONObject: objects)
            var durations: [Double] = []
            for _ in 0..<samples {
                let began = DispatchTime.now().uptimeNanoseconds
                let tasks = try JSONDecoder().decode([TaskSnapshot].self, from: data)
                precondition(TaskFilter.all.apply(tasks).count == count)
                precondition(TaskFilter.active.apply(tasks).count == 4)
                precondition(TaskFilter.queued.apply(tasks).count == count - 4)
                precondition(TaskFilter.attention.apply(tasks).isEmpty)
                durations.append(Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000)
            }
            results.append(summary("decode_filter_\(count)_tasks", durations))
        }
        var races: [Double] = []
        for _ in 0..<samples {
            let began = DispatchTime.now().uptimeNanoseconds
            var state = RecordingLifecycle(); let old = state.begin(FrozenRecording(taskId: "A", version: 1))!; state.discard(); let current = state.begin(FrozenRecording(taskId: "B", version: 2))!
            precondition(!state.failStart(old, message: "stale")); state.finishStart(old); precondition(state.busy && state.frozen?.taskId == "B"); state.finishStart(current); precondition(!state.busy)
            races.append(Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000)
        }
        results.append(summary("recording_epoch_race", races))
        let report: [String: Any] = ["evidence": "local synthetic core", "revision": revision, "environment": ProcessInfo.processInfo.operatingSystemVersionString, "processorCount": ProcessInfo.processInfo.processorCount, "executionLimit": 4, "results": results, "limitations": ["No SwiftUI rendering/navigation timing", "No microphone, playback, network or device measurements", "No performance threshold established"]]
        let output = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        if CommandLine.arguments.count > 3 { try output.write(to: URL(fileURLWithPath: CommandLine.arguments[3]), options: .atomic) }
        print(String(data: output, encoding: .utf8)!)
    }
    private static func summary(_ name: String, _ values: [Double]) -> [String: Any] {
        let sorted = values.sorted()
        func percentile(_ p: Double) -> Double { sorted[min(sorted.count - 1, max(0, Int(ceil(p * Double(sorted.count))) - 1))] }
        return ["name": name, "samples": values.count, "errors": 0, "unit": "ms", "p50": percentile(0.50), "p95": percentile(0.95), "p99": percentile(0.99)]
    }
}
