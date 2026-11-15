// Builds artifacts/knime-agent-bridge-<version>.mcpb for Claude Desktop.
// Stages the server with production dependencies only, generates manifest.json from the
// live tool catalog (so the listed tools cannot drift), then validates and packs it with
// the pinned @anthropic-ai/mcpb CLI. Works the same on macOS and Windows.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'build', 'mcpb');
const mcpbCli = path.join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed with exit code ${result.status}`);
}

export async function manifest() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const { toolCatalog } = await import('../src/catalog.mjs');
  return {
    manifest_version: '0.3',
    name: 'knime-agent-bridge',
    display_name: 'KNIME Agent Bridge',
    version: pkg.version,
    description: 'Let Claude read and edit the workflows open in your local KNIME Analytics Platform.',
    long_description: 'Connects Claude to a KNIME Analytics Platform running on this computer with the KNIME Agent Bridge extension installed. '
      + 'Claude can inspect workflows, node settings, output tables and the canvas, and (unless turned off) add and configure nodes, run them and save. '
      + 'Communication is a local file queue: no network ports, accounts or cloud services. Not made by KNIME AG.',
    author: { name: 'KNIME Agent Bridge contributors' },
    repository: { type: 'git', url: 'https://github.com/juniper234/knime-agent-bridge' },
    homepage: 'https://github.com/juniper234/knime-agent-bridge',
    keywords: ['knime', 'workflow', 'data science', 'local'],
    server: {
      type: 'node',
      entry_point: 'src/server.mjs',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/src/server.mjs'],
        env: {
          KNIME_AGENT_ALLOW_WRITES: '${user_config.allow_writes}',
          KNIME_AGENT_CANVAS: '${user_config.enable_canvas}',
          KNIME_AGENT_BROWSER: '${user_config.browser_path}',
        },
      },
    },
    tools: toolCatalog.map(tool => ({ name: tool.name, description: tool.title })),
    user_config: {
      allow_writes: {
        type: 'boolean', title: 'Allow changes',
        description: 'Let Claude modify, run and save workflows. Turn off to keep Claude read-only. KNIME has its own switch under Preferences > KNIME > Agent Bridge; both must allow a change.',
        default: true, required: false,
      },
      enable_canvas: {
        type: 'boolean', title: 'Canvas images',
        description: 'Let Claude render pictures of the workflow canvas. Needs Google Chrome or Microsoft Edge on this computer.',
        default: false, required: false,
      },
      browser_path: {
        type: 'file', title: 'Browser for canvas images (optional)',
        description: 'Chrome, Edge or Chromium executable to use when neither is found automatically.',
        default: '', required: false,
      },
    },
    compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: pkg.engines.node } },
  };
}

/** Copy the server with production dependencies only into `target` (replacing it). */
export async function stageServer(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  for (const item of ['package.json', 'package-lock.json', 'README.md']) await fs.copyFile(path.join(root, item), path.join(target, item));
  await fs.cp(path.join(root, 'src'), path.join(target, 'src'), { recursive: true });
  // npm is npm.cmd on Windows, which only runs through a shell. Arguments are fixed strings.
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, shell: process.platform === 'win32' });
}

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  await stageServer(stage);
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(await manifest(), null, 2) + '\n');
  run(process.execPath, [mcpbCli, 'validate', path.join(stage, 'manifest.json')]);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const output = path.join(root, 'artifacts', `knime-agent-bridge-${pkg.version}.mcpb`);
  await fs.rm(output, { force: true });
  run(process.execPath, [mcpbCli, 'pack', stage, output]);
  const { size } = await fs.stat(output);
  process.stdout.write(JSON.stringify({ artifact: output, bytes: size }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
