import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { ResolvedUrdfAssetBindingsV1 } from './resolved-urdf-adapter-v1.js'
import { parseResolvedUrdfV1 } from './resolved-urdf-adapter-v1.js'

function fixtureUrl(name: string): URL {
  if (name.includes('/') || name.includes('\\\\') || name.includes('..')) throw new Error('FIXTURE_NAME_INVALID')
  return new URL('./fixtures/' + name, import.meta.url)
}

export function readRobotAuthoringFixtureBytesV1(name: string): Uint8Array {
  return readFileSync(fixtureUrl(name))
}

export function readRobotAuthoringFixtureTextV1(name: string): string {
  return readFileSync(fixtureUrl(name), 'utf8')
}

export function makeResolvedUrdfAssetBindingsV1(): ResolvedUrdfAssetBindingsV1 {
  return {
    definition: {
      id: 'fixed-tool', name: 'Fixed tool robot',
      identification: { manufacturer: 'Open Digital Twin', model: 'Fixed Tool', productCode: 'FIXED-TOOL', serialNumberTemplate: null, motionDeviceCategory: 'ARTICULATED_ROBOT' },
      assetReferenceIds: ['asset-robot'],
      sourceConventions: { 'asset-robot': { linearUnit: 'meter', sourceToMeters: 1, orientation: { mode: 'up-axis', upAxis: 'z' } } },
      excludedGeometryOccurrenceKeys: [],
    },
    mechanics: { schemaVersion: 1, status: 'confirmed', sourceKind: 'resolved-urdf', sourceName: 'fixed-tool.urdf', calibrationRevision: 'r1' },
    geometryOccurrencesByLinkName: {
      LINK00: [{ occurrenceKey: 'base', assetReferenceId: 'asset-robot', linkLocalPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 }, collisionBoxes: [] }],
      LINK01: [{ occurrenceKey: 'shoulder', assetReferenceId: 'asset-robot', linkLocalPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 }, collisionBoxes: [] }],
      LINK02: [{ occurrenceKey: 'arm', assetReferenceId: 'asset-robot', linkLocalPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 }, collisionBoxes: [] }],
      TOOL: [{ occurrenceKey: 'tool', assetReferenceId: 'asset-robot', linkLocalPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }, statistics: { vertices: 0, triangles: 0, meshes: 0, materials: 0 }, collisionBoxes: [] }],
    },
    geometryAlignment: { kind: 'link-local' },
  }
}

export function parseResolvedUrdfFixtureWithV1(construct: string) {
  const xml = readRobotAuthoringFixtureTextV1('fixed-tool.urdf')
    .replace('type="revolute"', `type="${construct}"`)
    .replace('</joint>', construct === 'mimic' ? '<mimic joint="J2" multiplier="1"/></joint>' : '</joint>')
  return parseResolvedUrdfV1(xml, makeResolvedUrdfAssetBindingsV1())
}

describe('robot authoring fixture support', () => {
  it('rejects traversal in fixture names', () => {
    expect(() => readRobotAuthoringFixtureTextV1('../fixed-tool.urdf')).toThrow(/FIXTURE_NAME_INVALID/)
  })
})
