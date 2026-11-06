# OSCAR

**One intelligence. One continuing relationship. Many devices.**

**OSCAR** is Dawnlight Labs' general-purpose personal AI: a persistent, expressive intelligence that can reason, remember, converse, use authorized tools, coordinate delegated Workers, manage routines, and help its owner across desktop, mobile, and optional local or cloud hosts.

OSCAR is intended to **help people, not replace their judgment or control**. It is designed around personal ownership, privacy-aware permissions, model freedom, a recognizable animated Orb, and a consistent experience across devices.

> **Name:** OSCAR is the established product name. Its official acronym expansion (full form) has **not yet been confirmed**; no expansion is asserted here.

## Project direction

- [VISION.md](VISION.md) — complete product vision, architecture, features, flows, and platform plans.
- [VISION-STATUS.md](VISION-STATUS.md) — capability-by-capability checklist for the new repository.

## Run Desktop (Slice 01)

Windows with Node.js 24 or newer and npm:

```powershell
cd D:\Programming\03_Projects\oscar
npm ci
npm start
```

The first install/launch downloads Electron. OSCAR opens as a desktop window.
It reads `GROQ_API_KEY` or `GROQ_API_KEY_1` from the existing local `.env` / `.env.local` without changing either file. The default is Groq's `openai/gpt-oss-20b`. Internet access and available provider quota are required. No simulated replies or silent provider fallback. Account billing and quota remain controlled by Groq.

## Conversation and memory

- **Conversation:** one saved conversation, streamed replies, Stop and Retry. Enter sends; Shift+Enter adds a line. Earlier messages load incrementally.
- **Memories:** search personal statements, inspect their sources, correct or forget them. Conversation history searches the complete archive with dates, relevance sorting, surrounding messages and a jump to the original position.
- **Settings:** System/Light/Dark appearance, Groq model selection, automatic learning, context size and working-context reset. Appearance and model choices persist.

Normal turns use one foreground answer request. Ordinary memory learning runs afterwards in a durable background queue; explicit corrections and forgetting may need an additional request before answering. A reply's acknowledgement is not proof that background learning has committed: inspect Memories. Original user quotes are the memory evidence.

History, working state, source-linked extractive episode summaries, personal memory and draft live in `%APPDATA%\oscar\oscar.sqlite`. They stay independent of the provider. The migration makes a `before-revision` SQLite backup beside an existing database before updating its schema. Close OSCAR before manually copying its data folder. `OSCAR_DATA_DIR` selects an isolated folder for testing.

Relevant original passages, neighbouring messages, working state and selected memories are assembled locally. Balanced targets 16K input tokens; Compact and Extended target 8K and 32K. GPT-OSS text uses Harmony token accounting with a conservative framing margin and a separate 4K output/reasoning reserve. Actual provider usage is recorded. Inactivity can compact an episode without losing unfinished work. Summaries retain original message references and never replace the archive.

Corrections supersede old versions; explicit historical questions can recover dated prior statements. Forgetting excludes the recorded values and linked reply passages and invalidates derived summaries. Revision checks prevent delayed learning from restoring an outdated or forgotten fact. **Original chat remains readable and searchable.** Forget is not secure erasure of chat, SQLite pages, backups or provider-held data. Deleting original conversation data and export are not implemented.

The database is local and unencrypted. Selected excerpts and memories are sent to Groq. Keys remain in the backend worker and are never exposed to the renderer. Provider quotas and billing remain controlled by Groq. Automatic classification and lexical retrieval can miss information or interpret it incorrectly; use the source, correction and forget controls. Legacy uncited paraphrases and broad semantic recall are not comprehensively verified.

## Verification

```powershell
npm test
npm run test:desktop
npm run test:performance
```

The desktop suite launches real Electron windows with isolated test data and calls the real provider. It uses quota. It covers persistence, streamed answers/cancellation, current and historical preferences, unrelated recall after forgetting, search/jump, model selection, themes, large history and error recovery. The transport-error test uses a loopback server that closes the connection, then retries against real Groq. Its optional `OSCAR_GROQ_ENDPOINT` override accepts HTTP loopback only; it is not used for normal launches.

Actual application screenshots, transcripts and measurements go to ignored `.oscar/revision-evidence/`. Performance probes separate local retrieval/packing from provider latency; their synthetic results do not establish production-scale memory reliability.

Slice 01 revision is ready for owner review. No Workers, Automations, voice, onboarding, device sync or installer are included. See [VISION-STATUS.md](VISION-STATUS.md) for verified scope and remaining limits.

Dawnlight Labs · India
