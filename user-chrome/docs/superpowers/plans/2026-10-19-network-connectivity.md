# Network Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chromium-session proxy control and a safe settings/diagnostics UI to the Electron browser.

**Architecture:** A main-process `NetworkManager` owns persisted configuration, Electron session proxy application, authentication and event history. A minimal preload/renderer IPC boundary configures it; diagnostic probes are separate from browser requests so each network phase receives an explicit result.

**Tech Stack:** Electron 31, Node.js built-ins (`dns`, `net`, `tls`, `http`, `http2`), node:test, HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-19-network-connectivity-design.md`

## Global Constraints

- Browser traffic must use Electron `session.setProxy()`; do not create a parallel Chromium network stack.
- Passwords must not be persisted in plaintext.
- An authorized tunnel is an externally provisioned HTTP/HTTPS/SOCKS5 endpoint.
- HTTP/3 support must be reported as limited when Electron cannot expose handshake detail.

## Review Focus

- Invalid proxy host or port is rejected before session mutation.
- A password never appears in exported state or diagnostic history.
- Changing proxy closes existing Chromium connections.
- Proxy authentication is supplied only for proxy authentication challenges.
- TCP success is never reported as HTTP/TLS success.

---

### Task 1: Network configuration and Chromium session adapter

**Files:**
- Create: `network/network-manager.js`
- Test: `test/network-manager.test.js`

**Interfaces:**
- Produces: `NetworkManager`, `NetworkErrorCode`, `normalizeConfig(config)`.

- [x] **Step 1: Write failing tests for direct, HTTP and SOCKS5 proxy configuration, invalid endpoints and secret-free state.**
- [x] **Step 2: Run `node --test test/network-manager.test.js` and verify the missing module failure.**
- [x] **Step 3: Implement the configuration validation, secure persistence adapter, `session.setProxy`, `closeAllConnections`, proxy login and bounded event log.**
- [x] **Step 4: Run `node --test test/network-manager.test.js` and verify all tests pass.**

### Task 2: Stage-aware diagnostics

**Files:**
- Create: `network/network-diagnostics.js`
- Test: `test/network-diagnostics.test.js`

**Interfaces:**
- Consumes: normalized config from `NetworkManager`.
- Produces: `NetworkDiagnostics.run(target, options)` and classified result records.

- [x] **Step 1: Write failing tests for DNS failure, TCP refused/reset/timeout classification, certificate failure and HTTP status failure.**
- [x] **Step 2: Run `node --test test/network-diagnostics.test.js` and verify expected failures.**
- [x] **Step 3: Implement bounded DNS/TCP/TLS/HTTP1/HTTP2 probes and Chromium-request HTTP3 availability reporting.**
- [x] **Step 4: Run `node --test test/network-diagnostics.test.js` and verify all tests pass.**

### Task 3: Secure Electron integration and settings surface

**Files:**
- Create: `preload-network-settings.js`, `renderer/network-settings.html`, `renderer/network-settings.js`, `renderer/network-settings.css`
- Modify: `main.js`
- Test: `test/main.test.js`

**Interfaces:**
- Consumes: `NetworkManager.apply`, `getPublicState`, `diagnose`.
- Produces: a protected IPC API under `window.networkSettings`.

- [x] **Step 1: Write failing main-process tests for IPC channel registration, safe browser preferences and manager initialization.**
- [x] **Step 2: Run `node --test test/main.test.js` and verify expected failures.**
- [x] **Step 3: Add isolated settings window, preload IPC handlers, menu entry and accessible form/status/history renderer.**
- [x] **Step 4: Run `npm test` and verify the complete suite passes.**

### Task 4: Documentation and release validation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents configuration and external tunnel prerequisites.

- [x] **Step 1: Add usage and stated HTTP/3/tunnel limits.**
- [x] **Step 2: Run `npm test`; `npm run dist` was attempted and is blocked by Windows symbolic-link policy, while the equivalent directory package validation passed with `signAndEditExecutable=false`.**
