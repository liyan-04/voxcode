import Foundation

@main struct RecordingRaceChecks {
    static func main() {
        var state = RecordingLifecycle()
        let first = state.begin(FrozenRecording(taskId: "A", version: 1))!
        state.discard()
        let second = state.begin(FrozenRecording(taskId: "B", version: 2))!
        precondition(!state.failStart(first, message: "A failed"), "Failed start A must not clean up B")
        state.finishStart(first)
        precondition(state.frozen?.taskId == "B" && state.busy, "Old completion must not clear B busy state")
        precondition(state.error == nil)
        state.finishStart(second)
        precondition(!state.busy && state.frozen?.taskId == "B")
        state.discard()
        let third = state.begin(FrozenRecording(taskId: "C", version: 3))!
        precondition(state.failStart(third, message: "C failed"))
        precondition(state.error == "C failed")
        print("PASS: failed recording A cannot discard or finish newer B")
    }
}
