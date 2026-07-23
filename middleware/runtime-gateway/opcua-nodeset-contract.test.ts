// @vitest-environment node

import { nodesets } from 'node-opcua-nodesets'
import { describe, expect, it } from 'vitest'

import {
  assertRoboticsNodeSetContractV1,
  ROBOTICS_NODESET_FILES_V1,
} from './opcua-nodeset-contract.js'

describe('OPC UA Robotics NodeSet contract v1', () => {
  it('loads Standard, DI, IA, and Robotics in dependency order', () => {
    expect(ROBOTICS_NODESET_FILES_V1).toEqual([
      nodesets.standard,
      nodesets.di,
      nodesets.ia,
      nodesets.robotics,
    ])
  })

  it('pins the published Robotics v1.02 namespace', async () => {
    await expect(assertRoboticsNodeSetContractV1()).resolves.toMatchObject({
      namespaceUri: 'http://opcfoundation.org/UA/Robotics/',
      version: '1.02',
      publicationDate: '2025-09-08',
    })
  })
})
