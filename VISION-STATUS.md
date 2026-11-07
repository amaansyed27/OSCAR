# OSCAR — Vision Status Checklist

**Repository:** [amaansyed27/OSCAR](https://github.com/amaansyed27/OSCAR)  
**Current implementation:** version 0.3.0, Tauri 2/Rust Windows Desktop. [Slice 02 evaluation](docs/SLICE02-EVALUATION.md). Owner approval and installer acceptance remain pending.
**Starting baseline:** Fresh repository, documentation first.  
**Truth rule:** An unchecked broad capability box means **not yet fully implemented, verified and accepted in this new repository**. Scoped engineering results are recorded below; they do not imply acceptance of the whole capability. It does **not** imply the legacy OSCAR codebase lacked the feature. Reuse is possible after an explicit evaluation.

> This is an owner-facing product checklist, **not** a promise that everything can be completed in a few days. Only mark a feature complete when it has a working, accepted end-to-end path. Sub-features may move to separate feature records as work begins.

## 0. Product foundation
- [ ] Owner agrees on first vertical slice, scope and acceptance criteria.
- [ ] Approve canonical visual system using the preserved Mobile UI and smooth animated Orb.
- [ ] Define minimally sufficient architecture for one Core, one identity and one canonical memory.
- [ ] Audit legacy modules and explicitly select which existing components to transplant.
- [ ] Establish reliable small-feature build/test/manual-approval loop.
- [ ] Confirm official OSCAR full-form wording, if an acronym expansion is intended.

## 1. Core intelligence
- [ ] Persistent OSCAR Core with durable identity, ownership and task continuity.
- [ ] Decision Model (evaluate free/open candidate models plus deterministic policies; no model selected yet).
- [ ] Manual/automatic Model Router, local inference and cloud providers.
- [ ] Free-tier eligibility, optional paid models, privacy/cost controls, routing fallback and observable usage.
- [ ] Executive planning, unfamiliar-goal decomposition, tool use, recovery and verified outcomes.
- [ ] World Model with permitted, timely device/task/environment context.
- [ ] Capability discovery and authenticated cross-device invocation.

## 2. Memory Fabric / LRA
- [ ] Durable episodic/conversation/event history.
- [ ] Relevant semantic/entity/preference/temporal retrieval.
- [ ] Personalization and persistent context across sessions.
- [ ] Correction retention and verified procedural learning.
- [ ] Memory provenance, inspection, editing/forgetting and retention controls.
- [ ] Cross-device continuity, backup/restore and host migration.

## 3. Windows Desktop
- [ ] Preserve/adapt canonical animated Orb and expressive Companion.
- [ ] Rebuild Workspace Conversation with the approved Mobile design identity.
- [ ] Dedicated Agents/Workers tab.
- [ ] Separate Automations tab.
- [ ] Unified Activity with real outcome evidence.
- [ ] Devices/Connections surface.
- [ ] Preferences and reopenable Setup Studio.
- [ ] Real Windows app, file, shell, screen and browser interactions.
- [ ] Accessible responsive layouts, transitions and expressive states.
- [ ] Packaged Windows installation, startup, update and recovery tested by owner.

## 4. Android / Sunday
- [ ] Evaluate and transplant approved native Mobile UI without regressing its identity.
- [ ] Canonical shared conversation, context and Memory Fabric.
- [ ] Authenticated Android enrollment and pairing.
- [ ] Native voice, notifications and explicitly authorized phone/device features.
- [ ] Display/control Workers, Automations, approvals and activity.
- [ ] Background behavior, offline/online recovery and OEM permission checks.
- [ ] Build/install/launch and owner acceptance on an actual Android device.

## 5. Workers / Agents
- [ ] Create and configure named, independently inspectable Workers.
- [ ] Dedicated Worker conversation/context, goals, tools and scope.
- [ ] Temporary and persistent execution with checkpoints.
- [ ] Concurrent execution, delegation and durable resume.
- [ ] OSCAR can supervise, redirect, pause, resume, cancel and retire Workers.
- [ ] Worker permissions, budgets, audit history and verified results.
- [ ] Worker presentation feels like part of OSCAR, not a separate assistant product.

## 6. Automations
- [ ] Create/edit/pause/remove one-time and recurring OSCAR-owned routines.
- [ ] Event/condition triggers, reminders and monitoring.
- [ ] OSCAR can directly execute an Automation.
- [ ] OSCAR can delegate an Automation's work to a Worker.
- [ ] Execution history, failures, notifications and owner visibility.

## 7. Voice, Sentry and Chief of Staff
- [ ] Permission-aware speech recognition and expressive speech synthesis.
- [ ] Voice activation/conversational pacing, interruptibility and appropriate consent.
- [ ] Configurable persona and Voice Identity.
- [ ] Opt-in Sentry context capture, awareness, alerts and revocation.
- [ ] Chief of Staff for calendar, mail, tasks, commitments, briefings and follow-up.
- [ ] Verified real-device and real-account acceptance for enabled features.

## 8. External capabilities and safety
- [ ] Multi-account connections, provider authentication, OAuth and revocation.
- [ ] MCP/plugin discovery and real, scoped tool execution.
- [ ] Optional dedicated OSCAR accounts where permitted.
- [ ] Ask/Secure/Full authority modes with reliable, testable boundaries.
- [ ] Separate capture, retention and action permissions.
- [ ] Secure secrets storage, provenance, trustworthy audit logs and sensitive-action confirmation.

## 9. Hosting and connection grid
- [ ] Local-only Desktop Core configuration.
- [ ] Android connects to the same authoritative Core.
- [ ] Optional old-laptop/home-server Core host, installation and migration.
- [ ] Optional Oracle Cloud Always Free hosting, subject to current availability and quotas.
- [ ] Secure Cloud–Desktop–Android authenticated sync and remote action routing.
- [ ] Clear host-of-record ownership, recovery, re-enrollment and backups.
- [ ] Optional relay/API services without duplicating identity or memory.

## 10. First-run experience and distribution
- [ ] Cinematic, skippable/replayable introduction with canonical Orb.
- [ ] Personalization and identity/voice selection.
- [ ] Guided local/free/paid model configuration and safe provider credential entry.
- [ ] Genuine first objective completed during setup.
- [ ] Guided accounts, permissions, tools and device pairing.
- [ ] Setup Studio for progressive advanced configuration.
- [ ] Installer/package and app-launch acceptance across supported surfaces.
- [ ] Owner verifies end-to-end flow: setup -> request -> delegation/action -> result -> memory -> resume on another device.

## 11. Future hardware (physical commissioning deferred)
- [ ] Approve later old dedicated home-server hardware activation, if separate from software hosting.
- [ ] ESP32/Pico/other Edge device commissioning and real-world safety evaluation.
- [ ] Optional Home Node, wearable/smart-glasses and other physical surfaces.

---

## Status update procedure

For each completed checkbox record in a commit, issue or short feature note:

- **Working path:** What the owner can actually do.
- **Evidence:** Code revision, real build/device/provider, and reproducible verification.
- **Owner acceptance:** Accepted, needs revision, or blocked.
- **Caveats:** Missing platforms, permissions, integrations or remaining defects.

Do **not** mark an entire capability complete solely because code was copied from [legacy OSCAR](https://github.com/Amaan27-Buzz/oscar), a test passed, or an installer was produced.

## Slice 01 — Desktop conversation (2026-11-06)

**Initial engineering checks passed; the owner rejected the initial UI.** This historical record is superseded by the revision below. The broad capability checkboxes above remain unaccepted and include work beyond this slice.

- [x] One persistent chronological conversation in a runnable Electron desktop window, with paged history and full-text search.
- [x] Separate SQLite chat history, bounded active context and personal memory. Resetting working context retains history and memory; two-hour inactivity rollover is covered by a focused test.
- [x] Real Groq `openai/gpt-oss-20b` responses using the existing local configuration. Credentials stayed unchanged and outside Git.
- [x] Exact user-quote memories with source references, automatic preference learning/correction, manual inspection/correction and forgetting. Superseded/forgotten sources and derived replies are excluded from future context; original history remains readable.
- [x] Canonical SVG Orb, local Neuhade/AZONIX typography, paper/graphite conversation layout and reduced-motion behavior. Adapted from the retained Mobile conversation composition; owner visual approval is pending.

**Evidence:** `npm test` passes 8 focused checks. `npm run test:desktop` launches the real Windows Electron app and real provider with isolated data. It passed restart/continue, older recall, preference persistence/correction, manual correction, forget/restart and long-history checks. The final run held 3,017 messages; answer prompts ranged from 275 to 450 tokens, and older archive recall used 353 tokens. Screenshots and the run transcript are local under ignored `.oscar/evidence/`. Search/source viewing, context reset, reduced motion and a 640px layout were also checked in the actual app. A controlled transport failure produced a retryable user message; retry then used the real model without duplication. Oversized input stayed in the composer. The first post-inactivity message remained in active context. The archive code was introduced through the real conversation before the 3,000 synthetic intervening history records were added.

**Limits:** Full-text retrieval needs overlapping words and can miss paraphrases. Automatic memory classification can miss or misclassify statements; saved content is an exact user quote, and manual controls remain available. Two provider requests per turn can encounter quota/network errors; the UI reports failures. Working context uses bounded excerpts, not generated summaries or a 250K-token buffer. Forget is retrieval suppression, not deletion of original chat history. Storage is local and unencrypted. No streaming, installer, sync or other product screens are included.

Earlier verification caught a retired-model 404, citation formatting/source-ID issues and an intermittent memory-update warning. The supported model, explicit source references, citation normalization and strict extraction schema were applied before the final passing run. An initially overstrict check rejected a valid comparison of the new preference with the old one; the check now verifies the recommendation and the superseded-source rules separately.

## Slice 01 revision — Simple Desktop UI and LRA (2026-11-06)

*Historical Electron implementation; superseded by the Tauri migration below.*

**Engineering verification passed; owner visual and product acceptance pending.** This revises the existing Electron application and preserves its original database and credentials.

- [x] Exactly three pages: Conversation, Memories and Settings. Narrow responsive navigation; canonical SVG Orb; local Neuhade, identity-only AZONIX and DM Mono for code.
- [x] Neutral light/dark themes, System default and persisted selection. Theme controls and context reset exist only in Settings.
- [x] Real streamed responses, stopping, partial-response recovery, retry without duplicated user turns, Markdown/code/tables and preserved reading position.
- [x] Dedicated searchable personal memory and complete chronological history, date/relevance filtering, indexed pagination, surrounding messages and jumps to the original conversation.
- [x] Existing SQLite data backed up before schema migration. Database/retrieval/model work runs in an application-owned worker thread. Original messages remain intact.
- [x] One foreground model request for ordinary turns; explicit memory changes may need a second request. Ordinary extraction runs in a persistent maintenance queue. Both exposed GPT-OSS models were exercised against real Groq.
- [x] Four logical layers: original history, bounded active context, source-linked extractive episode summaries/working state, and scoped personal memory. GPT-OSS Harmony text counts plus conservative framing/output reserves; Compact/Balanced/Extended input budgets.
- [x] Lexical passages with neighbours, entity/topic aliases, dated current/superseded memories and exact source references. No vector service or embeddings were added.
- [x] More precise forgetting: value/source exclusions and derived reply spans instead of broad recursive suppression. Original archive remains human-readable. Revision and source-order checks reject stale updates, while unrelated queued facts remain eligible. Redacted clauses are removed from answer context.
- [x] Compaction retains unfinished work and original source references. Explicit matching completion statements close working notes; ambiguous completion is not a task-execution engine.

**Tests executed:** `npm test` passes 27 focused checks, including legacy migration/backup, partial/interrupted recovery, stale job rejection, unrelated recall after forgetting, source-linked paraphrase exclusion, exact-quote provenance, current/historical preferences, long-message passages, relevance pagination, token limits and unfinished-work preservation.

`npm run test:desktop` runs the actual Windows Electron application with isolated data and real Groq calls. It verifies restart continuity; committed preference learning/correction; historical and paraphrased recall; forgetting while keeping an unrelated active memory; archive recall and unfinished work across 10,000 synthetic intervening messages; actual stream deltas; cancellation and saved partial text after restart; real model switching; source search/jump; light/dark/System themes; persisted settings; and a renderer that continues painting while the backend searches. The transport test deliberately closes a loopback connection, then restarts and retries against real Groq with one original user turn.

Actual screenshots cover all three populated pages in both themes at 1536×900 and smaller 760×700 layouts. Local fonts were verified loaded, including DM Mono for code. Long Markdown, code and tables, focus, reduced motion, scrolling and meaningful confirmation controls were checked. Light/dark body, secondary-text and control-boundary contrast checks passed; all three pages also passed a 200% zoom/reflow check at a 760px window. Full screen-reader conformance was not audited. These are runtime screenshots, not generated mockups. Receipts and images are under ignored `.oscar/revision-evidence/`.

**Observed performance:** `npm run test:performance` measures 100,001 synthetic records under a warm cache. Latest p95 local retrieval was 1.02 ms for a specific query and 116.71 ms for a broad query; packing was 0.23 ms and 8.36 ms respectively. The 8K/16K/32K probe retained the original historical source at every budget and carried 5/11/22 recent long messages. Provider timing is separate in per-turn metrics; quota cooldowns are not included in these local measurements. These results are not production-scale recall-quality proof.

**Failures retained and corrected during verification:** initial tests encoded the old broad-suppression/inactivity behavior; a background-memory test wait returned too early; a search pagination assertion ran before its asynchronous result; an initial cancellation check waited for stream text after a provider failure. Those checks were corrected and rerun. Groq rate limits occurred in real runs and were recovered by retrying the same turn after cooldown. A redaction marker appeared in an early answer; answer-context filtering and a focused real-provider abstention check corrected that presentation.

**Remaining limits:** retrieval and redaction are lexical, with recorded source/span dependencies; broad semantic recall and uncited legacy paraphrases are not comprehensively verified. Automatic memory classification and deterministic working-note extraction can miss or misinterpret information. Summaries are extractive source projections, not a complete semantic world model. Background learning can be delayed or fail under quota/network limits; manual source-based memory controls remain available. Storage and retained backups are unencrypted. Forgetting is not secure erasure of original chat, backups or provider data. No export/delete UI, installer, voice, Workers, Automations, sync or other product screens are included.

**State at this stage:** Slice 01 revision was runnable and engineering-verified, pending owner review. The current runtime is recorded in the Tauri migration below.

## Slice 01 navigation and motion refinement (2026-11-06)

*Historical Electron verification; the same controls were rechecked in Tauri below.*

- [x] Expandable icon navigation with persisted width, hover/focus tooltips, bottom Settings and an intentionally inactive profile icon.
- [x] Dedicated searchable Settings navigation for Appearance, Model, Memory and Data & privacy, with existing working controls.
- [x] Subtle page/message arrivals, composer resizing and sidebar transitions, with reduced-motion support.

**Verification:** `npm run test:ui` passed actual Electron interaction checks for sidebar placement/persistence, tooltips/Escape, inert profile, Settings search/keyboard navigation, rapid page changes, composer resizing, light/dark layouts at 1536×900, smaller 760×700 layout and reduced motion. Animation sampling confirmed intermediate sidebar widths; it is not a general performance benchmark. Screenshots are in ignored `.oscar/motion-evidence/`. Owner acceptance remains pending; LRA behavior is unchanged by this refinement.

## Slice 01 — Tauri/Rust migration (2026-11-06)

**The current runtime is Tauri 2 with a Rust backend. Earlier Electron evidence above is historical. Owner acceptance remains pending.**

- [x] Kept the existing Conversation, Memories and categorized Settings interface, themes, fonts, navigation and expressive Orb. UI styles are unchanged.
- [x] Replaced Electron IPC and the Node backend with Tauri commands, Tokio, rusqlite/SQLite FTS5, Reqwest/Rustls and Harmony token accounting. No Node sidecar or local HTTP service.
- [x] Retained the existing `%APPDATA%/oscar/oscar.sqlite` location, schema and source IDs, with a first-open `oscar.before-tauri.sqlite` backup. Configuration stays external and its folder can be selected through `OSCAR_CONFIG_DIR`.
- [x] Ported source-backed memory, revisions/exclusions, delayed-job protection, extractive compaction/working state, bounded retrieval, streaming, stopping, checkpoints and retry recovery.
- [x] Removed retired Electron/backend files and dependencies. Rust tests replace the old Node backend tests; browser checks now exercise actual Tauri/WebView2 windows. A minimal SQLite fixture helper only seeds isolated test data.

**Verification:** 23 Rust tests cover storage/migration, exact provenance, correction and historical facts, selective forgetting, delayed updates, compaction/inactivity/unfinished work, Unicode offsets, source passages, pagination/budgets, fragmented streaming, cancellation and provider errors. Clippy passed with warnings treated as errors. Actual desktop checks used real Groq for restart, preference learning/correction/forgetting, unrelated recall, older history across 10,000 intervening messages, source jumps, streaming/cancellation and saved partial replies, model selection, Markdown, theme persistence and network-failure/retry without duplicate user turns. Screenshots cover all three pages in both themes and smaller layouts. UI interaction checks also passed tooltips, rapid navigation, Settings search, sidebar persistence and reduced motion. The migration fixes pending-search pagination and converts native errors for the existing retry UI.

**Measured local retrieval:** release-mode synthetic 100,001-record test, 20 warm samples. Specific lookup p95 retrieval 0.98 ms and packing 0.25 ms; broad query p95 retrieval 52.65 ms and packing 3.70 ms. The original source remained available under 8K/16K/32K budgets. These are local synthetic measurements, not an AI speed comparison or production-scale reliability guarantee.

**Delivery/limits:** optimized Windows executable (19.71 MiB) and NSIS installer (5.82 MiB) built. `npm run test:release` verified the actual release executable, real streaming, restart, source-backed memory, local fonts and all six theme screenshots in `.oscar/tauri-evidence/`. `npm start` also launched the development app. WebView2 is required. Installer signing and owner install/uninstall acceptance are not complete. Existing lexical recall, fallible automatic extraction, provider quota and unencrypted local storage limitations remain. No new product features or framework performance claims are implied. Stop for owner review.

## Slice 01 — Hover navigation (2026-11-07)

- [x] Sidebar opens transiently on hover or keyboard focus; leaving navigation collapses it unless pinned.
- [x] Top pin beside the wordmark persists across restarts; unpinning restores hover behavior. Old expansion preferences do not silently pin the sidebar.

**Verification:** actual Tauri UI checks passed hover enter/leave, animated width, pin/unpin and restart persistence, keyboard navigation, tooltip/Escape, rapid page changes, Settings search, light/dark screenshots, smaller layouts and reduced motion. Owner acceptance remains pending.

## Slice 02 — Cloud conversation (2026-11-07)

- [x] Configured-provider metadata discovery, numbered credential import and Windows-protected Settings records checked. Live discovery covered six inference accounts and Tavily.
- [x] OpenRouter free text, document and image replies streamed in the app. The release check verified an ordered fallback within a zero spending ceiling, usage recording and restart persistence.
- [x] Live Tavily research returned source-linked evidence. Local checks covered URL validation, budgets and citation allowlists.
- [x] Attachment import and previews, native interactive response rendering and profile persistence checked in Tauri. Captured both themes and a narrow window.
- [x] Clear Chat preserves recall and the full archive. Verified token and idle compaction, original source retention, correction and forget isolation, and bounded retrieval over 100,001 synthetic records.

The 50 Rust checks, Clippy, desktop integration and release smoke passed. Broad provider and model coverage remains conditional on account-level verification. The [evaluation](docs/SLICE02-EVALUATION.md) records measured results, open gaps and screenshots.
