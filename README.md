# OSCAR

**One intelligence. One continuing relationship. Many devices.**

**OSCAR** is Dawnlight Labs' personal AI project. Slice 02 adds cloud model routing, file and image input, live research, rich responses and personalization to the Windows conversation app. See the [evaluation](docs/SLICE02-EVALUATION.md) for live verification and remaining limits.

OSCAR is intended to **help people, not replace their judgment or control**. It is designed around personal ownership, privacy-aware permissions, model freedom, a recognizable animated Orb, and a consistent experience across devices.

> **Name:** OSCAR is the established product name. Its official acronym expansion (full form) has **not yet been confirmed**; no expansion is asserted here.

## Project direction

- [VISION.md](VISION.md) — complete product vision, architecture, features, flows, and platform plans.
- [VISION-STATUS.md](VISION-STATUS.md) — capability-by-capability checklist for the new repository.

## Run Desktop (Slice 02, version 0.3.0)

Windows with Node.js 24+, npm, Rust stable (MSVC toolchain), Visual Studio C++ Build Tools and Microsoft Edge WebView2:

```powershell
cd D:\Programming\03_Projects\oscar
npm ci
npm start
```

For a fresh checkout, create `.env.local` from [.env.example](.env.example) and add your configured provider credentials, or add them under Settings → AI Providers. Keep an existing private configuration in place.

The first build downloads Rust dependencies. OSCAR runs as a Tauri 2 desktop window using Windows WebView2, with a Rust backend and no Node/Electron runtime. The existing HTML/CSS interface, local fonts and Orb are retained.

Build an optimized executable and Windows installer with `npm run build`. Outputs are `src-tauri/target/release/oscar-desktop.exe` and `src-tauri/target/release/bundle/nsis/OSCAR_0.3.0_x64-setup.exe`. Node/npm are development tools, not installed-app requirements. The installer is unsigned; installation and uninstall remain for owner review. Build outputs, test screenshots and local data are ignored by Git; the repository contains the source needed to regenerate them.

OSCAR imports numbered credential slots from `.env` and `.env.local`. Configuration files override matching process values, and `.env.local` takes precedence. Credentials added in Settings use Windows DPAPI. `OSCAR_CONFIG_DIR` selects the configuration directory. The app remembers this directory for later installed launches. `OSCAR_DATA_DIR` selects a separate local data directory for testing.

The existing Groq selection is the default for a fresh profile. To use OpenRouter Free, refresh OpenRouter in AI Providers, enable a currently verified free model, then choose **Auto · Free** in the composer. Efficient needs known prices. Super needs a recorded quality rating. A manual selection can use an ordered fallback list. Set a per-answer spending ceiling in Settings → Model. Providers can impose their own availability and account limits.

## Conversation and memory

- **Conversation** includes streamed replies, Stop and Retry, model and search choices, attachments and source previews. Enter sends. Shift+Enter adds a line. Clear Chat hides older turns from the main view and keeps the underlying context, personal memories and searchable archive.
- **Memories:** search personal statements, inspect their sources, correct or forget them. Conversation history searches the complete archive with dates, relevance sorting, surrounding messages and a jump to the original position.
- **Settings** includes Providers, Personalization, Appearance, Models & routing, Memory and Data & privacy. Choose themes, routing, response preferences, learning and working-context controls. Choices persist.

The main icon sidebar expands on hover and collapses when the pointer leaves. Keyboard focus also reveals navigation. The pin beside the OSCAR wordmark keeps it open across restarts; unpinning restores automatic collapse. Settings and an inactive profile icon remain at the bottom. Icon controls show tooltips where labels are absent. Subtle transitions respect the system reduced-motion preference.

Ordinary clear requests use one foreground answer request. Ambiguous requests can first use an enabled, freshly verified zero-price Decision Model with an eight-second timeout; unavailable classification falls back to local rules. Ordinary memory learning runs afterwards in a durable background queue; explicit corrections and forgetting may need an additional request before answering. A reply's acknowledgement is not proof that background learning has committed: inspect Memories. Original user quotes are the memory evidence.

History, working state, source-linked extractive episode summaries, personal memory and draft live in `%APPDATA%\oscar\oscar.sqlite`. They stay independent of the provider. The Tauri migration makes an `oscar.before-tauri.sqlite` backup beside an existing database on first open and preserves the existing schema, records and source IDs. Earlier revision backups remain intact. Close OSCAR before manually copying its data folder. `OSCAR_DATA_DIR` selects an isolated folder for testing.

Relevant original passages, neighbouring messages, working state and selected memories are assembled locally. Balanced targets 16K input tokens; Compact and Extended target 8K and 32K. GPT-OSS text uses Harmony token accounting with a conservative framing margin and a separate 4K output/reasoning reserve. Actual provider usage is recorded. Inactivity or accumulated tokens can compact an episode. Working notes and original sources preserve unfinished work. Summaries retain original message references and never replace the archive.

Corrections supersede old versions; explicit historical questions can recover dated prior statements. Forgetting excludes the recorded values and linked reply passages and invalidates derived summaries. Revision checks prevent delayed learning from restoring an outdated or forgotten fact. **Original chat remains readable and searchable.** Forget is not secure erasure of chat, SQLite pages, backups or provider-held data. Deleting original conversation data and export are not implemented.

The backend uses Tokio for asynchronous work, rusqlite with bundled SQLite/WAL/FTS5, Reqwest with Rustls for HTTPS streaming, and tiktoken-rs Harmony token accounting. Database/retrieval work uses the blocking pool, outside the WebView thread; remote requests do not hold the database lock. Cancellation and memory revision checks protect delayed work. There is no local HTTP server, Node sidecar or external database service.

Conversation storage is local and unencrypted. The selected cloud provider receives relevant excerpts, memories and attachment input. Tavily receives search queries when research runs. Saved credentials stay in the Rust backend. Each provider controls quotas and billing. Automatic classification and lexical retrieval can miss information or interpret it incorrectly; use the source, correction and forget controls. Legacy uncited paraphrases and broad semantic recall are not comprehensively verified.

## Verification

```powershell
npm test
npm run test:slice02
npm run test:ui
node tests/settings-review.cjs
npm run test:performance
npm run build
npm run test:release
```

Run desktop checks one at a time with OSCAR closed. The tests use isolated local data. `test:slice02` exercises the actual desktop UI, attachment parsers and a loopback transport fixture. `test:release` requires a configured OpenRouter credential and current availability of its named zero-price model. It checks streaming, fallback under a zero spending ceiling and restart, and captures both themes. The earlier `test:desktop` suite can call the configured inference account and use billable quota.

Screenshots and local receipts go to `.oscar/slice02-evidence/`. The 100K-history probe records local retrieval and packing separately in `.oscar/tauri-evidence/performance.json`. See the [Slice 02 evaluation](docs/SLICE02-EVALUATION.md) for results, provider coverage and the owner review boundary.

Dawnlight Labs · India

Additional bounded live checks: `node tests/cloud-live.cjs` verifies every enabled credential slot, zero-price routing, document injection handling and research. `node tests/cloud-followup.cjs` verifies custom Anthropic compatibility, ambiguous classification and comparison research. Both use isolated data and included search quota; provider availability may change.
