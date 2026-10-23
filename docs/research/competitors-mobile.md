# Mobile coding agents: evidence and positioning

Research date: 2026-10-23 (Asia/Shanghai). Sources below were fetched during this research. This is a public-document review, not a hands-on product test. A vendor statement establishes a documented claim; it does not establish account availability, reliability, latency, security implementation or feature parity in a particular installed version.

## Decision

Phone-to-computer coding dispatch, voice input, two-way voice conversation, synchronized sessions and completion notifications are already documented in this market. They cannot substantiate a claim that VoxCode is unique. Linx as the chosen voice provider is an integration choice, not a demonstrated user benefit by itself.

The current scheme addresses the direction of the user's need: develop away from the desk, direct a Mac executor, inspect progress, and decide whether the result is acceptable. It does not yet demonstrate that complete workflow. The coordinator's current verification status is a source scaffold with STT integration, without verified spoken TTS playback, a preview pipeline, a complete real Codex model turn or a native device build. See the separately maintained requirements audit and progress record for implementation evidence. A source-level contract is not evidence that a user can finish the workflow.

The more defensible product hypothesis is: **a mobile voice collaborator that turns an ambiguous request into explicit acceptance conditions, then explains actual results against those conditions and the exact task version before the user accepts.** This is an intended focus, not an established competitive advantage. Competing products may support parts or all of this workflow; the reviewed sources do not establish the absence of it.

## Evidence matrix

Every populated competitor cell below is a documented vendor claim, not independently verified behavior. "Not established" means this research has insufficient evidence, not that the feature is absent.

| Workflow | TRAE SOLO Mobile | Happy | HAPI | Implication for VoxCode |
| --- | --- | --- | --- | --- |
| Phone dispatch, computer execution | Paired Desktop (Local) and Web (Cloud), authorized folders [T1] | Agents run on the user's computer; phone can start sessions and message them [H1, H2] | CLI/Runner executes; native and Web clients control sessions [P1, P2] | Baseline capability |
| Voice input | Voice messages become actionable instructions [T1] | Phone voice agent forwards formulated requests [H3] | Native dictation; Web voice assistant [P1-P3] | STT alone is insufficient differentiation |
| Natural dialogue and spoken feedback | Brainstorm Mode clarifies thinking and builds a structured execution plan [T1] | Phone conversation, completion speech, active-session context and voice permissions [H3] | Two-way voice, spoken completion/errors, context synchronization and voice permissions [P3] | "Talk naturally to your coder" also overlaps |
| Multiple tasks or sessions | Parallel tasks across paired endpoints; real-time visibility [T1] | Voice follows the focused session and hears other-session updates [H3] | Session list and creation; voice context follows session focus [P2, P3] | Two-task routing must be reliable; two tasks alone is not a moat |
| Phone inspection | Project files and artifacts, including code and test notes [T1] | Files and session Git changes [H2] | Files, Git status and diffs in native apps [P2] | A readable result and diff are expected |
| Existing official Codex session continuity | Not established by this research | Original CLI wraps Codex; same phone app also supports Happy Harness [H1, H2] | Official terminal UI and HAPI share an app-server on Codex >=0.154.0, with documented lifecycle limits [P4] | Explicitly distinguish a new VoxCode task from an existing Codex Desktop conversation |
| Criteria-to-evidence acceptance bound to task version | Not established by reviewed sources | Not established by reviewed sources | Not established by reviewed sources | Test as a product focus; do not claim competitor absence |
| The user's intended "Codex + Dot" | Identity unresolved | Not applicable | Not applicable | Exclude from scored comparison until the exact product is established |

## TRAE: facts and interpretation

**Facts from T1.** The official post is titled "Introducing TRAE SOLO Mobile," authored by The TRAE Team and visibly dated May 6, 2026. It states Mobile is live and Desktop, Web and Mobile no longer require an invite code. It describes Code Mode and MTC Mode; pairing with multiple Desktop/Web endpoints; synchronized context and status; background execution with push alerts; authorized directory browsing and artifact saving; and parallel execution. It explicitly describes voice input, real-time brainstorming and clarification followed by a structured execution plan.

**Interpretation.** TRAE directly overlaps the broad "speak on a phone, let the computer work" proposition. Its documented brainstorm flow also overlaps a generic voice clarification pitch. Its local and cloud execution options are broader than VoxCode's present Mac-only scope. This does not establish which product is better for the user's existing Codex projects.

**Unknowns.** The article is not a reproducible test of voice latency, mobile review quality, session recovery or exact-code-version acceptance. Availability to a specific account, region and device was not tested. Privacy Mode's stated data-use restrictions should not be described as a general end-to-end encryption guarantee.

## Happy: facts and interpretation

**Facts from H1-H3.** Current Happy documentation describes an open-source harness for Claude, Codex and Grok, local computer execution and an end-to-end encrypted mobile sync path. The phone supports messages, permissions/questions, stopping a turn, model controls, directory-based session creation, files and Git changes. The original CLI remains a wrapper for the official Claude Code/Codex harnesses; Happy Desktop's Happy Harness is a distinct route, so these should not be conflated.

The official voice guide explicitly says the phone voice agent listens, sends requests to the viewed session, speaks when coding completes, and handles spoken permission decisions. It receives the active-session list, follows focus and hears updates from other sessions. The guide also distinguishes encrypted device sync from voice: microphone audio and selected decrypted session context go directly from the phone to ElevenLabs. Its current published allowance is 20 free minutes per 30 days, followed by a subscription or a user-provided ElevenLabs agent. These are documented terms as accessed, not a price or entitlement guarantee.

**Interpretation.** Happy is a much closer functional benchmark than a text-only remote terminal. VoxCode needs a measurable improvement in a chosen workflow; adding TTS or naming Linx does not itself provide that improvement. Happy's provider and data-flow choices can inform a concrete privacy comparison, but the research does not justify claiming VoxCode is more private.

**Unknowns.** We did not test mobile app behavior, performance or the relationship between every Happy Desktop and original-CLI capability. The guide's account-based voice limits may change. No claim about missing acceptance functionality follows from its omission in the pages reviewed.

## HAPI: facts and interpretation

**Facts from P1-P4.** HAPI describes itself as a local-first alternative to Happy. It supports multiple coding agents, native iOS/Android clients, Web/PWA and a Telegram Mini App. The native guide documents session creation, streaming chat, permission handling, files/Git diffs, dictation and push notifications. It explicitly separates native dictation, which inserts editable text without sending, from the full voice assistant available through Web.

The Web voice assistant supports two-way conversation using ElevenLabs, Gemini Live or Qwen Realtime. Its documented tools forward messages and process permission requests; it receives session history and relevant agent events and speaks completion/error updates. Its native iOS source uses SwiftUI/UIKit; native features should not be assumed identical to Web.

The Codex shared-session guide requires Codex 0.154.0 or newer and says official terminal UI and HAPI clients can share an app-server. It also documents ownership, resume, crash/replay and unsupported-operation limits. This is evidence of a designed integration with explicit boundaries, not our verification of those guarantees.

**Interpretation.** Session durability, device continuity and recovery are already meaningful competitor concerns. A new bespoke bridge has to earn its maintenance cost. If the user's real need is primarily remote access to an existing Codex workflow, testing HAPI/Happy first may satisfy that need sooner. A VoxCode build is more defensible when its acceptance workflow is the explicit purpose of the experiment.

**Unknowns.** Native distribution, signing, push and network setup depend on the build and hub configuration. We did not install HAPI, validate its security design or run its official Codex integration tests. A README claim of seamless handoff does not override the detailed lifecycle limits in P4.

## Dot: identity remains unresolved

The user identified Dot only as a product used with Codex. Public search surfaced third-party pages about an OpenAI product named Dot, but a search result is insufficient to establish that this is the user's intended product or to support feature claims. The attempted official documentation paths `https://developers.openai.com/dot/` and `https://learn.chatgpt.com/dot/` returned HTTP 403 and a connection timeout respectively. These were exploratory paths, not verified documentation URLs; the failures do not prove that official Dot documentation is absent.

Accordingly this report does not assign an identity, release date, mobile capability or limitation to "Codex + Dot." The exact product link or an official source that unambiguously matches it is still required for that comparison. Earlier search results and similarly named GitHub projects must not be promoted into a confident identification.

## Requirements that decide usefulness

The following are product requirements and proposed verification, not claims of delivered behavior.

| User need | What must be demonstrated | Current gap or decision |
| --- | --- | --- |
| Work away from the Mac | Phone submits a real request; a real Codex turn edits a bounded project; actual checks finish | Full live loop remains unverified |
| Think aloud without composing a perfect prompt | Linx asks one material clarification, confirms the intended task and proposes concrete acceptance conditions | STT submission alone does not demonstrate this |
| Hear what happened | Real decoded speech reports the actual status, failed check or result; interruption does not cancel code execution | Verified TTS playback remains a gap |
| Know whether the change works | Show real diff, check command/results and evidence version; open a real preview when the task has a UI | Preview pipeline and complete evidence collection remain gaps |
| Decide to accept | User accepts the result/version explicitly; new changes invalidate stale evidence and acceptance | Contract is a start; demonstrate state transitions end to end |
| Handle two tasks while speaking | Recording keeps its original task/version when focus changes; repeated delivery causes at most one mutation | Requires adversarial two-task device test |
| Resume after a phone network interruption | Show disconnected/reconnecting state; reconcile actual Mac execution without duplicating a request | Must be verified, not inferred from a health endpoint |
| Continue an already-open Codex Desktop conversation | Establish the supported integration path and durable identity | Outside current README scope; state this before using "Codex remote control" broadly |

## Recommended minimum experiment

Build and demonstrate one complete acceptance loop before broadening the controller. Use a small UI bug with an observable result. On the phone, speak an intentionally incomplete request. Linx asks for the missing behavior and reads back the acceptance conditions. The user confirms the draft. Codex makes the real change on the Mac and runs the relevant check. The phone shows the real diff, result and preview for that version. Linx explains which condition is supported by which evidence and names any manual check still needed. The user accepts or requests a bounded follow-up against that version.

Then repeat while switching between two tasks and briefly disconnecting the phone. A failed or stale check must never be described as passed; old screenshots must never be offered as proof of the new version. Measure successful completion, wrong-task mutations, duplicate mutations, recovery success, and time from spoken request to an inspectable result. Compare the same task and device conditions with at least one available competitor. Voice latency and subjective convenience need measurement before they become positioning claims.

For a two-day MVP, this implies a deliberately small scope: one Mac, one approved project, one voice provider and one real preview/check type. Add the second isolated task only after the single-task loop passes. Generic remote terminal features, many providers and broad IDE replacement work should not displace the core demonstration.

Suggested positioning for the experiment: **"Speak the change. Inspect the evidence. Accept the exact result."** Describe it as the intended experience until it is verified. Avoid "first," "only," "fully hands-free," "production-ready" or guaranteed reliability claims.

## Source ledger

All entries were accessed on 2026-10-23. Git commit dates below describe the latest commit returned for that source path; they are not product release dates. GitHub `main` links can change after this research.

| ID | Official source and date | Claims supported |
| --- | --- | --- |
| T1 | [Introducing TRAE SOLO Mobile](https://www.trae.ai/blog/trae_solo_mobile_0506), visible publication date 2026-05-06; `https://trae.ai/blog/trae_solo_mobile_0506` redirects to this canonical URL | Voice, brainstorm, endpoints, parallel tasks, folders, push, launch |
| H1 | [Happy README](https://github.com/slopus/happy/blob/main/README.md); [latest path commit](https://github.com/slopus/happy/commit/99f415fa0d12d233a80a77fd88122bfb19b17477), 2026-10-11 08:13:04 UTC | Harness, agents, local hardware, encrypted mobile sync, original CLI distinction |
| H2 | [Happy mobile app guide source](https://github.com/slopus/slopus.github.io/blob/main/content/desktop/mobile-app.mdx), publication date not stated | Phone capabilities, local execution, pairing, privacy |
| H3 | [Happy voice guide source](https://github.com/slopus/slopus.github.io/blob/main/content/desktop/voice.mdx); [latest path commit](https://github.com/slopus/slopus.github.io/commit/6928b8f7740e835624343356054b09949e4444f5), 2026-10-11 01:53:14 UTC | Phone conversation, context, completion speech, permissions, ElevenLabs data flow and allowances |
| P1 | [HAPI README](https://github.com/tiann/hapi/blob/main/README.md); [latest path commit](https://github.com/tiann/hapi/commit/051dbbd7da1252978f33ee443dbb0882663f8f4d), 2026-09-13 02:43:59 UTC | Local-first positioning, clients, agents, dictation/assistant distinction |
| P2 | [HAPI native apps guide](https://github.com/tiann/hapi/blob/main/docs/guide/native-apps.md); [latest path commit](https://github.com/tiann/hapi/commit/733a960edeb62c78589ede6b7d1486b51a29cbab), 2026-09-14 05:19:21 UTC | Native workflow, capabilities, distribution/notifications and Web differences |
| P3 | [HAPI voice assistant guide](https://github.com/tiann/hapi/blob/main/docs/guide/voice-assistant.md); [latest path commit](https://github.com/tiann/hapi/commit/7b00df458c55eb7f5bbd0e22a1d60e3b10358d34), 2026-10-15 14:42:01 UTC | Conversation backends, spoken status, permission tools, context synchronization |
| P4 | [HAPI Codex shared sessions guide](https://github.com/tiann/hapi/blob/main/docs/guide/codex-shared-sessions.md); [latest path commit](https://github.com/tiann/hapi/commit/917baf1201abeace1ddfab70512f1c4f3e9c1446), 2026-09-13 04:09:39 UTC | Codex >=0.154.0, app-server sharing and explicit lifecycle/recovery limitations |

Fetched readable HTML from TRAE and raw Markdown/MDX from the official repository paths above with `curl`/standard-library HTTP and HTML parsing. GitHub commit metadata was fetched from its public REST API with each exact source path. No competitor app was installed, authenticated or exercised. No private code, credentials or project content was sent to competitor services.
