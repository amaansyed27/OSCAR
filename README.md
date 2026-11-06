# OSCAR

**One intelligence. One continuing relationship. Many devices.**

**OSCAR** is Dawnlight Labs' personal AI project. The current Slice 01 provides a Windows conversation app with persistent history and personal memory. Tools, Workers, routines, mobile and cross-device operation belong to the broader [product vision](VISION.md), not this release.

OSCAR is intended to **help people, not replace their judgment or control**. It is designed around personal ownership, privacy-aware permissions, model freedom, a recognizable animated Orb, and a consistent experience across devices.

> **Name:** OSCAR is the established product name. Its official acronym expansion (full form) has **not yet been confirmed**; no expansion is asserted here.

## Project direction

- [VISION.md](VISION.md) — complete product vision, architecture, features, flows, and platform plans.
- [VISION-STATUS.md](VISION-STATUS.md) — capability-by-capability checklist for the new repository.

## Run Desktop (Slice 01, version 0.2.0)

Windows with Node.js 24+, npm, Rust stable (MSVC toolchain), Visual Studio C++ Build Tools and Microsoft Edge WebView2:

```powershell
cd D:\Programming\03_Projects\oscar
npm ci
npm start
```

For a fresh checkout, create `.env.local` from [.env.example](.env.example) and add a Groq key. Preserve an existing private configuration.

The first build downloads Rust dependencies. OSCAR runs as a Tauri 2 desktop window using Windows WebView2, with a Rust backend and no Node/Electron runtime. The existing HTML/CSS interface, local fonts and Orb are retained.

Build an optimized executable and Windows installer with `npm run build`. Outputs are `src-tauri/target/release/oscar-desktop.exe` and `src-tauri/target/release/bundle/nsis/OSCAR_0.2.0_x64-setup.exe`. Node/npm are development tools, not installed-app requirements. The installer is unsigned; installation and uninstall remain for owner review. Build outputs, test screenshots and local data are ignored by Git; the repository contains the source needed to regenerate them.

It reads `GROQ_API_KEY` or `GROQ_API_KEY_1` from the existing local `.env` / `.env.local` without changing either file. The default is Groq's `openai/gpt-oss-20b`; `openai/gpt-oss-120b` is also selectable. Other providers and automatic key rotation are not implemented. Internet access and available provider quota are required. No simulated replies or silent provider fallback. Account billing and quota remain controlled by Groq. `OSCAR_CONFIG_DIR` can select the folder holding the configuration. After a configured launch, its folder path is remembered in the local database so the installed app can reuse it; credentials are never copied into the bundle. Configuration-file values override matching process environment values; `.env.local` overrides `.env`. Set `OSCAR_CONFIG_DIR` and `OSCAR_DATA_DIR` in the launch environment.

## Conversation and memory

- **Conversation:** one saved conversation, streamed replies, Stop and Retry. Enter sends; Shift+Enter adds a line. Earlier messages load incrementally.
- **Memories:** search personal statements, inspect their sources, correct or forget them. Conversation history searches the complete archive with dates, relevance sorting, surrounding messages and a jump to the original position.
- **Settings:** searchable Appearance, Model, Memory and Data & privacy sections. System/Light/Dark appearance, model selection, automatic learning, context size and working-context reset. Choices persist.

The main icon sidebar expands using its bottom control. Settings and an inactive profile icon sit below it. Collapsed icons show hover/focus tooltips. Subtle transitions respect the system reduced-motion preference.

Normal turns use one foreground answer request. Ordinary memory learning runs afterwards in a durable background queue; explicit corrections and forgetting may need an additional request before answering. A reply's acknowledgement is not proof that background learning has committed: inspect Memories. Original user quotes are the memory evidence.

History, working state, source-linked extractive episode summaries, personal memory and draft live in `%APPDATA%\oscar\oscar.sqlite`. They stay independent of the provider. The Tauri migration makes an `oscar.before-tauri.sqlite` backup beside an existing database on first open and preserves the existing schema, records and source IDs. Earlier revision backups remain intact. Close OSCAR before manually copying its data folder. `OSCAR_DATA_DIR` selects an isolated folder for testing.

Relevant original passages, neighbouring messages, working state and selected memories are assembled locally. Balanced targets 16K input tokens; Compact and Extended target 8K and 32K. GPT-OSS text uses Harmony token accounting with a conservative framing margin and a separate 4K output/reasoning reserve. Actual provider usage is recorded. Inactivity can compact an episode without losing unfinished work. Summaries retain original message references and never replace the archive.

Corrections supersede old versions; explicit historical questions can recover dated prior statements. Forgetting excludes the recorded values and linked reply passages and invalidates derived summaries. Revision checks prevent delayed learning from restoring an outdated or forgotten fact. **Original chat remains readable and searchable.** Forget is not secure erasure of chat, SQLite pages, backups or provider-held data. Deleting original conversation data and export are not implemented.

The backend uses Tokio for asynchronous work, rusqlite with bundled SQLite/WAL/FTS5, Reqwest with Rustls for HTTPS streaming, and tiktoken-rs Harmony token accounting. Database/retrieval work uses the blocking pool, outside the WebView thread; remote requests do not hold the database lock. Cancellation and memory revision checks protect delayed work. There is no local HTTP server, Node sidecar or external database service.

The database is local and unencrypted. Selected excerpts and memories are sent to Groq. Keys remain in the Rust backend and are never exposed to the renderer. Provider quotas and billing remain controlled by Groq. Automatic classification and lexical retrieval can miss information or interpret it incorrectly; use the source, correction and forget controls. Legacy uncited paraphrases and broad semantic recall are not comprehensively verified.

## Verification

```powershell
npm test
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run test:desktop
npm run test:performance
npm run test:ui
# After npm run build:
npm run test:release
```

The desktop suite attaches to a loopback-only WebView2 debugging port in isolated test windows. Normal app launches do not enable this port. It launches real Tauri/WebView2 windows with isolated test data and calls the real provider. It uses quota. It covers persistence, streamed answers/cancellation, current and historical preferences, unrelated recall after forgetting, search/jump, model selection, themes, large history and error recovery. The transport-error test uses a loopback server that closes the connection, then retries against real Groq. Its optional `OSCAR_GROQ_ENDPOINT` override accepts HTTP loopback only; it is not used for normal launches.

`npm test` runs 23 Rust checks (19 LRA/storage checks and four transport checks). The development and release desktop suites require available Groq quota and must run one at a time with the normal app closed, because OSCAR enforces a single desktop instance.

`test:release` exercises the optimized executable with a real streamed reply, restart, memory and six screenshots in isolated data.

`test:ui` checks navigation, Settings search, tooltips, sidebar persistence, motion and reduced motion in isolated Tauri/WebView2 windows without provider calls. Its screenshots and interaction measurements go to `.oscar/motion-evidence/`.

Actual application screenshots and transcripts go to ignored `.oscar/revision-evidence/`; Rust release performance measurements go to `.oscar/tauri-evidence/performance.json`. Performance probes separate local retrieval/packing from provider latency; their synthetic results do not establish production-scale memory reliability.

Slice 01 revision is ready for owner review. No Workers, Automations, voice, onboarding or device sync are included. See [VISION-STATUS.md](VISION-STATUS.md) for verified scope and remaining limits.

Dawnlight Labs · India
