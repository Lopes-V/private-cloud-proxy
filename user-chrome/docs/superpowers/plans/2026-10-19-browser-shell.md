# Browser Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-page Electron app into a secure tabbed browser shell with navigation, favorites, history and downloads.

**Architecture:** The main process owns tab `BrowserView` instances and a persistent browser store; a local shell renderer only displays state and forwards user commands through an allowlisted preload API. Remote pages have no Node or IPC access and use the same Chromium session as network settings.

**Tech Stack:** Electron 31, Node.js, node:test, local HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-19-browser-shell-design.md`

## Global Constraints

- Only HTTP(S) targets may be loaded into a remote tab.
- Remote tabs use `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`.
- All tabs share Electron `defaultSession`, including proxy policy and cookies.
- No account sync, extensions, incognito, autofill or password manager are added.

## Review Focus

- Text without a scheme becomes a safe DuckDuckGo query, while valid HTTP(S) URLs remain unchanged.
- Closing the active or final tab leaves a usable local new-tab page.
- Remote `window.open` requests create controlled tabs instead of unmanaged windows.
- Saved browser data never prevents app startup when malformed or absent.
- Permission requests from remote sites are denied by default.

---

### Task 1: Address and browser persistence primitives

**Files:**
- Create: `browser/address.js`, `browser/browser-store.js`
- Test: `test/browser-store.test.js`

**Interfaces:**
- Produces: `normalizeAddress(input)`, `BrowserStore.getSnapshot()`, `toggleFavorite(url, title)`, `recordHistory(url, title)`, `recordDownload(download)`.

- [ ] Write tests for URL/search normalization, malformed saved data and deduplicated favorites/history.
- [ ] Run `node --test test/browser-store.test.js` and observe failure.
- [ ] Implement address normalization and bounded persistent browser data.
- [ ] Run the targeted test and verify it passes.

### Task 2: Main-process tab controller

**Files:**
- Create: `browser/tab-manager.js`
- Test: `test/tab-manager.test.js`

**Interfaces:**
- Consumes: `normalizeAddress`, `BrowserStore`, Electron `BrowserView`/window/session adapters.
- Produces: `createTab`, `activateTab`, `closeTab`, `navigate`, `goBack`, `goForward`, `reload`, `getSnapshot`.

- [ ] Write tests for creating, switching, closing and navigating tabs, including denied schemes.
- [ ] Run `node --test test/tab-manager.test.js` and observe failure.
- [ ] Implement tab lifecycle, controlled popups, navigation updates and download/history hooks.
- [ ] Run the targeted test and verify it passes.

### Task 3: Shell UI and secure IPC integration

**Files:**
- Create: `preload-browser-shell.js`, `renderer/browser-shell.html`, `renderer/browser-shell.js`, `renderer/browser-shell.css`
- Modify: `main.js`, `test/main.test.js`

**Interfaces:**
- Consumes: `TabManager` command methods and snapshots.
- Produces: `window.browserShell` with restricted tab/navigation/bookmark/download methods.

- [ ] Write a failing main-process test for shell preload, isolated preferences and browser IPC channels.
- [ ] Run `node --test test/main.test.js` and observe failure.
- [ ] Create the responsive shell, wire IPC and replace direct remote main-window navigation with the tab manager.
- [ ] Run `npm test` and verify the suite passes.

### Task 4: Documentation and package validation

**Files:**
- Modify: `README.md`, `package.json`

- [ ] Document normal browser controls and security limits; exclude test/plan artifacts from release.
- [ ] Run `npm test` and `npx electron-builder --win --dir --config.win.signAndEditExecutable=false`.
