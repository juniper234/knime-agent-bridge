import test from 'node:test';
import assert from 'node:assert/strict';
import { readSelection } from '../src/catalog.mjs';

const fakeClient = (selection, snapshot) => ({ calls: [], async call(operation, args) { this.calls.push({ operation, args }); if (operation === 'desktop.selection') return selection; if (snapshot instanceof Error) throw snapshot; return snapshot; } });

test('selected gateway IDs are named from the snapshot', async () => {
  const client = fakeClient({ available: true, projectId: 'p', workflowId: 'root', nodeIds: ['root:2', 'root:9'] },
    { nodes: [{ id: '3:2', gatewayId: 'root:2', name: 'Column Filter', kind: 'native', factoryId: 'f', state: 'IDLE' }] });
  const result = await readSelection(client);
  assert.deepEqual(result.nodes, [
    { nodeId: 'root:2', nativeId: '3:2', name: 'Column Filter', customName: null, kind: 'native', factoryId: 'f', state: 'IDLE' },
    { nodeId: 'root:9', found: false },
  ]);
  assert.deepEqual(client.calls[1], { operation: 'core.snapshot', args: { projectId: 'p', depth: 0 } });
});

test('a nested workflow is passed through and an empty selection needs no snapshot', async () => {
  const nested = fakeClient({ available: true, projectId: 'p', workflowId: 'root:5', nodeIds: ['root:5:1'] }, { nodes: [] });
  await readSelection(nested);
  assert.equal(nested.calls[1].args.workflowId, 'root:5');
  const empty = fakeClient({ available: true, projectId: 'p', workflowId: 'root', nodeIds: [] });
  assert.deepEqual((await readSelection(empty)).nodeIds, []);
  assert.equal(empty.calls.length, 1);
});

test('the selection survives a failed snapshot and an unavailable UI store is passed on', async () => {
  const failing = await readSelection(fakeClient({ available: true, projectId: 'p', nodeIds: ['root:1'] }, Object.assign(new Error('boom'), { code: 'KNIME_ERROR' })));
  assert.equal(failing.nodes, null);
  assert.equal(failing.namingError.code, 'KNIME_ERROR');
  assert.deepEqual(failing.nodeIds, ['root:1']);
  const missing = await readSelection(fakeClient({ available: false, reason: 'KNIME UI selection store not found' }));
  assert.equal(missing.available, false);
});
