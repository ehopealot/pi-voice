# Pi Voice Implementation Plan
> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.
**Goal:** Build a bounded, authenticated local Pi observation/messaging bridge without deployment.
**Architecture:** Dependency-free Node HTTP bridge, per-process private Unix IPC, Pi public lifecycle and follow-up API. Provider metadata is admitted only at an independently authenticated initiation endpoint and corroborated with Twilio REST.
**Tech Stack:** Node 22+ ESM, node:test, public Pi extension API.

### Task 1: Security core
Create src/bridge.mjs and test/bridge.test.mjs. Write failing tests for unauthorized reads, forged metadata, wrong passphrase/lockout, expiry, ended calls, provider failure and initiation replay. Run `npm test` (red), implement smallest handler, rerun green.
### Task 2: Pi IPC
Create src/agent.mjs, extensions/voice.mjs and test/agent.test.mjs. Mock Pi events only; exercise real Unix sockets. Test mode bits, followUp, stale status, duplicate/conflicting IDs, bounded progress, shutdown. Run red then green. Use session_start/shutdown lifecycle, never factory sockets.
### Task 3: Wiring and operator docs
Create src/main.mjs, config.example.json, README.md, docs/provider-binding.md. Validate config and no-secret error handling, localhost binding, request bounds/timeouts. Run all tests and syntax checks. Document private setup and future provider gates; no commits or deployment.

### Revised requirement delta: automatic excerpts
Create src/excerpts.mjs and test/excerpts.test.mjs after reading installed Pi message-types.md and extension message_end/session_tree/session_compact contracts. Test actual user string/array and assistant text/thinking/toolCall block shapes, role exclusion, terminal-message filtering and count/text bounds first. Extend extensions/voice.mjs to hydrate active branch at start, append completed messages and rebuild on navigation/compaction. Extend src/agent.mjs status to retain bounded allowlisted recentMessages through heartbeats, increase bounded IPC response allowance to 64 KiB for worst-case JSON escaping. Add real-socket lifecycle/status tests and HTTP verification isolation test; rerun all tests and syntax checks. Update docs to explicitly supersede manual-only behavior. Parent orchestrator owns the required independent read-only review; worker must not launch reviewers.

### Independent review repairs
Read receiving-code-review/TDD skills and verify installed Pi types/runtime first. Add test/review-regressions.test.mjs for async runtime failure behind void public API, installed prompt idle→busy hook race, deferred provider lookup capacity race and installed loader smoke. Run regressions red (three expected failures), then change src/agent.mjs receipt to submitted_unconfirmed, extensions/voice.mjs unconditional followUp, and src/bridge.mjs post-await capacity recheck. Preserve uncertainty dedup, update existing test expectations/docs, run full suite and syntax checks. No live extension activation/services or provider changes.
