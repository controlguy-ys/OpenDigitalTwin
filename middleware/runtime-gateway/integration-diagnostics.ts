import {
  validateRuntimeIntegrationDiagnosticsV1,
  type RuntimeIntegrationDiagnosticsV1,
} from '../../src/core/runtime-protocol/integration-diagnostics-v1.js'
import type { CommandResultV1 } from '../../src/core/runtime-protocol/v1.js'
import type { BrowserPublisherLeaseManagerV1 } from './browser-publisher-lease.js'

export interface RuntimeIntegrationDiagnosticsBuilderV1 {
  snapshot(): RuntimeIntegrationDiagnosticsV1
  publishCommand(result: CommandResultV1): void
  lastCommand(): CommandResultV1 | null
}

export function createRuntimeIntegrationDiagnosticsV1(options: Readonly<{
  nowMs: () => number
  readContext: () => Readonly<{ projectId: string | null; revisionId: string | null; configRevision: string | null }>
  readServerModel: () => Readonly<{
    standardNodeSets: 'disabled' | 'loaded' | 'faulted'
    roboticsModel: 'disabled' | 'ready' | 'faulted'
    productModel: 'disabled' | 'ready' | 'faulted'
    activeSessionCount: number
    lastError: string | null
  }>
  lease: BrowserPublisherLeaseManagerV1
}>): RuntimeIntegrationDiagnosticsBuilderV1 {
  let lastCommandResult: CommandResultV1 | null = null
  const snapshot = (): RuntimeIntegrationDiagnosticsV1 => {
    const context = options.readContext()
    const inactive = context.projectId === null
    const server = inactive
      ? { standardNodeSets: 'disabled' as const, roboticsModel: 'disabled' as const, productModel: 'disabled' as const, activeSessionCount: 0, lastError: null }
      : options.readServerModel()
    const lease = options.lease.snapshot()
    return validateRuntimeIntegrationDiagnosticsV1({
      type: 'runtime-integration-diagnostics-v1', protocolVersion: 1, observedAtMs: options.nowMs(),
      projectId: context.projectId, revisionId: context.revisionId, configRevision: context.configRevision,
      serverModel: { ...server, maximumSessionCount: 16 }, browserPublisher: lease, lastCommandResult,
    })
  }
  return Object.freeze({
    snapshot,
    publishCommand(result: CommandResultV1) { lastCommandResult = result },
    lastCommand: () => lastCommandResult,
  })
}
