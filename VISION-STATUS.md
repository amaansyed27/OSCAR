# OSCAR — Vision Status Checklist

**Repository:** [amaansyed27/OSCAR](https://github.com/amaansyed27/OSCAR)  
**Starting baseline:** Fresh repository, documentation first.  
**Truth rule:** An unchecked box means **not yet implemented and verified in this new repository**. It does **not** imply the legacy OSCAR codebase lacked the feature. Reuse is possible after an explicit evaluation.

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

**Current overall state: Vision defined; new-product implementation and acceptance not started.**
