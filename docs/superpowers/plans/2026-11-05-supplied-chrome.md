# Supplied Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans for the app changes and dispatching-parallel-agents for independent packaging/Windows smoke. The user already delegated routine implementation and publication decisions.

**Goal:** Use the user's supplied ChromeProtegido with the existing authenticated proxy, preserving its browser interface and runtime.
**Architecture:** A thin managed-network adapter wraps the user's NetworkManager; existing launcher passes only loopback port to Electron. Repack app.asar into the supplied runtime and publish a complete Windows ZIP.
**Tech Stack:** Original CommonJS/Electron31.7.7, Node24 proxy, Python ZIP packaging, pinned @electron/asar build tool.
**Spec:** ../specs/2026-11-05-supplied-chrome.md

## Global Constraints

- No main navigation UI rewrite; preserve all original runtime files except app.asar.
- No direct fallback, TLS disabling, paid resources, credential transfer to Electron or ledger reset.
- Existing main bridge only; do not merge PR11.

## Review Focus

- Stored direct/PAC configuration cannot override managed proxy.
- Missing bridge means navigation fails rather than using origin directly.
- Diagnostics do not establish direct DNS/TCP/HTTP2 connections.
- ZIP paths/hash/toolchain cannot substitute an unverified runtime.
- Windows package opens supplied executable with full resources and preserves UI.

### Task1 — App network integration (primary)
- [x] Inspect archive, compare ASAR/source and run44 original tests.
- [x] RED: fixed proxy policy, restore legacy direct config, reject changes, preserve settings, diagnostic path and failed startup.
- [x] Implement network/private-cloud-proxy.js, main integration and managed network settings UI.
- [x] Run all original/new user-chrome tests and existing proxy checks.

### Task2 — Packaging and Windows smoke (independent agent)
- [x] Implement pinned build tool, verified archive download, safe extraction, ASAR overlay, original runtime hash verification and launcher selection.
- [x] Add Windows workflow and native HTTP proxy/fail-closed smoke using the supplied runtime.
- [x] Package and verify locally, run appropriate script tests.

### Task3 — Publish
- [ ] Review full diff, run CI, publish source and tested Windows release without paid resources.
- [ ] Verify release assets and report exact checks/remaining limits.

User steering: finish with a step-by-step README, no embedded private keys/credentials, prominent educational purpose and responsibility disclaimer. README and both browser/download guides updated. Audit157 source files found0 matches; no key files were present in tracked history. Bundle guard and tests reject key/credential material. No authentication was removed. Native smoke expanded to require HTTPS CONNECT to example.com with default certificate validation, in addition to offline HTTP/fail-closed checks.
