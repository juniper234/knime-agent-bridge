// Builds artifacts/KNIME-Agent-Bridge-Setup-<version>.exe, a per-user Windows installer (x64)
// that bundles Node.js, the MCP server, the KNIME update site and the Claude Desktop extension.
// Runs on macOS or Windows. NSIS: on Windows a native makensis (MAKENSIS=<path> or on PATH);
// on macOS a Docker container (installer/windows/nsis.Dockerfile), because the native macOS 27
// makensis crashes with std::bad_alloc. KNIME_AGENT_NSIS=native|docker overrides the choice.
//
// Inputs that must already exist:
//   releng/update-site/target/knime-agent-bridge-update-site-<version>.zip   (mvn -B verify)
//   artifacts/knime-agent-bridge-<version>.mcpb                              (npm run build:mcpb)
// Node.js is downloaded once from nodejs.org into build/cache and checked against the pinned SHA-256.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageServer } from './build-mcpb.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = { version: '26.13.0', file: 'node-v26.13.0-win-x64.zip', sha256: 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed with exit code ${result.status}`);
}

function makensis(defines, script) {
  const mode = process.env.KNIME_AGENT_NSIS || (process.platform === 'darwin' ? 'docker' : 'native');
  if (mode === 'native') {
    run(process.env.MAKENSIS || 'makensis', ['-V2', ...Object.entries(defines).map(([k, v]) => `-D${k}=${v}`), script]);
    return;
  }
  // The repository is mounted at /work; every path handed to makensis must lie inside it.
  const inside = file => {
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${file} is outside the repository and cannot be mounted.`);
    return '/work/' + relative.split(path.sep).join('/');
  };
  run('docker', ['build', '-q', '-t', 'knime-agent-nsis', '-f', path.join(root, 'installer', 'windows', 'nsis.Dockerfile'), path.join(root, 'installer', 'windows')], { stdio: ['ignore', 'ignore', 'inherit'] });
  run('docker', ['run', '--rm', '-v', `${root}:/work`, 'knime-agent-nsis', '-V2', ...Object.entries(defines).map(([k, v]) => `-D${k}=${path.isAbsolute(v) ? inside(v) : v}`), inside(script)]);
}

const sha256 = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function nodeZip() {
  const cache = path.join(root, 'build', 'cache');
  const file = path.join(cache, NODE.file);
  if (!existsSync(file)) {
    await fs.mkdir(cache, { recursive: true });
    const url = `https://nodejs.org/dist/v${NODE.version}/${NODE.file}`;
    process.stdout.write(`Downloading ${url}\n`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
    await fs.writeFile(file + '.partial', Buffer.from(await response.arrayBuffer()));
    await fs.rename(file + '.partial', file);
  }
  const actual = await sha256(file);
  if (actual !== NODE.sha256) { await fs.rm(file); throw new Error(`${NODE.file} SHA-256 ${actual} does not match the pinned ${NODE.sha256}; the file was removed.`); }
  return file;
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const updateSite = path.join(root, 'releng', 'update-site', 'target', `knime-agent-bridge-update-site-${version}.zip`);
  const mcpb = path.join(root, 'artifacts', `knime-agent-bridge-${version}.mcpb`);
  for (const [file, how] of [[updateSite, 'mvn -B verify'], [mcpb, 'npm run build:mcpb']]) if (!existsSync(file)) throw new Error(`Missing ${path.relative(root, file)}. Build it first with: ${how}`);
  const plugins = path.join(root, 'releng', 'update-site', 'target', 'repository', 'plugins');
  const jar = (await fs.readdir(plugins)).find(n => n.startsWith('io.github.juniper234.knime.agentbridge_') && n.endsWith('.jar'));
  if (!jar) throw new Error('No bridge JAR in ' + plugins);
  const bundleVersion = jar.slice('io.github.juniper234.knime.agentbridge_'.length, -4);

  const stage = path.join(root, 'build', 'installer');
  await fs.rm(stage, { recursive: true, force: true });
  await stageServer(path.join(stage, 'server'));
  await fs.mkdir(path.join(stage, 'setup'), { recursive: true });
  await fs.copyFile(path.join(root, 'installer', 'windows', 'setup.mjs'), path.join(stage, 'setup', 'setup.mjs'));
  await fs.mkdir(path.join(stage, 'payload'), { recursive: true });
  await fs.copyFile(updateSite, path.join(stage, 'payload', path.basename(updateSite)));
  await fs.copyFile(mcpb, path.join(stage, 'payload', path.basename(mcpb)));
  await fs.writeFile(path.join(stage, 'payload', 'manifest.json'), JSON.stringify({ version, bundleVersion, updateSite: path.basename(updateSite), mcpb: path.basename(mcpb), node: NODE.version }, null, 2) + '\n');

  // Only node.exe and its license are needed; npm is not shipped.
  const zip = await nodeZip();
  const inner = `node-v${NODE.version}-win-x64`;
  // bsdtar reads zip archives on macOS and on Windows 10+.
  run('tar', ['-xf', zip, '-C', stage, `${inner}/node.exe`, `${inner}/LICENSE`]);
  await fs.rename(path.join(stage, inner), path.join(stage, 'node'));

  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const output = path.join(root, 'artifacts', `KNIME-Agent-Bridge-Setup-${version}.exe`);
  await fs.rm(output, { force: true });
  makensis({ VERSION: version, STAGE: stage, OUTFILE: output }, path.join(root, 'installer', 'windows', 'installer.nsi'));
  const { size } = await fs.stat(output);
  process.stdout.write(JSON.stringify({ artifact: output, bytes: size, sha256: await sha256(output), node: NODE.version, bundleVersion }) + '\n');
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
