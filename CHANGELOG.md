# Changelog

## 2026-11-06 — Tauri migration

- Switched the desktop app to Tauri and Rust while keeping the same interface, themes and Orb.
- Preserved conversation and memory data, with a backup before the first Tauri opening.
- Kept real streamed replies, correction/forgetting, background learning, history search and retry recovery.
- Removed Electron and the retired JavaScript backend; added a Windows release build and installer.
- Verified Rust tests, live provider workflows and desktop layouts. The installer is unsigned and owner installation/visual approval remain pending. Recall and automatic learning still have their earlier limits.

## 2026-11-06 — Expressive Orb

- Removed the empty-state sparkles. The yellow face now moves gently within the blue shell, opens its wink and occasionally blinks.
- Preserved the original logo artwork. Verified movement and expression changes in Electron; reduced motion keeps the original static wink.

## 2026-11-06 — Empty conversation

- Centered the first-message greeting and composer, with a playful Orb and small spark accents.
- Kept the normal message layout after conversation begins. Checked both themes at desktop and smaller sizes; owner review is pending.

## 2026-11-06 — Navigation and motion

- Added an expandable icon sidebar with hover and keyboard-focus tooltips. Settings now sits at the bottom beside an inactive profile icon.
- Organized Settings into searchable Appearance, Model, Memory and Data & privacy sections.
- Added subtle page, message, composer and sidebar transitions that respect reduced motion.
- Verified light/dark layouts, smaller windows, rapid navigation and saved sidebar preferences in the running app. Owner review is pending.

## 2026-11-06 — Slice 01 revision

- Replaced the interface with Conversation, Memories and Settings, with matching light and dark themes.
- Added streamed replies, stopping, saved partial responses and retry recovery.
- Added full-history search, surrounding messages and direct jumps to earlier conversation.
- Moved ordinary memory learning behind replies and retained unfinished work through context compaction.
- Made corrections and forgetting more precise, with protection against stale background updates. Existing data is backed up before migration.
- Verified real-provider workflows and desktop layouts; owner approval is pending. Recall remains lexical, automatic memory can make mistakes, and storage is unencrypted.

## 2026-11-06 — Slice 01

- Added a Desktop conversation with saved messages, search and access to earlier history.
- Connected real Groq responses using the existing local keys.
- Added personal memory with original sources, corrections and forgetting controls.
- Kept working context small while retrieving matching older information. Resetting it keeps history and memory.
- Verified restart continuity, preference changes, forgetting and recall across 3,000 intervening messages in the actual app. Owner review is pending.
- Limits: keyword-based recall, fallible automatic memory, provider quota, local unencrypted storage and no installer or streamed replies. Forgetting keeps original chat history readable.
