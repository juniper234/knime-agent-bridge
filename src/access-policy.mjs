// Client-side write switch. KNIME enforces the same rule in Java (WritePolicy); this
// copy exists so an MCP host setting can refuse changes before anything is queued.
// The read lists come from the selected session's writePolicy so both sides agree.
import { BridgeError } from './client.mjs';

// Only used for bundles older than 0.6.0, which do not publish writePolicy.
const FALLBACK_READS = ['bridge.diagnostics','canvas.capabilities','canvas.preview','canvas.viewport','context.bind','context.inspect','context.prune','context.release','context.usage',
  'core.describe','core.nodes.details','core.nodes.search','core.port.inspect','core.settings.get','core.settings.preview','core.snapshot','core.table.read',
  'dependency.inspect','desktop.describe','desktop.functions','desktop.selection','desktop.uiState','gateway.describe','health','operation.get'];
const FALLBACK_GATEWAY_READS = ['ApplicationService.getState','NodeRepositoryService.getNodeDescription','NodeRepositoryService.getNodeRepository','NodeRepositoryService.searchNodes',
  'SpaceService.getSpaceItem','SpaceService.getSpaceProviders','SpaceService.getSpaces','SpaceService.listWorkflowGroup',
  'WorkflowService.getNode','WorkflowService.getWorkflow','WorkflowService.getWorkflowBounds','WorkflowService.getWorkflowInfo','WorkflowService.getWorkflowMonitorState','WorkflowService.getWorkflowPortInfo'];

export const ENABLE_HINT = 'the "Allow changes" setting of the KNIME Agent Bridge extension in Claude Desktop (or KNIME_AGENT_ALLOW_WRITES=true)';

/** KNIME_AGENT_ALLOW_WRITES: unset or empty means allowed; false/0/no/off means read-only. */
export function allowWritesFromEnv(env = process.env) {
  const value = env.KNIME_AGENT_ALLOW_WRITES;
  if (value === undefined || value.trim() === '') return true;
  return !/^(false|0|no|off)$/i.test(value.trim());
}

export function isMutation(operation, args = {}, writePolicy) {
  const reads = Array.isArray(writePolicy?.readOperations) ? writePolicy.readOperations : FALLBACK_READS;
  const gatewayReads = Array.isArray(writePolicy?.gatewayReadMethods) ? writePolicy.gatewayReadMethods : FALLBACK_GATEWAY_READS;
  if (operation === 'gateway.call') return !gatewayReads.includes(args?.method);
  return !reads.includes(operation);
}

export function assertWriteAllowed({ operation, args, session, allowWrites }) {
  if (allowWrites || !isMutation(operation, args, session?.writePolicy)) return;
  throw new BridgeError('WRITES_DISABLED', `Changes are turned off for this agent connection. Reads still work; the user can allow changes with ${ENABLE_HINT}.`,
    { nativeDispatch: 'not_started', operation, ...(operation === 'gateway.call' ? { method: args?.method } : {}), disabledBy: 'client', enableAt: ENABLE_HINT });
}
