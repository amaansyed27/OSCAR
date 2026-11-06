# Changelog

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
