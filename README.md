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

- Enter sends; Shift+Enter adds a line. Failed or interrupted messages have Retry.
- Search and Earlier messages recover the single chronological conversation.
- Memory opens personal statements with their sources, correction and forgetting controls. A message's source button also offers Remember this.
- Reset context keeps history and memory. After two hours of inactivity the working window resets invisibly; relevant older excerpts can still be retrieved.
- Corrections replace the active memory. Forget removes it from retrieval and suppresses its source versions and replies derived from them. **Original chat history remains readable and searchable.** Forget is not a secure erasure of the conversation or SQLite file.

History, personal memory and draft live in `%APPDATA%\oscar\oscar.sqlite`, separate from source and credentials. Close OSCAR before backing up its data folder. `OSCAR_DATA_DIR` can select a separate data folder for testing. Data is local and unencrypted; selected conversation excerpts and memory statements are sent to Groq to answer. Keys stay in the main process.

SQLite is the only store. Full-text search retrieves matching older excerpts; recent messages and relevant personal statements form a bounded working context. Automatic memory keeps exact user quotes rather than model-written facts. It can still miss or misclassify a statement; inspect and correct it in Memory. Each message uses one extraction request and one answer request.

## Verification

```powershell
npm test
npm run test:desktop
```

The desktop check launches the actual Electron app with isolated data and calls the real configured model. It uses provider quota and demonstrates restart continuity, preference learning/correction, manual correction, forgetting after restart, search and older-history recall across 3,000 intervening messages. Local screenshots and results go to ignored `.oscar/evidence/`.

Slice 01 is ready for owner testing. Retrieval is lexical rather than semantic, answers are not streamed, and this is a development launch rather than a signed installer. No voice, Workers, Automations, onboarding, device sync or other screens are included. See [VISION-STATUS.md](VISION-STATUS.md) for verified scope and pending owner acceptance.

Dawnlight Labs · India
