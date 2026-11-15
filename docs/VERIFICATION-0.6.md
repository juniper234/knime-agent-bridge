# Verification 0.6.0 (installed extension)

This records what was checked against the 0.6.0 extension installed from the update site into a stock KNIME, driven through the MCP server the way an agent uses it. Earlier per-milestone notes are in `VERIFICATION-mac.md`.

## Build under test

| Item | Value |
| --- | --- |
| OS | macOS 27.0.1 (26A434), arm64 |
| KNIME | 5.12.0.v202606180846, `/Applications/KNIME 5.12.0.app` |
| Extension | installed via Install Extensions from `knime-agent-bridge-update-site-0.6.0.zip` (SHA-256 `969f94e2…88302f5`) |
| Bundle fingerprint reported by the session | `6d171c30aabcbefc6c3c4cf1fc1c870923a4c664393c001f5c8d463ad69b8e9c` |
| MCP server | repo `src/server.mjs` 0.6.0, Node v26.10.0; same code as `knime-agent-bridge-0.6.0.mcpb` (SHA-256 `7dba8b6d…cb4d238d`) |
| Date | 2026-10-31 |

The pass ran in a second KNIME window started with `-data runtime/workspace-m5`. The user's own KNIME window was running at the same time on its own workspace. The script pins the MCP server to the one session whose workspace is `runtime/workspace-m5` and refuses any workspace outside `runtime/`.

Reproduce: start KNIME with `-data <repo>/runtime/workspace-m5`, then `node scripts/verify-install.mjs --workspace runtime/workspace-m5`. Results: `docs/measurements/install-darwin-0.6.0.json`.

## Results: 11 of 11 steps passed

### Functional evidence

- `knime_connection` and `knime_health`: 26 tools, bridge 0.6.0, both write switches on (KNIME source `preference`, client source `KNIME_AGENT_ALLOW_WRITES`).
- Created and opened a new workflow through `SpaceService.createWorkflow` and `desktop.openProject`. The open was confirmed by polling `ApplicationService.getState`, not by the acknowledgement.
- Added Table Creator and Column Filter, connected them, and read the snapshot (2 nodes, 1 connection) and the typed settings envelope.
- `knime_settings_preview` on the Column Filter left the live settings unchanged, and its candidate validated. `core.settings.patch` then applied the change. Every node's `settingsValidation` reports `validation: passed` and `validForSave: true` (the check fails if the field is missing).
- Both nodes were executed and polled until EXECUTED. `knime_wait` (execution) settled on the first attempt. No node messages.
- `knime_table` source rows equal the literal fixture `[['alpha',1],['',2],[null,3]]`. The filtered table is `[[1],[2],[3]]`, schema `value` only. `knime_table_verify` passed with `rowCount: 3` and `uniqueColumns: ['value']`.
- `knime_selection` returned `available: true` for the active project. No node was clicked, so `nodeIds` was empty.
- Read-only switch: a second MCP server with `KNIME_AGENT_ALLOW_WRITES=false` refused `add_node` with `WRITES_DISABLED` and `nativeDispatch: not_started`. The error is also present in the text block. Node count stayed at 2.

### Visual evidence

- `knime_canvas_view` overview: one PNG rendered by Google Chrome through Playwright, with no `render-unstable` omission. Reviewed by eye: both nodes, their names, the connection and green executed lights are drawn correctly.
- `knime_canvas_view` viewport: one PNG of the live editor. Reviewed by eye: it shows the right project tab and the Table Creator. In the default window size the canvas pane is narrow and the minimap covers most of it, so only part of the graph is visible. This comes from the window layout, not from the capture.
- Images are kept locally in `runtime/m5-evidence/` (not committed).

### Persistence evidence

- `desktop.saveProject` cleared the dirty flag, and `knime_wait` (saved) settled. `core.workflow.export` of the saved project produced a complete manifest (17 entries, `workflow.knime` included, no implicit save), and the archive SHA-256 matched the reported one. `desktop.closeProject` removed the project from the application state.
- After reopening (new project ID): 2 nodes and 1 connection, the Column Filter setting `EnforceInclusion` is present, the filtered table still reads `[[1],[2],[3]]` without re-executing, and `workflow.knime` exists in the workflow folder on disk.

### Repository tests (same machine)

- `npm run test:adapter`: 49 passed, 0 failed.
- `npm test`: 270 tests, 240 passed, 0 failed, 30 skipped. The skips are the live tests that need `KNIME_AGENT_LIVE=1`.

## Not covered

- The KNIME-side switch (Preferences > KNIME > Agent Bridge set to off) was not toggled on the installed build. The Java gate is covered by the stage harness (`tests/native-stage-telemetry.test.mjs`).
- The live test files (`KNIME_AGENT_LIVE=1 npm test`) and `npm run test:beta` were not run against the installed extension. They do not pin a session, so with two KNIME windows open they stop with `AMBIGUOUS_SESSION`. The live test files passed against the launcher build in M2. Adding `--session` support is still open.
- The pass was driven by the script, not by a person chatting in Claude Desktop. Claude Desktop was separately confirmed to load the `.mcpb` and answer read calls. Its three settings (Allow changes, Canvas images, browser path) have not been toggled one by one.
- `knime_table_verify` constants were not checked, because the fixture has no constant column.
- Selection after a real mouse click was checked only in the earlier prototype run (see `VERIFICATION-mac.md`), not in this pass.
- UI responsiveness was not measured.
- Windows: not started (M6).
