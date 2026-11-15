import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {defaultRuntimeDirectory} from '../src/client.mjs';

test('default runtime matches the bridge bundle default (~/.knime-agent/runtime)', () => {
  assert.equal(defaultRuntimeDirectory({}), path.join(os.homedir(), '.knime-agent', 'runtime'));
});

test('KNIME_AGENT_RUNTIME overrides the default runtime', () => {
  const custom = path.join(os.tmpdir(), 'custom runtime');
  assert.equal(defaultRuntimeDirectory({KNIME_AGENT_RUNTIME: custom}), path.resolve(custom));
});
