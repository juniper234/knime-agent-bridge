// Setup steps run by the Windows installer with its bundled Node.
//
// Installed layout (root = %LOCALAPPDATA%\KnimeAgentBridge):
//   node\node.exe            bundled Node.js (x64)
//   server\                  MCP server (src\server.mjs plus production node_modules)
//   setup\setup.mjs          this file
//   payload\manifest.json    versions and file names of the payload
//   payload\*.zip, *.mcpb    KNIME update site and Claude Desktop extension
//   install.json             what this installer changed, read by uninstall
//
// Commands (all print plain text lines for the installer log):
//   knime-running                exit 0 when no KNIME is running, 2 when one is
//   install --knime DIR [--extension] [--codex] [--claude]
//   check [--start] [--pause]    wait for a live KNIME session and read its health
//   uninstall                    undo what install.json records
//   node-in-use [--stop]         exit 3 while other programs run this install's node.exe
//
// The functions are exported so the logic is tested on any OS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SERVER_NAME = 'knime-agent';
export const FEATURE_IU = 'io.github.juniper234.knime.agentbridge.feature.feature.group';
export const BUNDLE_ID = 'io.github.juniper234.knime.agentbridge';

const here = path.dirname(fileURLToPath(import.meta.url));
const say = line => process.stdout.write(line + '\n');

// ---------- KNIME ----------

/** A KNIME home is the folder with knime.exe (or the macOS/Linux launcher), knime.ini and configuration\. */
export function isKnimeHome(dir, exists = fs.existsSync) {
  if (!dir) return false;
  return exists(path.join(dir, 'knime.ini')) && exists(path.join(dir, 'configuration', 'config.ini'));
}

/** KNIME version from the org.knime.core plugin folder or JAR name, or null. */
export function knimeVersion(dir, list = d => fs.readdirSync(d)) {
  try {
    const core = list(path.join(dir, 'plugins')).map(n => /^org\.knime\.core_(\d+\.\d+\.\d+)/.exec(n)).filter(Boolean).map(m => m[1]);
    return core.sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop() ?? null;
  } catch { return null; }
}

/** The bridge bundle line in bundles.info: {version} or null. */
export function installedBundle(dir, read = f => fs.readFileSync(f, 'utf8')) {
  try {
    const line = read(path.join(dir, 'configuration', 'org.eclipse.equinox.simpleconfigurator', 'bundles.info'))
      .split(/\r?\n/).find(l => l.startsWith(BUNDLE_ID + ','));
    return line ? { version: line.split(',')[1] } : null;
  } catch { return null; }
}

/** p2 director arguments for installing or removing the feature from the update-site zip. */
export function directorArgs({ repositoryZip, uninstall = false, data }) {
  const repository = 'jar:' + pathToFileURL(repositoryZip).href + '!/';
  return ['-nosplash', '-consoleLog', '--launcher.suppressErrors',
    '-application', 'org.eclipse.equinox.p2.director',
    '-repository', repository,
    uninstall ? '-uninstallIU' : '-installIU', FEATURE_IU,
    '-data', data];
}

export function knimeExecutable(dir, platform = process.platform) {
  if (platform === 'win32') return path.join(dir, 'knime.exe');
  if (platform === 'darwin') return path.resolve(dir, '..', 'MacOS', 'knime');
  return path.join(dir, 'knime');
}

export function knimeRunning(platform = process.platform, run = spawnSync) {
  if (platform === 'win32') {
    const r = run('tasklist', ['/FI', 'IMAGENAME eq knime.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return /"knime\.exe"/i.test(r.stdout ?? '');
  }
  const r = run('pgrep', ['-f', 'MacOS/knime|/knime '], { encoding: 'utf8' });
  return r.status === 0;
}

export function writable(dir) {
  const probe = path.join(dir, '.knime-agent-write-test-' + process.pid);
  try { fs.writeFileSync(probe, ''); fs.unlinkSync(probe); return true; } catch { return false; }
}

/** PowerShell command that runs one program elevated (UAC prompt), waits and returns its exit code. */
export function elevatedCommand(file, args) {
  const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
  // Start-Process joins ArgumentList with spaces, so each argument carries its own double quotes.
  const argumentLine = args.map(a => '"' + a + '"').join(' ');
  return `$p = Start-Process -FilePath ${quote(file)} -ArgumentList ${quote(argumentLine)} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
}

function runDirector(knime, args) {
  const exe = knimeExecutable(knime);
  if (process.platform === 'win32' && !writable(knime)) {
    say('KNIME is installed for all users, so Windows will ask for administrator permission.');
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevatedCommand(exe, args)], { stdio: 'inherit', windowsHide: true }).status;
  }
  return spawnSync(exe, args, { cwd: knime, stdio: 'inherit', windowsHide: true }).status;
}

export function installExtension({ knime, payload, manifest }) {
  if (!isKnimeHome(knime)) throw new Error(`No KNIME installation in ${knime}. Choose the folder that contains knime.exe.`);
  say(`KNIME ${knimeVersion(knime) ?? '(unknown version)'} found in ${knime}.`);
  const repositoryZip = path.join(payload, manifest.updateSite);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'knime-agent-p2-'));
  const before = installedBundle(knime);
  if (before?.version === manifest.bundleVersion) { say(`The KNIME extension ${before.version} is already installed.`); return { changed: false }; }
  if (before) {
    say(`Removing the installed extension ${before.version} first.`);
    const status = runDirector(knime, directorArgs({ repositoryZip, uninstall: true, data }));
    if (status !== 0) throw new Error(`Removing the old extension failed (exit ${status}). See ${path.join(data, '.metadata', '.log')}.`);
  }
  say('Installing the KNIME extension. This takes up to a minute.');
  const status = runDirector(knime, directorArgs({ repositoryZip, data }));
  const after = installedBundle(knime);
  if (status !== 0 || !after) throw new Error(`Installing the extension failed (exit ${status}). See ${path.join(data, '.metadata', '.log')}.`);
  say(`Installed the KNIME extension ${after.version}.`);
  return { changed: true, version: after.version };
}

// ---------- Codex and the ChatGPT desktop app (shared config.toml) ----------

export function codexConfigPath(env = process.env) {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

/** TOML string: a literal string when possible (no escaping of backslashes), otherwise a basic string. */
export function tomlString(value) {
  if (!/['\n\r]/.test(value)) return `'${value}'`;
  return JSON.stringify(value);
}

const ourHeader = /^\s*\[\s*mcp_servers\.(?:knime-agent|"knime-agent"|'knime-agent')\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
const anyHeader = /^\s*\[/;

/** Remove the knime-agent tables (including its .env sub-table) from config.toml text. */
export function removeServerBlock(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (anyHeader.test(line)) skipping = ourHeader.test(line);
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function serverBlock({ command, server, allowWrites = true }) {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(command)}`,
    `args = [${tomlString(server)}]`,
    '',
    `[mcp_servers.${SERVER_NAME}.env]`,
    `KNIME_AGENT_ALLOW_WRITES = "${allowWrites ? 'true' : 'false'}"`,
    '',
  ].join('\n');
}

/** Replace (or add) the knime-agent entry, leaving every other line untouched. */
export function updateCodexConfig(text, block) {
  const rest = removeServerBlock(text ?? '').replace(/\s+$/, '');
  if (!block) return rest ? rest + '\n' : '';
  return (rest ? rest + '\n\n' : '') + block;
}

function registerCodex({ root }) {
  const file = codexConfigPath();
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const next = updateCodexConfig(previous, serverBlock({ command: process.execPath, server: path.join(root, 'server', 'src', 'server.mjs') }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (previous !== null && !fs.existsSync(file + '.before-knime-agent')) fs.writeFileSync(file + '.before-knime-agent', previous);
  fs.writeFileSync(file, next);
  say(`Registered "${SERVER_NAME}" for Codex and the ChatGPT desktop app in ${file}.`);
  return { file };
}

function unregisterCodex() {
  const file = codexConfigPath();
  if (!fs.existsSync(file)) return;
  const previous = fs.readFileSync(file, 'utf8');
  const next = updateCodexConfig(previous, null);
  if (next !== previous) { fs.writeFileSync(file, next); say(`Removed "${SERVER_NAME}" from ${file}.`); }
}

// ---------- Claude Desktop ----------

function openClaudeExtension({ payload, manifest }) {
  const file = path.join(payload, manifest.mcpb);
  const known = process.platform !== 'win32' || spawnSync('reg', ['query', 'HKCR\\.mcpb'], { windowsHide: true }).status === 0;
  if (!known) { say('Claude Desktop was not found (no app opens .mcpb files). Install Claude Desktop, then double-click ' + file + '.'); return { opened: false }; }
  // Explorer opens the file with its registered app (Claude Desktop) and needs no shell quoting.
  const child = spawn(process.platform === 'win32' ? 'explorer.exe' : 'open', [file], { detached: true, stdio: 'ignore' });
  child.unref();
  say('Claude Desktop opened its install dialog for the KNIME Agent Bridge. Click Install there.');
  return { opened: true };
}

// ---------- programs using the bundled node.exe ----------

// Codex and the ChatGPT app start the MCP server with node\node.exe, and an open connection check
// window keeps it running too. Windows cannot replace or delete node.exe while any of them runs.
const NODE_USERS_PS = 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | ForEach-Object { '
  + '$parent = (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue).ProcessName; '
  + '"$($_.ProcessId)|$parent|$($_.ExecutablePath)" }';

/** Lines "pid|parent name|executable path" to the processes that run exe, other than self. */
export function parseNodeUsers(stdout, exe, self = process.pid) {
  const target = path.win32.normalize(exe).toLowerCase();
  return String(stdout ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [pid, parent, ...rest] = line.split('|');
    return { pid: Number(pid), parent: parent || 'unknown program', path: rest.join('|') };
  }).filter(p => Number.isSafeInteger(p.pid) && p.pid !== self && p.path && path.win32.normalize(p.path).toLowerCase() === target);
}

export function nodeUsers(exe, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'win32') return [];
  // -EncodedCommand (UTF-16LE base64) avoids Windows command-line quoting of the inner quotes.
  const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(NODE_USERS_PS, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  return parseNodeUsers(r.stdout, exe);
}

function stopProcesses(users, run = spawnSync) {
  for (const user of users) {
    const r = run('taskkill', ['/PID', String(user.pid), '/F'], { encoding: 'utf8', windowsHide: true });
    say(r.status === 0 ? `Stopped process ${user.pid} (started by ${user.parent}).` : `Could not stop process ${user.pid}: ${(r.stderr || r.stdout || '').trim()}`);
  }
}

// ---------- check ----------

async function check({ root, knime, start, timeoutMs = 180000 }) {
  const { BridgeClient } = await import(pathToFileURL(path.join(root, 'server', 'src', 'client.mjs')).href);
  const client = new BridgeClient({});
  const alive = async () => (await client.listSessions()).filter(s => s.alive);
  let sessions = await alive();
  if (!sessions.length && start && knime) {
    say('Starting KNIME. The first start can take a minute or two.');
    spawn(knimeExecutable(knime), [], { cwd: knime, detached: true, stdio: 'ignore', windowsHide: false }).unref();
  }
  const deadline = Date.now() + (sessions.length || !start ? 0 : timeoutMs);
  while (!sessions.length && Date.now() < deadline) { await new Promise(r => setTimeout(r, 3000)); sessions = await alive(); }
  if (!sessions.length) { say('No running KNIME with the bridge was found. Start KNIME and run this check again.'); return false; }
  if (sessions.length > 1) say(`${sessions.length} KNIME windows are running; checking the first one.`);
  const health = await client.call('health', {}, { session: sessions[0].id, timeoutMs: 30000 });
  say(`Connected: KNIME ${health.knimeVersion}, bridge ${health.bridgeVersion}, agents ${health.writePolicy?.enabled ? 'may' : 'may not'} change workflows.`);
  return true;
}

// ---------- command line ----------

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, '');
    if (rest[i + 1] && !rest[i + 1].startsWith('--')) options[key] = rest[++i]; else options[key] = true;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  const root = path.resolve(options.root ?? path.join(here, '..'));
  const payload = path.join(root, 'payload');
  const record = path.join(root, 'install.json');
  const state = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : {};
  const save = () => fs.writeFileSync(record, JSON.stringify(state, null, 2) + '\n');
  if (command === 'knime-running') { process.exitCode = knimeRunning() ? 2 : 0; return; }
  if (command === 'node-in-use') {
    const exe = path.join(root, 'node', 'node.exe');
    let users = nodeUsers(exe);
    if (users.length && options.stop) { stopProcesses(users); await new Promise(r => setTimeout(r, 1000)); users = nodeUsers(exe); }
    for (const user of users) say(`Still in use: process ${user.pid}, started by ${user.parent}.`);
    process.exitCode = users.length ? 3 : 0;
    return;
  }
  if (command === 'install') {
    const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json'), 'utf8'));
    let failed = false;
    const step = (name, fn) => { try { state[name] = fn(); save(); } catch (error) { failed = true; say('Problem: ' + error.message); } };
    if (options.extension) step('extension', () => ({ knime: path.resolve(options.knime), ...installExtension({ knime: path.resolve(options.knime), payload, manifest }) }));
    if (options.codex) step('codex', () => registerCodex({ root }));
    if (options.claude) step('claude', () => openClaudeExtension({ payload, manifest }));
    if (options.knime) { state.knime = path.resolve(options.knime); save(); }
    process.exitCode = failed ? 1 : 0;
    return;
  }
  if (command === 'check') {
    let ok = false;
    try { ok = await check({ root, knime: options.knime ?? state.knime, start: Boolean(options.start) }); }
    catch (error) { say('Problem: ' + error.message); }
    if (options.pause) { process.stdout.write('\nPress Enter to close this window.'); await new Promise(r => process.stdin.once('data', r)); }
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (command === 'uninstall') {
    if (state.codex) unregisterCodex();
    if (state.extension?.knime) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(payload, 'manifest.json'), 'utf8'));
        if (installedBundle(state.extension.knime)) {
          say('Removing the KNIME extension.');
          const data = fs.mkdtempSync(path.join(os.tmpdir(), 'knime-agent-p2-'));
          const status = runDirector(state.extension.knime, directorArgs({ repositoryZip: path.join(payload, manifest.updateSite), uninstall: true, data }));
          if (status !== 0) say(`Removing the KNIME extension failed (exit ${status}). Remove it in KNIME under Menu > Install Extensions > Installed.`);
        }
      } catch (error) { say('Problem: ' + error.message); }
    }
    if (state.claude) say('To remove it from Claude Desktop: Settings > Extensions > KNIME Agent Bridge > Uninstall.');
    return;
  }
  say('Unknown command. Use knime-running, node-in-use, install, check or uninstall.');
  process.exitCode = 64;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { say('Problem: ' + error.message); process.exitCode = 1; });
}
