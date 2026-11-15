import test from 'node:test';
import assert from 'node:assert/strict';
import { allowWritesFromEnv, assertWriteAllowed, isMutation } from '../src/access-policy.mjs';

const published = { enabled: true, source: 'preference', readOperations: ['health', 'core.snapshot', 'core.table.read'], gatewayReadMethods: ['WorkflowService.getWorkflow'] };

test('the client switch is on unless explicitly turned off', () => {
  assert.equal(allowWritesFromEnv({}), true);
  assert.equal(allowWritesFromEnv({ KNIME_AGENT_ALLOW_WRITES: '' }), true);
  assert.equal(allowWritesFromEnv({ KNIME_AGENT_ALLOW_WRITES: 'true' }), true);
  for (const off of ['false', 'FALSE', '0', 'no', 'off']) assert.equal(allowWritesFromEnv({ KNIME_AGENT_ALLOW_WRITES: off }), false, off);
});

test('reads come from the session writePolicy, everything else is a write', () => {
  assert.equal(isMutation('core.snapshot', {}, published), false);
  assert.equal(isMutation('core.settings.patch', {}, published), true);
  assert.equal(isMutation('desktop.openProject', {}, published), true);
  assert.equal(isMutation('core.workflow.export', {}, published), true);
  assert.equal(isMutation('some.future.operation', {}, published), true);
  assert.equal(isMutation('gateway.call', { method: 'WorkflowService.getWorkflow' }, published), false);
  assert.equal(isMutation('gateway.call', { method: 'WorkflowService.executeWorkflowCommand' }, published), true);
  assert.equal(isMutation('gateway.call', { method: 'Unknown.method' }, published), true);
});

test('an older bundle without writePolicy falls back to the built-in read lists', () => {
  assert.equal(isMutation('core.table.read', {}, undefined), false);
  assert.equal(isMutation('gateway.call', { method: 'ApplicationService.getState' }, undefined), false);
  assert.equal(isMutation('core.execute', {}, undefined), true);
});

test('with writes off a mutation is refused before dispatch and reads pass', () => {
  assert.doesNotThrow(() => assertWriteAllowed({ operation: 'core.snapshot', args: {}, session: { writePolicy: published }, allowWrites: false }));
  assert.doesNotThrow(() => assertWriteAllowed({ operation: 'core.execute', args: {}, session: { writePolicy: published }, allowWrites: true }));
  assert.throws(() => assertWriteAllowed({ operation: 'gateway.call', args: { method: 'SpaceService.createWorkflow' }, session: { writePolicy: published }, allowWrites: false }), error => {
    assert.equal(error.code, 'WRITES_DISABLED');
    assert.equal(error.details.nativeDispatch, 'not_started');
    assert.equal(error.details.method, 'SpaceService.createWorkflow');
    assert.match(error.message, /Allow changes/);
    return true;
  });
});

test('a refused write tells the agent nothing changed instead of asking it to reconcile', async () => {
  const { structuredResult } = await import('../src/mcp-result.mjs');
  const result = structuredResult({ error: { code: 'WRITES_DISABLED', message: 'off', details: { nativeDispatch: 'not_started', operationId: 'x', reconciliation: {} } } }, true);
  const text = JSON.parse(result.content.find(c => c.type === 'text').text);
  assert.match(text.nextStep, /Nothing was changed/);
  assert.doesNotMatch(text.nextStep, /Reconcile/);
});
