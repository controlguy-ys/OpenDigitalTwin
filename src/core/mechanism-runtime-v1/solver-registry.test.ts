import { describe, expect, it } from 'vitest'

import { createSolverRegistryV1 } from './solver-registry.js'
import type { KinematicsSolverV1, MechanismDefinitionV1 } from './types.js'

function solver(solverKey: string, contractVersion: string): KinematicsSolverV1 {
  return Object.freeze({
    solverKey,
    contractVersion,
    describeCapabilities: () => Object.freeze({
      topologyKinds: Object.freeze(['tree'] as const),
      jointTypes: Object.freeze(['fixed'] as const),
      deterministicForward: true,
      inverse: false,
      jacobian: false,
      constraintProjection: false,
    }),
    validateDefinition: () => Object.freeze({ valid: true, errors: Object.freeze([]), warnings: Object.freeze([]) }),
    normalizeCoordinates: (_definition: MechanismDefinitionV1, coordinates: Readonly<Record<string, number>>) => coordinates,
    evaluateForward: () => { throw new Error('not used') },
  })
}

describe('createSolverRegistryV1', () => {
  it('requires an exact solver key and contract version with no fallback', () => {
    const alphaV1 = solver('alpha', '1')
    const alphaV2 = solver('alpha', '2')
    const betaV1 = solver('beta', '1')
    const registry = createSolverRegistryV1([betaV1, alphaV2, alphaV1])

    expect(registry.require('alpha', '1')).toBe(alphaV1)
    expect(registry.require('alpha', '2')).toBe(alphaV2)
    expect(() => registry.require('alpha', '3')).toThrow(expect.objectContaining({
      code: 'SOLVER_UNAVAILABLE', path: '$.solverRef',
    }))
    expect(() => registry.require('missing', '1')).toThrow(expect.objectContaining({
      code: 'SOLVER_UNAVAILABLE', path: '$.solverRef',
    }))
  })

  it('rejects duplicate exact identities and discovers descriptors in stable order', () => {
    const alphaV1 = solver('alpha', '1')
    const alphaV2 = solver('alpha', '2')
    const betaV1 = solver('beta', '1')

    expect(() => createSolverRegistryV1([alphaV1, solver('alpha', '1')])).toThrow(expect.objectContaining({
      code: 'SOLVER_REGISTRATION_DUPLICATE', path: '$.solvers[1]',
    }))
    expect(createSolverRegistryV1([betaV1, alphaV2, alphaV1]).list()).toEqual([
      { solverKey: 'alpha', contractVersion: '1', capabilities: alphaV1.describeCapabilities() },
      { solverKey: 'alpha', contractVersion: '2', capabilities: alphaV2.describeCapabilities() },
      { solverKey: 'beta', contractVersion: '1', capabilities: betaV1.describeCapabilities() },
    ])
  })

  it('reports deterministic forward kinematics without inventing optional operations', () => {
    const registry = createSolverRegistryV1([solver('tree', '1')])

    expect(registry.describeCapabilities()).toEqual({
      topologyKinds: ['tree'],
      jointTypes: ['fixed'],
      deterministicForward: true,
      inverse: false,
      jacobian: false,
      constraintProjection: false,
    })
  })

  it('detaches capability descriptors from mutable Solver-owned values', () => {
    const capabilities = {
      topologyKinds: ['tree'] as ('tree')[],
      jointTypes: ['fixed'] as ('fixed')[],
      deterministicForward: true as const,
      inverse: false,
      jacobian: false,
      constraintProjection: false,
    }
    const mutableCapabilitySolver = Object.freeze({ ...solver('tree', '1'), describeCapabilities: () => capabilities })
    const registry = createSolverRegistryV1([mutableCapabilitySolver])
    capabilities.topologyKinds.push('tree')

    expect(registry.list()[0]!.capabilities).toEqual({
      topologyKinds: ['tree'], jointTypes: ['fixed'], deterministicForward: true,
      inverse: false, jacobian: false, constraintProjection: false,
    })
    expect(Object.isFrozen(registry.list()[0]!.capabilities)).toBe(true)
  })

  it('does not alias distinct key/version pairs containing the former delimiter', () => {
    const first = solver('alpha\u0000beta', '1')
    const second = solver('alpha', 'beta\u00001')
    const registry = createSolverRegistryV1([first, second])

    expect(registry.require('alpha\u0000beta', '1')).toBe(first)
    expect(registry.require('alpha', 'beta\u00001')).toBe(second)
  })
})
