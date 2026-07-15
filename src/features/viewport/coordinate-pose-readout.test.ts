import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { computeActualTcpPoseReadout } from './coordinate-pose-readout'

function transform(
  position: readonly [number, number, number],
  rpyDeg: readonly [number, number, number],
): Matrix4 {
  const euler = new Euler(
    rpyDeg[0] * Math.PI / 180,
    rpyDeg[1] * Math.PI / 180,
    rpyDeg[2] * Math.PI / 180,
    'ZYX',
  )
  return new Matrix4().compose(
    new Vector3(...position), new Quaternion().setFromEuler(euler), new Vector3(1, 1, 1),
  )
}

describe('Actual TCP pose readout', () => {
  it('converts the same TCP World matrix into World, MCP, and Robot Base frames', () => {
    const mcpWorld = transform([2, 3, 0], [0, 0, 30])
    const baseInMcp = transform([1, 0, 0], [0, 20, 0])
    const tcpInBase = transform([0, 0, 0.5], [10, 0, 0])
    const baseWorld = mcpWorld.clone().multiply(baseInMcp)
    const tcpWorld = baseWorld.clone().multiply(tcpInBase)

    const matrices = {
      world: new Matrix4().identity().elements,
      mcp: mcpWorld.elements,
      base: baseWorld.elements,
      tcp: tcpWorld.elements,
    }
    expect(computeActualTcpPoseReadout(matrices, 'base')).toMatchObject({
      xyzMm: [0, 0, 500], rpyDeg: [10, 0, 0],
    })
    const mcp = computeActualTcpPoseReadout(matrices, 'mcp')
    expect(mcp.xyzMm[0]).toBeCloseTo(1171.01, 2)
    expect(mcp.xyzMm[1]).toBeCloseTo(0, 5)
    expect(mcp.xyzMm[2]).toBeCloseTo(469.846, 2)
    expect(mcp.rpyDeg).toEqual([10, 20, 0])
    const world = computeActualTcpPoseReadout(matrices, 'world')
    expect(world.xyzMm[0]).toBeCloseTo(3014.124, 2)
    expect(world.xyzMm[1]).toBeCloseTo(3585.505, 2)
    expect(world.xyzMm[2]).toBeCloseTo(469.846, 2)
    expect(world.rpyDeg).toEqual([10, 20, 30])
  })
})
