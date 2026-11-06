# OSCAR — Product Vision

> **Status:** Product vision for the fresh OSCAR repository. This is the intended scope, **not** an implementation or release claim. The previous OSCAR repository is retained separately as a reference. Decisions remain subject to owner review and can be refined one feature at a time.

## 1. Mission

**One intelligence. One continuing relationship. Many devices.**

OSCAR is Dawnlight Labs' persistent, general-purpose, multimodal personal intelligence. It should help its owner think, create, organize, learn and take action in digital environments without replacing the owner's judgment, agency or creative direction. OSCAR must feel approachable and distinctive: an expressive animated Orb, playful but precise interactions, a cohesive native experience and a clear understanding of what it knows, is doing, and cannot yet do.

OSCAR is **one identity and one canonical memory**, not disconnected assistants for each screen, model, server or agent. The current architecture is a vision to be validated, not a commitment to carry forward every legacy code abstraction.

## 2. Primary intelligence

- **OSCAR Core:** Persistent identity, ownership, session/context continuity, orchestration and reliable state across connected surfaces.
- **Decision Model:** Determines whether to answer, reason more deeply, recall memory, acquire evidence, ask for clarification, act, delegate or wait. Evaluate small, capable, free/open models and deterministic decision logic. **No particular model is finalized.** Safety and authorization rules are enforced independently of model output.
- **Model Router / SwitchRoute:** Model-provider abstraction, automatic/manual selection, local and cloud inference, confirmed free-first options, optional paid providers, privacy/cost/latency tradeoffs, quotas, budget visibility, failover and truthful availability states. Candidate services historically discussed include Groq, OpenRouter, NVIDIA NIM, Google AI Studio, Z.ai and Ollama Cloud, plus local inference.
- **Executive:** Decomposes unfamiliar objectives, chooses capabilities, plans steps, performs allowed actions, recovers from failures and verifies real outcomes instead of presenting attempted actions as completed.
- **World Model:** Up-to-date, permission-scoped representation of the owner's devices, applications, files, tasks, environment and relevant live context.
- **Capability/Connection Grid:** Discovers, authenticates and invokes capabilities distributed across devices, browser sessions, applications, MCP tools and external accounts.

## 3. Memory Fabric and LRA

LRA and the Memory Fabric are the long-term continuity and adaptive-learning foundation, **not just chat-history search**. Their intended functions include:

- Durable conversation/event history, context across sessions and devices, plus source/provenance awareness.
- Episodic, semantic, entity, preference and temporal memory with selective retrieval.
- Corrections and learning from verified experience; reusable procedures and personalization without unchecked self-modification.
- Memory lifecycle, retention limits, user inspection/edit/forget controls, sensitive-memory separation and recovery.
- One authoritative memory despite multiple endpoints or model changes.

**Terminology note:** The original expansion of the LRA acronym has not been conclusively recovered; do not invent or silently replace it.

## 4. OSCAR, Workers and Automations — three different roles

### OSCAR (the principal)

The owner interacts primarily with OSCAR. OSCAR can itself use every authorized capability that a Worker may use. It determines how to carry out requests, supervises delegated work and retains final responsibility for policy, verification and user communication.

### Agents / Workers (delegated intelligence)

- A dedicated **Agents tab** hosts named, conversational, individually inspectable Workers, inspired by persistent assistant/bot experiences.
- OSCAR or the owner can create temporary or persistent Workers with specific goals, context, tools, permissions, budgets, schedules, checkpoints and optional expressive identity.
- Workers may run in parallel, resume work, report evidence and ask for approval when necessary.
- OSCAR can instruct, redirect, pause, resume, cancel or retire Workers; Workers cannot silently expand their own authority.
- Activity and results are attributable to the correct Worker and visible through OSCAR.

### Automations (OSCAR's routines)

- A separate **Automations tab** controls OSCAR-owned reminders, schedules, recurring tasks, event-driven triggers, watches/monitors and condition-based protocols.
- An Automation states **when/under what conditions** a task should run. OSCAR may run it directly or delegate the action to a Worker.
- Automations have clear ownership, edit/pause/run history, failure alerts and user controls.
- **Automations are not Workers; Workers are not merely scheduled jobs.**
- A unified **Activity** view displays verifiable events from OSCAR, Workers and Automations.

## 5. Surfaces and hosting

### Windows Desktop (primary development surface)

- Two complementary experiences: an unobtrusive **Companion Orb** and a full **Workspace**.
- Workspace information architecture: **Conversation, Agents, Automations, Activity, Devices, Preferences**. Setup Studio and advanced options live in appropriate contextual destinations.
- Genuine desktop and browser action: screen understanding, windows, apps, files, terminal, mouse/keyboard, accessible UI and browser sessions, under user-set authority.
- Rich, interactive results: approvals, previews, plans, task progress, visualizations and context-aware surfaces.

### Android / Sunday

- Preserve the owner-approved **native Android visual direction** as the baseline design reference.
- Shared identity, conversation, Memory Fabric, Worker/Automation status, owner approvals, voice, notifications, context and device capabilities.
- Correct background behavior and permissions, secure enrollment, offline/online recovery and verified sync, without silently pretending the phone is continuously active.

### Optional old laptop / local home server

- The spare old computer can host OSCAR's persistent Core, selected services, local networking and background operations when available.
- Simple guided enrollment, secure networking, backup and host migration; desktop and phone connect to the **same** OSCAR.
- Physical dedicated-home-server commissioning is a separate later step; software support is still within product scope.

### Oracle Cloud / remote host

- Oracle Cloud Always Free was the preferred **candidate** for optional always-on remote hosting; cost/free-tier availability and practical deployment must be verified before commitments.
- Secure, authenticated Cloud–Desktop–Phone synchronization, continuity, reconnection, restoration and remote coordination.
- Vercel or similar web/API relays can complement a host where appropriate, but must not create a second authoritative OSCAR.
- The owner can choose local-only, cloud-assisted or hybrid configurations and understand privacy/network tradeoffs.

### Future surfaces

Browser interactions; MCP and other third-party services; a potential always-on tablet/Home Node; later ESP32/Pico/sensors, displays and other physical Edge embodiments. Hardware commissioning is deferred until separately approved.

## 6. Capabilities and experience

- **Natural multimodal conversation:** Text, speech, document/media context and an expressive conversational persona.
- **Voice:** Speech input and output, permission-aware microphone controls, interruption/barge-in, voice identity, customizable responses and eventual optional wake/continuous modes.
- **Sentry:** Opt-in, permission-scoped environmental/application/context awareness and proactive assistance; capture, retention and action grants must remain separate.
- **Chief of Staff:** Calendar, email, schedules, communications, priorities, follow-ups, reminders, commitments and daily briefings through explicitly connected accounts.
- **Connections and MCP:** Dynamic tools/providers, OAuth and service-specific authorization, multiple personal accounts, optional dedicated OSCAR identities where allowed, connection health and revocation.
- **Computer use:** Real multi-step work across Windows, Android and browser/application integrations, with outcome checks and sensitive-action approvals.
- **Personalization:** Preferences, persona/voice, remembered context and an expressive Orb rather than generic assistant chrome.
- **Adaptive UI:** Contextual cards, structured information, interactive controls, approvals, timelines and content previews instead of raw execution logs.
- **Reliability:** Durable work, truthful status, recovery, connectivity states, cancellation, logging appropriate for users, and non-destructive behavior by default.

## 7. Security and owner authority

The owner controls which information OSCAR may observe, retain and act upon. Access levels are **Ask**, **Secure** and **Full Access**, with scoped grants and revocation. Sensitive actions, external accounts, personal data, payments and remote device authority require context-appropriate verification. A model suggestion, Worker or automation never bypasses policy. Credentials belong in secure platform storage, not repository files or user-visible logs.

## 8. First-run and Setup Studio flow

1. **Install and launch** a signed/verified Windows or Android build.
2. **Meet OSCAR:** A short, cinematic, playful, skippable and replayable introduction with the canonical animated Orb, accessible motion/sound controls and a coherent brand identity.
3. **Get acquainted:** Optional name, communication style/persona and preferred voice.
4. **Give OSCAR a mind:** Choose local/free/paid routing, model preferences and securely connect supported provider keys/accounts.
5. **First magic:** Perform one real, safely scoped objective, not a scripted fake demonstration.
6. **Connect your world:** Optional accounts, browser, MCP tools and permissions.
7. **Connect your devices:** Pair Desktop and Android; optionally set up the old laptop/home server or Oracle Cloud, with a clear choice of authoritative Core host.
8. **Set autonomy:** Approvals, Worker policies, Automations, Sentry, privacy and notification preferences.
9. **Continue naturally:** Advanced setup remains available through a reopenable **Setup Studio**, rather than blocking first use.

The same visual identity, terminology, interaction conventions and state must carry across Desktop and Mobile.

## 9. Canonical request flow

```text
Owner speaks/types/acts on Desktop, Android or another authorized surface
  -> Single OSCAR identity receives the request
  -> Decision Model + deterministic rules determine the next step
  -> Memory Fabric/LRA + World Model supply relevant, permitted context
  -> Model Router selects a suitable available intelligence
  -> Executive plans or answers
  -> OSCAR acts directly OR delegates to one or more Workers
  -> Capability Grid/tools/devices/accounts perform scoped operations
  -> Results are independently checked and attributed
  -> Activity, canonical history and memory are updated appropriately
  -> OSCAR explains the outcome in an expressive, truthful UI
```

Automations enter the same flow through a scheduled/event trigger, without creating a second primary assistant.

## 10. Product and development principles

1. **Help people; don't replace them.** Explicit owner direction and transparent authority.
2. **One OSCAR, not a swarm of disconnected bots.** Workers remain delegated subordinates.
3. **Product coherence first.** Use the approved Mobile look and fluid Orb animation as the visual benchmark. Rebuild Desktop presentation where necessary, rather than perpetuating the old inconsistent UI.
4. **Reuse selectively.** Evaluate proven legacy backend integrations, memory and security code; don't automatically transplant needless abstractions, speculative architecture or stale development clutter.
5. **Small, owner-reviewed features.** Implement one bounded user experience, test the actual application, accept/revise, then move forward.
6. **Genuine execution over appearances.** A mock, fixture, passing unit test or generated package is not equivalent to a verified owner experience.
7. **Local-first choice, not local-only dogma.** Preserve explicit options for local, free-cloud, paid-cloud and hybrid intelligence.
8. **Easy installation and migration.** A fresh owner should be able to install, connect and understand OSCAR without editing source code.
9. **Status remains honest.** See [VISION-STATUS.md](VISION-STATUS.md); new-repository completion requires fresh evidence.

## 11. Naming

**OSCAR** is the agreed product name. Its **official full expansion has not been confirmed** in recovered project records; it should not be invented for public material.

**Decision Model** is the canonical name for the decision-making subsystem; avoid using the historical name *Jev* in new product-facing material.
