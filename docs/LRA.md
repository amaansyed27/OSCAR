# OSCAR LRA

LRA is the continuity layer for OSCAR's single desktop conversation. It retains original chat and builds a bounded, source-linked context for each answer. The original expansion of “LRA” is unconfirmed.

## Storage and ownership

The Rust backend owns a SQLite database under the app data directory, normally `%APPDATA%\oscar\oscar.sqlite` on Windows. Use `OSCAR_DATA_DIR` to run against an isolated directory. SQLite uses WAL for persistence and FTS5 for lexical search. No external database or embedding service is involved. Existing databases are upgraded in place with migration backups where applicable. Close OSCAR before manually copying the data directory.

| Layer | Records | Purpose |
| --- | --- | --- |
| Archive | `messages`, `history_fts` | Original user and assistant turns, stable IDs, timestamps, and message status. |
| Personal memory | `memories`, `memory_search`, `exclusions` | Quoted user facts, scoped keys, replacement chains, search aliases, and exclusion rules. |
| Working continuity | `working`, `summaries`, `summary_fts` | Open and resolved work and source-linked extracts from older episodes. |
| Provenance and diagnostics | `turns`, `derived_claims`, `metrics`, `response_details` | Retrieval IDs, dependencies on memory, model usage, citations, and timing. |
| Lifecycle | `jobs`, `settings` | Pending learning, revision counters, display and context boundaries, and compaction progress. |

Start with [the database schema](../src-tauri/src/schema.sql) and [storage implementation](../src-tauri/src/store.rs). Some tables and columns are created or extended during startup migrations.

## From message to response

1. The frontend invokes the Tauri backend. The runtime stores the user turn as pending. A retry identifies the earlier turn and reuses its message ID.
2. Explicit corrections and forgetting requests can run extraction before the answer so the next context reflects an accepted change. Most learning occurs after the answer. Model and research selection can add independent provider calls, so foreground request counts vary by workflow.
3. The runtime chooses a model and reserves capacity for the current turn and output. It combines the configured input target with the available model budget and accounts for other prompt material, including personalization, research, and attachments. OSCAR uses Harmony token accounting for local packing and records actual provider token usage when supplied.
4. The store retrieves and filters memory and history. The runtime assembles bounded evidence, sends it to the selected provider, and streams the answer. Retrieved quotes are treated as evidence. The prompt asks the model to ground personal claims in original user statements and use source IDs.
5. The runtime checkpoints partial text during streaming. On success it finalizes messages and saves retrieval and usage metadata. Interruption can leave a partial response available for inspection. Startup recovers unfinished states. A changed memory revision can invalidate an answer assembled against older evidence.

See [the turn lifecycle and maintenance loop](../src-tauri/src/runtime.rs) and [model selection and budgets](../src-tauri/src/model.rs).

## Retrieval and packing

The packer builds an FTS query from the current message, expands a few common terms such as beverage and location vocabulary, and can append a short excerpt from the preceding completed user turn for references such as “this project.” It collects up to 24 recent completed messages, 12 ranked history hits, 12 matched memories, eight working records, and four valid episode summaries. These are candidate limits. The final prompt is smaller when evidence is irrelevant, excluded, redundant, or too large.

Recent turns are packed first with a 55% quota. Working state and personal facts follow, then ranked history with nearby messages, then matching episode extracts. History is deduplicated by message ID and emitted chronologically. Long messages can contribute a query-centered excerpt with character positions. Serialized records count against both per-item and total budgets. The packer returns the selected evidence, memory revision, and separate retrieval and packing timings.

Explicit historical wording can include superseded versions alongside current facts. Normal recall uses active memories. Original messages and dependent assistant passages pass through exclusion filtering before packing. The archive view can still display original messages. See [the context packer](../src-tauri/src/context.rs).

## Learning and provenance

For eligible completed user turns, the runtime queues a durable learning job if learning is enabled. A provider proposes structured updates. The backend checks the source role and exact quote, validates the scoped key and value, rejects stale revisions, and refuses an older source that would replace a newer fact. The source message remains the evidence. The quote establishes what the user said, while the inferred key and aliases determine how that statement is indexed.

Maintenance yields to foreground conversation. Interrupted jobs can return to pending. Failed jobs have a bounded retry count, and jobs made stale by exclusions cannot restore excluded facts. A later learning result is checked again before writing. The UI can report delayed learning. Inspect Memories to verify what was actually saved.

For example, an initial user statement about a preferred drink can create an active fact. A later correction under the same scope creates a linked version and supersedes the first. A historical question can retrieve the older version, subject to exclusions. Forgetting that memory suppresses the whole version chain from future recall.

## Compaction and controls

Compaction creates local, extractive summaries from completed user messages that match work and project cues. It tracks a cursor, scans up to 200 eligible rows per pass, leaves the newest eight IDs outside that pass, and retains up to 12 source-linked extracts per summary. It can run during maintenance after enough new history, or be forced by approximately two hours of inactivity or an accumulated token threshold. Working state separately tracks scoped work cues and explicit matching completion statements. Original history stays available. A correction or forget can invalidate summaries, which maintenance rebuilds from filtered sources.

| Action | Effect |
| --- | --- |
| Clear Chat | Advances the persistent display boundary. Earlier turns remain in the archive and can still inform recall. |
| Reset Working Context | Advances the recent-context boundary and clears tracked working state. Ranked archive retrieval and saved memory remain available. |
| Correct memory | Links a replacement version, marks the old fact superseded, and filters old evidence in ordinary recall. |
| Forget memory | Marks the scoped chain forgotten, records permanent exclusions, and invalidates affected derived evidence. |
| Disable learning | Stops automatic learning. Existing memories can still participate in retrieval. |

Forgetting is a recall policy. Original chat, backups, provider records, and exclusion data can retain the information. The local conversation database is unencrypted. Selected evidence goes to the answer provider, and eligible user text can go to a provider for extraction. Keep this distinction in mind when evaluating deletion or privacy requirements.

## Verification and limits

- Run `npm test` for storage and LRA fixtures, including exact-source validation, replacement ordering, scoped forget, delayed jobs, compaction, restart, pagination, and context budgets. See [LRA tests](../src-tauri/tests/lra.rs).
- Run `npm run test:desktop` for the native conversation suite with configured inference. Run `npm run test:slice02` for the native integration suite with a local transport fixture. Run native suites serially because OSCAR uses a single-instance guard.
- Run `npm run test:performance` to measure retrieval and packing separately over synthetic history. Those timings exclude the provider and renderer.
- To verify behavior manually, save a synthetic fact, inspect its source, restart, correct it, ask a historical question, forget it, and ask again. Verify the original turn stays in the archive and unrelated memory remains recallable. Repeat with an unfinished task and enough intervening turns to exercise compaction.

Lexical search can miss paraphrases and synonym-only queries. Automatic extraction, scope inference, and completion matching are fallible. Redaction relies on recorded phrases and known provenance, so untracked paraphrases can survive. Model replies may still make unsupported claims even when retrieval supplied valid citations. See the [Slice 02 evaluation](SLICE02-EVALUATION.md) for observed results and outstanding acceptance.
