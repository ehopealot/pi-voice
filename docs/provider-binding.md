# Provider binding and setup checks
Retrieved current public docs during implementation:
- https://elevenlabs.io/docs/agents-platform/customization/personalization/twilio-personalization.md — inbound initiation POST carries caller_id, called_number, agent_id, call_sid, conversation_id; supports configured secret authentication headers.
- https://elevenlabs.io/docs/agents-platform/customization/personalization/dynamic-variables.md — secret__ variables are header-only, not sent to LLM; warns post-call transcription webhooks receive originals. Do not send these to an untrusted logging destination.
- https://elevenlabs.io/docs/agents-platform/customization/tools/server-tools.md — dynamic headers, secret headers and model-generated body/path/query arguments. Hence never trust body caller_id/call_sid at tool endpoints.
- https://www.twilio.com/docs/voice/api/call-resource.md — authenticated Call lookup reports sid, account_sid, from, to, direction and status; in-progress means live.
- https://www.twilio.com/docs/usage/security.md — webhook signing/authentication is specific to Twilio requests. This bridge receives ElevenLabs requests, so it does NOT pretend X-Twilio-Signature authenticates them.

Design: initiation-only high-entropy static secret authenticates the provider, call metadata is corroborated via Twilio REST. A random capability returned ONLY via secret__pi_voice is bound to the call in server memory. Per-tool x-pi-voice header must be mapped from that variable, not authored by the model. Calls to /verify accept a candidate passphrase only, never identity fields. Body-supplied identities cannot select a different capability. Twilio status is fetched before every verification, read, and message. Inbound ringing is accepted only for initiation because the webhook may occur before connection.

Verify these requirements for each installation:
1. The initiation webhook carries all five documented fields and runs only for native inbound Twilio calls, not user-overridden web previews.
2. Header secret is available only on initiation, not configured on any agent tool or in prompts.
3. secret__pi_voice reaches dynamic headers without model exposure, is not user-overridable, and no tool response assignment can overwrite it. Disable overrides and public/web agent entrypoints where possible.
4. The supplied call_sid identifies the inbound Twilio resource accessible to the configured account/API key. Missing/child/outbound mismatches must fail, not be relaxed.
5. Twilio live-state propagation delay and network latency are acceptable. A call ending immediately after the lookup cannot be revoked atomically with local delivery. TTL caps capability life at 15 minutes.
6. Disable/minimize provider recording/transcript retention if possible. The spoken passphrase necessarily reaches speech recognition and may reach the voice model. This is not phishing-resistant or replay-resistant MFA.

Local same-UID attackers can read IPC or configuration and are out of scope. Tunnel confidentiality does not authenticate the caller.

Installed code inspected read-only: tmux-visor provides lifecycle waiting flags but not messaging; pi-subagents provides fleet inspection and async controls specific to its run registry. Rather than depend on internal/private registry APIs, this package uses the public Pi extension API. Every workstream to be directly addressed must explicitly load this extension (including children if desired); uninstrumented tmux sessions are not silently reported as observed.

## Automatic excerpt revision
Owner expressly authorized sharing recent user/visible assistant text with ElevenLabs. This does not relax provider call binding or read authentication. Excerpts come only from opted-in Pi active-branch messages and completed message events. `/verify` candidate phrases are neither Pi messages nor stored in any excerpt structure. The bridge does not echo them or log request bodies. This is source separation, not a claim to detect secrets in arbitrary work conversations. Ordinary phone-delivered instructions remain user excerpts. Provider configuration must never relay the authentication transcript into a Pi work instruction.

Pi extraction references inspected: installed docs/message-types.md, docs/session-format.md, and dist/core/extensions/types.d.ts for MessageEndEvent, SessionTreeEvent and session_compact. User content supports string or text/image arrays; assistant content supports text/thinking/toolCall arrays. Only explicit text blocks are copied, never metadata/signatures, tool arguments/results or hidden reasoning. Tests use these exact shapes and rebuild active-branch excerpts on navigation.

## Independent review corrections: public Pi delivery semantics
Verified installed `dist/core/extensions/types.d.ts` declares `sendUserMessage(...): void`. `dist/core/agent-session.js` runtime binding calls `this.sendUserMessage(...).catch(...)` and reports errors to runtime diagnostics, not the extension caller. Therefore normal return is only `submitted_unconfirmed`, never evidence of accepted/queued/ingested work; synchronous throw is `indeterminate`. Both retain the ID ledger and `acted:false`, with no automatic retry. The reply-wait flow can separately observe correlated visible assistant output; see [reply waiting](wait-for-reply.md).

Verified installed `AgentSession.prompt` awaits `_runInputHandlers` before checking streaming again. Always supply `deliverAs:'followUp'` so an initially idle session becoming busy during a hook queues rather than rejecting for missing streaming behavior. The regression test invokes installed `AgentSession.sendUserMessage`/`prompt` methods on a bounded adapter that yields at the real input-hook boundary and flips streaming before releasing it. No model/session startup or secrets are needed.

Review regression tests also release two deferred provider lookups with 99 existing records; capacity is rechecked immediately after lookup and before synchronous insertion, admitting only one. The installed Pi loader smoke loads this extension factory only (no session activation). `PI_CODING_AGENT_ROOT` can specify another installed package root for these host integration tests; otherwise they derive the package from the `pi` binary beside Node.

For setup, demonstrate native inbound initiation authenticity, header isolation and Twilio SID/account/number binding before publishing a route; exercise real message delivery and observe actual ingestion separately from submission receipts.
