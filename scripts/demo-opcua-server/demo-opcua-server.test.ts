// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AttributeIds,
  DataType,
  OPCUAClient,
  StatusCodes,
} from 'node-opcua'
import { describe, expect, it } from 'vitest'

import { createDemoOpcUaServer } from './demo-opcua-server.js'

describe('OpenDigitalTwin demo OPC UA Server', () => {
  it('serves B&R-compatible ObjectPos and Robot nodes in namespace 5', async () => {
    const pkiRootDir = await mkdtemp(join(tmpdir(), 'open-digital-twin-demo-opcua-'))
    const server = createDemoOpcUaServer({
      host: '127.0.0.1',
      advertisedHost: '127.0.0.1',
      port: 0,
      tickMs: 20,
      pkiRootDir,
    })
    const client = OPCUAClient.create({ endpointMustExist: false })
    let connected = false

    try {
      const started = await server.start()
      expect(started.namespaceIndex).toBe(5)
      expect(started.nodeIds.objectPos[0]?.X).toBe('ns=5;s=::Sample6X:ObjectPos[0].X')
      expect(started.nodeIds.robot.Q1).toBe('ns=5;s=::Sample6X:Rob.Q1')

      await client.connect(started.endpointUrl)
      connected = true
      const session = await client.createSession()
      try {
        const objectX = await session.read({
          nodeId: started.nodeIds.objectPos[0]!.X,
          attributeId: AttributeIds.Value,
        })
        expect(objectX.statusCode).toBe(StatusCodes.Good)
        expect(objectX.value.dataType).toBe(DataType.Double)
        expect(Number.isFinite(objectX.value.value)).toBe(true)

        const writeResult = await session.write({
          nodeId: started.nodeIds.button,
          attributeId: AttributeIds.Value,
          value: { value: { dataType: DataType.Int32, value: 1 } },
        })
        expect(writeResult).toBe(StatusCodes.Good)

        await new Promise((resolve) => setTimeout(resolve, 60))
        const q1 = await session.read({
          nodeId: started.nodeIds.robot.Q1,
          attributeId: AttributeIds.Value,
        })
        expect(q1.statusCode).toBe(StatusCodes.Good)
        expect(q1.value.value).not.toBe(0)
      } finally {
        await session.close()
      }
    } finally {
      if (connected) await client.disconnect()
      await server.stop()
      await rm(pkiRootDir, { recursive: true, force: true })
    }
  }, 30_000)
})
