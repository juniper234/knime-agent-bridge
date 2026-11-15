// Functional pass against an installed extension, driven through the MCP server the
// way an agent uses it. Every mutation stays in a synthetic workspace under runtime/.
//
//   node scripts/verify-install.mjs --workspace runtime/workspace-m5 [--runtime DIR] [--out FILE]
//
// Pins the MCP server to the one session whose workspace matches --workspace, so other
// KNIME windows (for example the user's own) are never touched. Records functional, visual
// and persistence evidence separately, plus what was not covered.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BridgeClient, defaultRuntimeDirectory } from '../src/client.mjs';
import { configureTableCreatorFixture, executeAndWaitForNode, tableCreatorFixtureRows } from '../tests/helpers/table-fixture.mjs';
import { guardedMcp } from '../tests/helpers/guarded-native.mjs';

// Windows paths are case-insensitive; compare them folded.
const fold = p => process.platform === 'win32' ? p.toLowerCase() : p;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { workspace: { type: 'string' }, runtime: { type: 'string' }, out: { type: 'string' } } });
if (!values.workspace) throw new Error('--workspace is required (a synthetic workspace under runtime/).');
const workspace = await fs.realpath(path.resolve(values.workspace));
const syntheticRoot = await fs.realpath(path.join(root, 'runtime'));
if (!fold(workspace).startsWith(fold(syntheticRoot + path.sep))) throw new Error(`Refusing to mutate ${workspace}: it is not inside ${syntheticRoot}.`);
const runtime = path.resolve(values.runtime ?? defaultRuntimeDirectory());
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;

const sameDir = (url, dir) => { try { return fold(path.resolve(fileURLToPath(url)).replace(/[\\/]$/, '')) === fold(dir); } catch { return false; } };
const live = (await new BridgeClient({ runtime }).listSessions()).filter(s => s.alive && sameDir(s.workspace, workspace));
if (live.length !== 1) throw new Error(`Expected one live session for ${workspace} in ${runtime}; found ${live.length}. Start KNIME with -data ${workspace} first.`);
const session = live[0];

const report = { schemaVersion: 1, startedAt: new Date().toISOString(), platform: `${os.platform()}-${os.arch()}`, os: os.release(), node: process.version, bridgeVersion: version,
  runtime, workspace, session: { id: session.id, pid: session.pid, knimeVersion: session.knimeVersion, bundleFingerprint: session.bundleFingerprint, bridgeVersion: session.bridgeVersion },
  steps: [], evidence: { functional: [], visual: [], persistence: [] }, notCovered: [] };

async function server(env) {
  const client = new Client({ name: 'verify-install', version });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src', 'server.mjs'), '--runtime', runtime, '--session', session.id], env: { ...process.env, ...env }, stderr: 'pipe' }));
  const raw = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { ok: !r.isError, value: r.structuredContent, content: r.content }; };
  const call = async (name, args = {}) => { const r = await raw(name, args); if (!r.ok) throw Object.assign(new Error(`${name}: ${JSON.stringify(r.value?.error ?? r.value).slice(0, 600)}`), { result: r.value }); return r.value; };
  return { client, raw, call };
}

async function step(name, kind, fn) {
  const started = performance.now();
  try {
    const detail = await fn();
    report.steps.push({ name, kind, status: 'pass', ms: Math.round(performance.now() - started), ...(detail ? { detail } : {}) });
    if (kind) report.evidence[kind].push(name);
    process.stdout.write(`pass  ${name}\n`);
  } catch (error) {
    report.steps.push({ name, kind, status: 'fail', ms: Math.round(performance.now() - started), error: String(error.message).slice(0, 1000) });
    process.stdout.write(`FAIL  ${name}: ${String(error.message).slice(0, 300)}\n`);
  }
}
const evidenceDir = path.join(root, 'runtime', 'm5-evidence');
async function saveImages(view, label) {
  await fs.mkdir(evidenceDir, { recursive: true });
  const files = [];
  for (const [i, c] of view.content.filter(c => c.type === 'image').entries()) {
    const file = path.join(evidenceDir, `${label}-${i}.png`);
    await fs.writeFile(file, Buffer.from(c.data, 'base64'));
    files.push(path.relative(root, file));
  }
  return files;
}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (fn, reason, tries = 150) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } throw new Error(reason); };

const { client, raw, call } = await server({ KNIME_AGENT_ALLOW_WRITES: 'true', KNIME_AGENT_CANVAS: 'true' });
// Same guard the live round-trip test uses: bind a context and pass fresh revisions to each mutation.
const invoke = guardedMcp(call);
const gateway = (method, params = {}) => invoke('knime_gateway_call', { method, params });
const core = (operation, args = {}) => invoke('knime_core_call', { operation, args });
const desktop = (operation, args = {}) => invoke('knime_desktop_call', { operation, args });
const bind = projectId => call('knime_context', { action: 'bind', projectId });

let item, projectId, sourceId, filterId, restricted = false;
const itemName = 'M5 Install Check ' + Date.now();
try {
  await step('connection reports the installed bridge and both write switches', 'functional', async () => {
    const tools = (await client.listTools()).tools.map(t => t.name);
    const connection = await call('knime_connection', {});
    const health = await call('knime_health', {});
    check(health.bridgeVersion === version, `bridge ${health.bridgeVersion} != ${version}`);
    check(connection.writes?.client?.enabled === true && health.writePolicy?.enabled === true, 'writes must be allowed by both switches for this pass');
    return { tools: tools.length, knimeVersion: health.knimeVersion, writePolicy: { enabled: health.writePolicy.enabled, source: health.writePolicy.source } };
  });

  // Open workflows only (the default) refuses SpaceService and desktop.openProject, which this
  // pass needs to create its synthetic workflow. Check the refusals, then stop.
  await step('open workflows only refuses browsing and opening saved workflows', 'functional', async () => {
    const health = await call('knime_health', {});
    restricted = health.scopePolicy?.openWorkflowsOnly === true;
    if (!restricted) return { openWorkflowsOnly: health.scopePolicy?.openWorkflowsOnly ?? null, source: health.scopePolicy?.source ?? null, refusals: 'not checked: the rule is off in this KNIME' };
    const refusals = {};
    for (const [label, name, args] of [
      ['SpaceService.listWorkflowGroup', 'knime_gateway_call', { method: 'SpaceService.listWorkflowGroup', params: { spaceId: 'local', spaceProviderId: 'local', itemId: 'root' } }],
      ['desktop.openProject', 'knime_desktop_call', { operation: 'desktop.openProject', args: { spaceId: 'local', spaceProviderId: 'local', itemId: 'root' } }]]) {
      const refused = await raw(name, args);
      check(!refused.ok && refused.value.error.code === 'SCOPE_RESTRICTED' && refused.value.error.details.nativeDispatch === 'not_started', `expected SCOPE_RESTRICTED for ${label}: ` + JSON.stringify(refused.value).slice(0, 300));
      refusals[label] = refused.value.error.code;
    }
    return { openWorkflowsOnly: true, source: health.scopePolicy.source, refusals };
  });

  if (restricted) report.notCovered.push('The rest of the pass creates its own workflow, which open workflows only forbids. For the full pass, untick it in Preferences > KNIME > Agent Bridge, or start this KNIME with JAVA_TOOL_OPTIONS=-Dknime.agent.openWorkflowsOnly=false.');
  else {
    await step('create and open a synthetic workflow', 'functional', async () => {
      item = await gateway('SpaceService.createWorkflow', { spaceId: 'local', spaceProviderId: 'local', itemId: 'root', itemName });
      await desktop('desktop.openProject', { spaceId: 'local', spaceProviderId: 'local', itemId: item.id });
      projectId = (await until(async () => (await gateway('ApplicationService.getState')).openProjects.find(p => p.origin?.itemId === item.id), 'workflow did not open')).projectId;
      return { itemName, projectId };
    });

    await step('add, connect and inspect nodes', 'functional', async () => {
      const command = workflowCommand => gateway('WorkflowService.executeWorkflowCommand', { projectId, workflowId: 'root', workflowCommand });
      sourceId = (await command({ kind: 'add_node', position: { x: 120, y: 160 }, nodeFactory: { className: 'org.knime.base.node.io.tablecreator.TableCreator3NodeFactory' } })).newNodeId;
      filterId = (await command({ kind: 'add_node', position: { x: 360, y: 160 }, nodeFactory: { className: 'org.knime.base.node.preproc.filter.column.DataColumnSpecFilterNodeFactory' } })).newNodeId;
      await command({ kind: 'connect', sourceNodeId: sourceId, sourcePortIdx: 1, destinationNodeId: filterId, destinationPortIdx: 1 });
      const snapshot = await call('knime_workflow', { projectId, depth: 1 });
      check(snapshot.nodes.length === 2 && snapshot.connections.length === 1, 'expected 2 nodes and 1 connection');
      const settings = await call('knime_settings', { projectId, nodeId: sourceId });
      check(settings.settings.entries.some(e => e.key === 'model'), 'settings envelope lacks model');
      return { nodes: snapshot.nodes.map(n => n.name) };
    });

    const filterPatches = [
      { path: ['model', 'column-filter', 'included_names'], type: 'stringArray', value: ['value'] },
      { path: ['model', 'column-filter', 'excluded_names'], type: 'stringArray', value: ['label'] },
      { path: ['model', 'column-filter', 'enforce_option'], type: 'xstring', value: 'EnforceInclusion' },
    ];
    await step('preview then apply typed settings, with clean validation', 'functional', async () => {
      await configureTableCreatorFixture(core, { projectId, nodeId: sourceId });
      const preview = await call('knime_settings_preview', { projectId, nodeId: filterId, patches: filterPatches });
      const before = await call('knime_settings', { projectId, nodeId: filterId });
      check(!JSON.stringify(before).includes('EnforceInclusion'), 'preview changed the live settings');
      await core('core.settings.patch', { projectId, nodeId: filterId, patches: filterPatches });
      const snapshot = await call('knime_workflow', { projectId, depth: 1 });
      check(preview.settingsValidation?.validation === 'passed', 'preview candidate did not validate: ' + JSON.stringify(preview.settingsValidation));
      const invalid = snapshot.nodes.filter(n => n.settingsValidation?.validForSave !== true);
      check(!invalid.length, 'settingsValidation not clean: ' + JSON.stringify(invalid.map(n => [n.name, n.settingsValidation])));
      return { previewChangedFields: preview.changedFields, validation: snapshot.nodes.map(n => [n.name, n.settingsValidation.validation, n.settingsValidation.validForSave]) };
    });

    await step('execute and wait; no node messages', 'functional', async () => {
      await executeAndWaitForNode(core, { projectId, nodeId: sourceId });
      await executeAndWaitForNode(core, { projectId, nodeId: filterId });
      const waited = await call('knime_wait', { session: session.id, condition: 'execution', projectId, nodeId: filterId, timeoutMs: 30000 });
      const snapshot = await call('knime_workflow', { projectId, depth: 1 });
      check(snapshot.nodes.every(n => n.state === 'EXECUTED'), 'not all nodes executed: ' + snapshot.nodes.map(n => n.state));
      check(snapshot.nodes.every(n => !n.message?.text), 'node messages present: ' + JSON.stringify(snapshot.nodes.map(n => n.message)));
      return { knimeWait: JSON.stringify(waited).slice(0, 300) };
    });

    await step('read and verify the output table against independent expectations', 'functional', async () => {
      const source = await call('knime_table', { projectId, nodeId: sourceId, portIndex: 1 });
      check(JSON.stringify(source.rows.map(r => r.values)) === JSON.stringify(tableCreatorFixtureRows), 'source rows differ from the literal fixture');
      const filtered = await call('knime_table', { projectId, nodeId: filterId, portIndex: 1 });
      check(JSON.stringify(filtered.rows.map(r => r.values)) === '[[1],[2],[3]]' && filtered.schema.map(c => c.name).join() === 'value', 'filtered table wrong');
      const verified = await call('knime_table_verify', { projectId, nodeId: filterId, portIndex: 1, expectations: { rowCount: 3, uniqueColumns: ['value'] } });
      check(verified.passed !== false && verified.status !== 'failed', 'knime_table_verify failed: ' + JSON.stringify(verified).slice(0, 400));
      return { rows: filtered.rows.length, verification: verified.status ?? verified.passed };
    });

    await step('canvas overview image (native SVG rendered locally)', 'visual', async () => {
      const ctx = await bind(projectId);
      const view = await raw('knime_canvas_view', { contextId: ctx.contextId, mode: 'overview' });
      check(view.ok, JSON.stringify(view.value?.error ?? view.value).slice(0, 300));
      const images = view.content.filter(c => c.type === 'image');
      check(images.length >= 1, 'no PNG returned');
      const omissions = (view.value.evidence ?? view.value).omissions ?? [];
      check(!omissions.some(o => o.kind === 'render-unstable'), 'render-unstable');
      return { images: await saveImages(view, 'overview'), renderer: (view.value.evidence ?? view.value).renderer?.name, reviewed: false };
    });

    await step('live editor viewport image', 'visual', async () => {
      const ctx = await bind(projectId);
      const view = await raw('knime_canvas_view', { contextId: ctx.contextId, mode: 'viewport' });
      check(view.ok, JSON.stringify(view.value?.error ?? view.value).slice(0, 300));
      check(view.content.some(c => c.type === 'image'), 'no PNG returned');
      return { images: await saveImages(view, 'viewport'), reviewed: false };
    });

    await step('selection is readable from the UI', 'functional', async () => {
      const selection = await call('knime_selection', {});
      check(selection.available === true && selection.projectId === projectId, 'selection unavailable or for another project: ' + JSON.stringify(selection).slice(0, 300));
      return { nodeIds: selection.nodeIds };
    });

    await step('client read-only switch refuses a change and leaves the graph unchanged', 'functional', async () => {
      const readOnly = await server({ KNIME_AGENT_ALLOW_WRITES: 'false' });
      try {
        const ctx = await readOnly.call('knime_context', { action: 'bind', projectId });
        const refused = await readOnly.raw('knime_gateway_call', { method: 'WorkflowService.executeWorkflowCommand', params: { projectId, workflowId: 'root', workflowCommand: { kind: 'add_node', position: { x: 600, y: 160 }, nodeFactory: { className: 'org.knime.base.node.io.tablecreator.TableCreator3NodeFactory' } } }, precondition: { contextId: ctx.contextId, expected: ctx.revisions } });
        check(!refused.ok && refused.value.error.code === 'WRITES_DISABLED' && refused.value.error.details.nativeDispatch === 'not_started', 'expected WRITES_DISABLED: ' + JSON.stringify(refused.value).slice(0, 300));
        check(JSON.parse(refused.content[0].text).error.code === 'WRITES_DISABLED', 'text block lacks the error');
        check((await readOnly.call('knime_workflow', { projectId, depth: 0 })).totalNodes === 2, 'graph changed');
      } finally { await readOnly.client.close(); }
    });

    await step('save, export, close and reopen; settings and data persist', 'persistence', async () => {
      await desktop('desktop.saveProject', { projectId });
      await until(async () => !(await call('knime_workflow', { projectId, depth: 0 })).dirty, 'save did not clear the dirty flag');
      const savedWait = await call('knime_wait', { session: session.id, condition: 'saved', projectId, timeoutMs: 30000 });
      // Export reads Windows file identities through Kernel32 (JNA) when Java has no fileKey.
      const exportCtx = await bind(projectId);
      const exported = await call('knime_core_call', { operation: 'core.workflow.export', args: { projectId, excludeData: false, maxBytes: 16 * 1048576, maxEntries: 2000 }, precondition: { contextId: exportCtx.contextId, expected: exportCtx.revisions ?? {} } });
      check(exported.manifestComplete === true && exported.savePerformed === false, 'export manifest incomplete: ' + JSON.stringify(exported).slice(0, 300));
      check(exported.manifest?.some(e => e.name.endsWith('/workflow.knime')), 'export lacks workflow.knime');
      const { createHash } = await import('node:crypto');
      check(createHash('sha256').update(await fs.readFile(exported.path)).digest('hex') === exported.sha256, 'export SHA-256 mismatch');
      await desktop('desktop.closeProject', { projectId });
      await until(async () => !(await gateway('ApplicationService.getState')).openProjects.some(p => p.projectId === projectId), 'project did not close');
      await desktop('desktop.openProject', { spaceId: 'local', spaceProviderId: 'local', itemId: item.id });
      projectId = (await until(async () => (await gateway('ApplicationService.getState')).openProjects.find(p => p.origin?.itemId === item.id), 'project did not reopen')).projectId;
      const snapshot = await call('knime_workflow', { projectId, depth: 1 });
      check(snapshot.nodes.length === 2 && snapshot.connections.length === 1, 'graph not persisted');
      const settings = await call('knime_settings', { projectId, nodeId: filterId });
      check(JSON.stringify(settings).includes('EnforceInclusion'), 'filter setting not persisted');
      const filtered = await call('knime_table', { projectId, nodeId: filterId, portIndex: 1 });
      check(JSON.stringify(filtered.rows.map(r => r.values)) === '[[1],[2],[3]]', 'saved table data not restored');
      const onDisk = await fs.readdir(path.join(workspace, itemName));
      check(onDisk.includes('workflow.knime'), 'workflow.knime missing on disk');
      return { knimeWaitSaved: JSON.stringify(savedWait).slice(0, 300), export: { entries: exported.manifest.length, bytes: exported.bytes ?? exported.size, sha256: exported.sha256 }, reopenedProjectId: projectId };
    });
  }
} finally {
  await client.close();
  report.finishedAt = new Date().toISOString();
  report.notCovered.push('Images were generated, not reviewed; review them before claiming visual quality.',
    'Claude Desktop UI toggles are checked by hand, not by this script.',
    'Selection by mouse click is not driven here (no DevTools port on an installed KNIME).',
    'UI responsiveness is not measured.');
  report.summary = { pass: report.steps.filter(s => s.status === 'pass').length, fail: report.steps.filter(s => s.status === 'fail').length };
  const out = path.resolve(values.out ?? path.join(root, 'docs', 'measurements', `install-${os.platform()}-${version}.json`));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ...report.summary, out }) + '\n');
  if (report.summary.fail) process.exitCode = 1;
}
