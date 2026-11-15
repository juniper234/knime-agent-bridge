# macOS verification

Date: 2026-10-31. Machine: Apple Silicon, macOS 27.0. KNIME 5.12.0 (`org.knime.core 5.12.0.v202606180846`), bundled JRE 21.0.9.
Bridge: `io.github.juniper234.knime.agentbridge` 0.6.0, developer build `artifacts/io.github.juniper234.knime.agentbridge_0.6.0-8a20c0834710.jar`, SHA-256 `2f923c78132bb95c88a63e1d4542a5679c86f5fa215a9b293a5a0cbb7af17a8d`.

KNIME was started by `node scripts/launch.mjs` with a private configuration under `runtime/`, against synthetic workspaces `runtime/workspace` and `runtime/workspace-w2-v04-mac`. The user's own KNIME instance (`~/knime-workspace`) ran at the same time and was not touched.

## Startup

| Check | Result |
|---|---|
| Bridge activates, session published | Pass. `status: ready`, `modernUiReady: true`, `knimeVersion 5.12.0.v202606180846`, about 6 s after launch |
| `bundleFingerprint` equals SHA-256 of the JAR | Pass |
| `knime.log` errors from the bridge | None. One KNIME error (missing welcome video resource in `org.knime.ui.java`) is unrelated |
| `cli health`, `cli describe` (native round trip) | Pass |
| `desktop.uiState` | Pass. Reads SWT Cocoa shells; also lists Eclipse's hidden "PartRenderingEngine's limbo" shell (`visible: false`) |
| Two KNIME instances from one install (different `-configuration` and `-data`) | Works |

## Live tests

Run with `KNIME_AGENT_RUNTIME=runtime` and the gates shown. Every test listed passed; none failed.

| File | Gate | Pass |
|---|---|---|
| native-health | `KNIME_AGENT_LIVE=1` | 1/1 |
| native-workflow (create, configure, execute, persist) | `KNIME_AGENT_LIVE=1` | 2/2 |
| native-queue | `KNIME_AGENT_LIVE=1` | 1/1 |
| native-core | `KNIME_AGENT_LIVE=1 KNIME_CORE_TABLE_FIXTURE=1 KNIME_CORE_TEST_PROJECT/NODE` from `runtime/native-fixture.json` | 13/13 |
| native-workflow-export-v05 (non-JNA file identity path) | `KNIME_V05_NATIVE=1`, workspace `workspace-w2-v04-mac` | 2/2 |
| native-v04, native-reconciliation-v04, native-context-lifecycle-v04 | `KNIME_V04_NATIVE=1` | 3/3 |
| native-canvas-probe (native SVG preview) | `KNIME_CANVAS_TEST_PROJECT` | 3/3 |
| native-visual-workflow (render, layout check, repair) | `KNIME_VISUAL_ACCEPTANCE=1` | 1/1 |
| settings-preview (detached JVM settings) | `KNIME_SETTINGS_JVM_TEST=1` | 3/3 |
| native-reliability | `KNIME_RELIABILITY_TEST=1` | 3/3 |

`native-core` reads its fixture only from environment variables, so it must run after `native-workflow` with `KNIME_CORE_TEST_PROJECT` and `KNIME_CORE_TEST_NODE` set. Without them 8 of its tests skip.

## Canvas

| Check | Result |
|---|---|
| `knime_canvas_view` overview (native SVG preview rendered by Playwright) | Pass. Renderer fell back to Google Chrome 156 (no Edge installed) |
| `knime_canvas_view` viewport (`ChromiumBrowser.captureScreenshot`, Equo Chromium 128.0.30) | Pass. 2048x1480 PNG of the KNIME window at Retina scale |
| Viewport on a project that is open but not the active tab | Refused with `CONTEXT_CHANGED` (by design: viewport needs the visible project) |

## Not covered on macOS

- Installing through p2 and Claude Desktop `.mcpb`.
- UI responsiveness (unmeasured on every platform).
- Quitting KNIME from the bridge: the test instance was stopped with SIGTERM to its own PID.

## Extension and Claude Desktop bundle

| Check | Result |
|---|---|
| Update-site zip installed through KNIME's Install Extensions dialog into the user's KNIME 5.12.0 | Pass (user, 2026-10-31). Bridge started after restart with no launcher; session in `~/.knime-agent/runtime`, workspace `~/knime-workspace`, fingerprint equals the zip's JAR |
| Preferences > KNIME > Agent Bridge | Present; agent reported changes off when unticked (user) |
| `.mcpb` double-click install in Claude Desktop 4.29.0 | Pass (user). Claude Desktop log: "Using built-in Node.js for MCP server"; exact Node version not reported |
| Bundle server read and refused write (`KNIME_AGENT_ALLOW_WRITES=false`) | Pass, run from the unpacked bundle |

## Canvas selection (0.6)

Test KNIME on `runtime/workspace-selection`, developer JAR, DevTools port only to drive clicks. `desktop.selection` returned an empty selection, then `root:1`,`root:2` after selecting through the UI store, then `root:1` after a real mouse click on the canvas. `knime_selection` named them (Table Creator, Column Filter) with native IDs and states. No `knime-agent-selection-*` keys remained in session storage. Not covered: nested workflows, Windows, the installed extension.

## ChatGPT and Codex (2026-10-31)

Registered with `node scripts/register-codex.mjs`, which writes `knime-agent` into `~/.codex/config.toml` (stdio, `KNIME_AGENT_ALLOW_WRITES=true`).

- Codex CLI: the user confirmed the KNIME tools work.
- ChatGPT desktop app: `knime-agent` shows under Plugins > MCPs and is enabled, but a normal chat does not see it and never starts the server. OpenAI's docs tie local MCP servers to the Codex host shared by the desktop app, CLI and IDE extension. A Codex task inside the desktop app was not tested yet.
- ChatGPT web cannot use local servers.
- Known issue: the registration stores the versioned Homebrew Node path (`/opt/homebrew/Cellar/node/<version>/bin/node`), which breaks after a Node upgrade.
