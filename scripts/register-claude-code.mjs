// Registers this checkout's MCP server with Claude Code for the current user.
//   node scripts/register-claude-code.mjs [--read-only] [--name knime]
// Claude Desktop users install artifacts/knime-agent-bridge-<version>.mcpb instead.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { 'read-only': { type: 'boolean', default: false }, name: { type: 'string', default: 'knime' } } });
const server = path.join(root, 'src', 'server.mjs');
const claude = process.env.CLAUDE_BIN || 'claude';
const shell = process.platform === 'win32';
const run = args => { const result = spawnSync(claude, args, { encoding: 'utf8', windowsHide: true, shell }); if (result.error) throw result.error; return result; };

const existing = run(['mcp', 'get', values.name]);
if (existing.status === 0) {
  if (existing.stdout.includes(server)) {
    console.log(JSON.stringify({ registered: true, alreadyConfigured: true, name: values.name, server, note: 'To change --read-only, run `claude mcp remove ' + values.name + '` first.' }));
    process.exit(0);
  }
  throw new Error(`A Claude Code server named "${values.name}" already exists and points elsewhere. Inspect it with \`claude mcp get ${values.name}\` before replacing it.`);
}
if (!/No MCP server named/i.test(existing.stdout + existing.stderr)) throw new Error(existing.stderr || existing.stdout || 'Could not inspect the Claude Code MCP configuration.');
const env = ['-e', `KNIME_AGENT_ALLOW_WRITES=${values['read-only'] ? 'false' : 'true'}`];
const add = run(['mcp', 'add', '--scope', 'user', ...env, values.name, '--', process.execPath, server]);
if (add.status !== 0) throw new Error(add.stderr || add.stdout || 'Claude Code MCP registration failed.');
console.log(JSON.stringify({ registered: true, name: values.name, command: process.execPath, server, allowWrites: !values['read-only'], note: 'Start a new Claude Code session or run /mcp to load the tools.' }));
