import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { knimeExecutable, launchKnime } from '../scripts/launch.mjs';

const script = fileURLToPath(new URL('../scripts/launch.mjs', import.meta.url));
const preferencePath = workspace => path.join(workspace, '.metadata', '.plugins', 'org.eclipse.core.runtime', '.settings', 'org.knime.workbench.core.prefs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'knime-launch-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = path.join(directory, 'runtime');
  const workspace = path.join(runtime, 'workspace');
  const knime = path.join(directory, 'fake-knime');
  await fs.mkdir(runtime);
  return { directory, runtime, workspace, knime };
}

async function launch(f, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, KNIME_HOME: f.knime, KNIME_AGENT_RUNTIME: f.runtime },
    windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  return { code, stdout, stderr };
}

async function fakeInstallation(f) {
  await fs.mkdir(path.join(f.knime, 'configuration', 'org.eclipse.equinox.simpleconfigurator'), { recursive: true });
  await fs.writeFile(path.join(f.knime, 'configuration', 'config.ini'), 'eclipse.p2.data.area=@config.dir/../p2/\n');
  await fs.writeFile(path.join(f.knime, 'configuration', 'org.eclipse.equinox.simpleconfigurator', 'bundles.info'), '# fake installation, never executable\n');
  await fs.writeFile(path.join(f.knime, 'knime.ini'), '-vmargs\n-Xmx2g\n');
  await fs.mkdir(path.join(f.knime, 'p2', 'org.eclipse.equinox.p2.engine', 'profileRegistry'), { recursive: true });
}

test('live launch record prevents duplicate startup before a bridge session exists', async t => {
  const f = await fixture(t);
  const record = { pid: process.pid, workspace: f.workspace, startedAt: new Date().toISOString() };
  await fs.writeFile(path.join(f.runtime, 'launch.json'), JSON.stringify(record));
  const result = await launch(f);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { alreadyRunning: true, pid: process.pid, workspace: f.workspace, runtime: f.runtime });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.runtime, 'launch.json'), 'utf8')), record);
  await assert.rejects(fs.access(path.join(f.runtime, 'configuration')), { code: 'ENOENT' });
});

test('live launch record rejects another workspace without changing configuration', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.runtime, 'launch.json'), JSON.stringify({ pid: process.pid, workspace: f.workspace }));
  const result = await launch(f, ['--workspace', path.join(f.directory, 'other-workspace')]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /already.*running|already.*launch/i);
  await assert.rejects(fs.access(path.join(f.runtime, 'configuration')), { code: 'ENOENT' });
});

test('exclusive runtime launch lock blocks a second preparer without overwriting its lock', async t => {
  const f = await fixture(t);
  const lock = JSON.stringify({ pid: process.pid, token: 'first-preparer' });
  await fs.writeFile(path.join(f.runtime, 'launch.lock'), lock);
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /launch.*(progress|lock|prepar)/i);
  assert.equal(await fs.readFile(path.join(f.runtime, 'launch.lock'), 'utf8'), lock);
  await assert.rejects(fs.access(path.join(f.runtime, 'configuration')), { code: 'ENOENT' });
});

test('starting native session is reused even before readiness', async t => {
  const f = await fixture(t);
  const session = path.join(f.runtime, 'sessions', 'starting-fixture');
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, 'session.json'), JSON.stringify({ id: 'starting-fixture', pid: process.pid, workspace: pathToFileURL(f.workspace).href, status: 'starting', heartbeat: new Date().toISOString() }));
  const result = await launch(f);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).session, 'starting-fixture');
  await assert.rejects(fs.access(path.join(f.runtime, 'configuration')), { code: 'ENOENT' });
});

test('malformed launcher arguments fail before creating runtime files', async t => {
  for (const args of [['--unknown'], ['--workspace'], ['--workspace', '--unknown'], ['--workspace', ''], ['--workspace', 'first', '--workspace', 'second'], ['unexpected']]) {
    const f = await fixture(t);
    const result = await launch(f, args);
    assert.equal(result.code, 1, JSON.stringify(args));
    assert.match(result.stderr, /argument|option|workspace/i);
    assert.deepEqual(await fs.readdir(f.runtime), [], JSON.stringify(args));
  }
});

test('spawn failure returns no success record and releases the runtime lock', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(JSON.parse(result.stderr).error.message, /spawn|executable|ENOENT/i);
  await assert.rejects(fs.access(path.join(f.runtime, 'launch.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(f.runtime, 'launch.lock')), { code: 'ENOENT' });
});

test('new workspace is seeded with an explicit telemetry decline', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  await launch(f);
  const preferences = await fs.readFile(preferencePath(f.workspace), 'utf8');
  assert.match(preferences, /^eclipse\.preferences\.version=1$/m);
  assert.match(preferences, /^knime\.askedToSendStatistics=true$/m);
  assert.match(preferences, /^knime\.sendAnonymousStatistics=false$/m);
});

test('existing telemetry choice and unrelated workspace preferences remain byte-for-byte intact', async t => {
  for (const choice of ['knime.askedToSendStatistics=true\nknime.sendAnonymousStatistics=true', 'knime.askedToSendStatistics=true\nknime.sendAnonymousStatistics=false', 'knime.sendAnonymousStatistics=true', 'knime.askedToSendStatistics=true']) {
    const f = await fixture(t);
    await fakeInstallation(f);
    const preferences = `# User preferences\r\neclipse.preferences.version=1\r\n${choice}\r\nother.setting=keep\r\n`;
    const target = preferencePath(f.workspace);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, preferences);
    await launch(f);
    assert.equal(await fs.readFile(target, 'utf8'), preferences);
  }
});

test('telemetry defaults preserve unrelated preferences and an existing version declaration', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  const target = preferencePath(f.workspace);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, 'eclipse.preferences.version=1\nother.setting=keep\n');
  await launch(f);
  const preferences = await fs.readFile(target, 'utf8');
  assert.match(preferences, /^other.setting=keep$/m);
  assert.equal(preferences.match(/eclipse.preferences.version=/g).length, 1);
  assert.match(preferences, /^knime\.sendAnonymousStatistics=false$/m);
});

test('successful spawn holds the lock until its pid is published, then later launches reuse it', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  let signalSpawn, pendingChild;
  const reachedSpawn = new Promise(resolve => { signalSpawn = resolve; });
  const pendingLaunch = launchKnime({
    argv: [], env: { KNIME_HOME: f.knime, KNIME_AGENT_RUNTIME: f.runtime }, platform: 'win32',
    spawnProcess(executable, args, options) {
      assert.equal(executable, path.join(f.knime, 'knime.exe'));
      assert.ok(args.includes('-Dknime.agent.allowWrites=true'));
      assert.ok(args.includes('-Dknime.agent.openWorkflowsOnly=false'), 'test KNIME creates synthetic workflows through SpaceService');
      assert.equal(args[args.indexOf('-data') + 1], f.workspace);
      assert.equal(options.windowsHide, true);
      pendingChild = new EventEmitter();
      pendingChild.pid = process.pid;
      pendingChild.unref = () => {};
      signalSpawn();
      return pendingChild;
    },
  });
  await reachedSpawn;
  const competing = await launch(f);
  assert.equal(competing.code, 1);
  assert.match(competing.stderr, /launch preparation.*locked/i);
  await assert.rejects(fs.access(path.join(f.runtime, 'launch.json')), { code: 'ENOENT' });
  pendingChild.emit('spawn');
  const result = await pendingLaunch;
  assert.equal(result.pid, process.pid);
  const record = JSON.parse(await fs.readFile(path.join(f.runtime, 'launch.json'), 'utf8'));
  assert.equal(record.pid, process.pid);
  assert.equal(record.workspace, f.workspace);
  await assert.rejects(fs.access(path.join(f.runtime, 'launch.lock')), { code: 'ENOENT' });
  const subsequent = await launch(f);
  assert.equal(subsequent.code, 0, subsequent.stderr);
  assert.equal(JSON.parse(subsequent.stdout).alreadyRunning, true);
});

test('failure to record an already started process retains the guard against another launch', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  await assert.rejects(launchKnime({
    argv: [], env: { KNIME_HOME: f.knime, KNIME_AGENT_RUNTIME: f.runtime },
    spawnProcess() {
      const child = new EventEmitter();
      child.pid = process.pid;
      child.unref = () => {};
      fs.mkdir(path.join(f.runtime, 'launch.json')).then(() => child.emit('spawn'), error => child.emit('error', error));
      return child;
    },
  }));
  const lock = JSON.parse(await fs.readFile(path.join(f.runtime, 'launch.lock'), 'utf8'));
  assert.equal(lock.pid, process.pid);
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /launch preparation.*locked/i);
  assert.deepEqual((await fs.readdir(f.runtime)).filter(name => name.endsWith('.tmp')), []);
});

test('native launcher path follows the platform layout', () => {
  assert.equal(knimeExecutable('/Applications/KNIME 5.12.0.app/Contents/Eclipse', 'darwin'), '/Applications/KNIME 5.12.0.app/Contents/MacOS/knime');
  assert.equal(knimeExecutable('/opt/knime', 'linux'), '/opt/knime/knime');
  assert.match(knimeExecutable('C:\\KNIME', 'win32'), /knime\.exe$/);
});

test('an installed copy of the extension is dropped so only the developer JAR loads', async t => {
  const f = await fixture(t);
  await fakeInstallation(f);
  const info = path.join(f.knime, 'configuration', 'org.eclipse.equinox.simpleconfigurator', 'bundles.info');
  await fs.writeFile(info, '#version=1\norg.knime.core,5.12.0,plugins/org.knime.core.jar,4,false\nio.github.juniper234.knime.agentbridge,0.6.0.202610311350,plugins/io.github.juniper234.knime.agentbridge_0.6.0.202610311350.jar,4,true\n');
  let seenArgs;
  await launchKnime({
    argv: [], env: { KNIME_HOME: f.knime, KNIME_AGENT_RUNTIME: f.runtime, KNIME_AGENT_LAUNCH_VMARGS: ' -Dchromium.remote_debugging_port=9222 ' }, platform: 'win32',
    spawnProcess(executable, args) { seenArgs = args; const child = new EventEmitter(); child.pid = process.pid; child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child; },
  });
  const written = await fs.readFile(path.join(f.runtime, 'configuration', 'org.eclipse.equinox.simpleconfigurator', 'bundles.info'), 'utf8');
  const bridges = written.split('\n').filter(line => line.startsWith('io.github.juniper234.knime.agentbridge,'));
  assert.equal(bridges.length, 1);
  assert.doesNotMatch(bridges[0], /202610311350/);
  assert.match(written, /^org\.knime\.core,/m);
  assert.equal(seenArgs.at(-1), '-Dchromium.remote_debugging_port=9222');
});
