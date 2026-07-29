import { failMechanismV1 } from './errors.js'
import type { KinematicsSolverV1, SolverCapabilitiesV1, SolverDescriptorV1 } from './types.js'

export interface SolverRegistryV1 {
  readonly list: () => readonly SolverDescriptorV1[]
  readonly ['require']: (solverKey: string, contractVersion: string) => KinematicsSolverV1
  readonly describeCapabilities: () => SolverCapabilitiesV1
}

function compareIdentity(left: SolverDescriptorV1, right: SolverDescriptorV1): number {
  if (left.solverKey < right.solverKey) return -1
  if (left.solverKey > right.solverKey) return 1
  if (left.contractVersion < right.contractVersion) return -1
  if (left.contractVersion > right.contractVersion) return 1
  return 0
}

function snapshotCapabilities(value: SolverCapabilitiesV1): SolverCapabilitiesV1 {
  return Object.freeze({
    topologyKinds: Object.freeze([...value.topologyKinds].sort()),
    jointTypes: Object.freeze([...value.jointTypes].sort()),
    deterministicForward: true,
    inverse: value.inverse,
    jacobian: value.jacobian,
    constraintProjection: value.constraintProjection,
  })
}

function frozenCapabilities(capabilities: readonly SolverCapabilitiesV1[]): SolverCapabilitiesV1 {
  const topologyKinds = [...new Set(capabilities.flatMap((value) => value.topologyKinds))].sort()
  const jointTypes = [...new Set(capabilities.flatMap((value) => value.jointTypes))].sort()
  return Object.freeze({
    topologyKinds: Object.freeze(topologyKinds),
    jointTypes: Object.freeze(jointTypes),
    deterministicForward: true,
    inverse: capabilities.some((value) => value.inverse),
    jacobian: capabilities.some((value) => value.jacobian),
    constraintProjection: capabilities.some((value) => value.constraintProjection),
  })
}

export function createSolverRegistryV1(
  solvers: readonly KinematicsSolverV1[],
): SolverRegistryV1 {
  const byKey = new Map<string, Map<string, KinematicsSolverV1>>()
  const descriptors: SolverDescriptorV1[] = []
  const capabilities: SolverCapabilitiesV1[] = []
  for (const [index, solver] of solvers.entries()) {
    const byVersion = byKey.get(solver.solverKey) ?? new Map<string, KinematicsSolverV1>()
    if (byVersion.has(solver.contractVersion)) {
      failMechanismV1('SOLVER_REGISTRATION_DUPLICATE', `$.solvers[${index}]`, 'Solver key and contract version must be unique.')
    }
    byVersion.set(solver.contractVersion, solver)
    byKey.set(solver.solverKey, byVersion)
    const capabilitySnapshot = snapshotCapabilities(solver.describeCapabilities())
    capabilities.push(capabilitySnapshot)
    descriptors.push(Object.freeze({
      solverKey: solver.solverKey,
      contractVersion: solver.contractVersion,
      capabilities: capabilitySnapshot,
    }))
  }
  const list = Object.freeze(descriptors.slice().sort(compareIdentity))
  const aggregateCapabilities = frozenCapabilities(capabilities)

  return Object.freeze({
    list: () => list,
    ['require']: (solverKey: string, contractVersion: string) => {
      const solver = byKey.get(solverKey)?.get(contractVersion)
      return solver ?? failMechanismV1('SOLVER_UNAVAILABLE', '$.solverRef', 'No Solver matches the requested key and contract version.')
    },
    describeCapabilities: () => aggregateCapabilities,
  })
}
