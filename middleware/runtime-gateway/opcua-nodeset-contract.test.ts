// @vitest-environment node

import { nodesets } from 'node-opcua-nodesets'
import { SaxesParser } from 'saxes'
import { describe, expect, it } from 'vitest'

import {
  assertRoboticsNodeSetContractV1,
  ROBOTICS_NODESET_FILES_V1,
} from './opcua-nodeset-contract.js'

const ROBOTICS_URI = 'http://opcfoundation.org/UA/Robotics/'
const DI_URI = 'http://opcfoundation.org/UA/DI/'
const IA_URI = 'http://opcfoundation.org/UA/IA/'
const STANDARD_URI = 'http://opcfoundation.org/UA/'

type ReadFixture = (path: string) => Promise<Uint8Array>

function roboticsXml(options: {
  modelUri?: string
  version?: string
  publicationDate?: string
  requiredUris?: readonly string[]
} = {}): string {
  const requiredUris = options.requiredUris ?? [STANDARD_URI, DI_URI, IA_URI]
  return `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <Models>
    <Model ModelUri="${options.modelUri ?? ROBOTICS_URI}" Version="${options.version ?? '1.02'}" PublicationDate="${options.publicationDate ?? '2025-09-08T00:00:00Z'}">
      ${requiredUris.map((uri) => `<RequiredModel ModelUri="${uri}" />`).join('\n')}
    </Model>
  </Models>
</UANodeSet>`
}

function reads(source: string | Uint8Array): ReadFixture {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source
  return async () => bytes
}

async function expectMismatch(readFile: ReadFixture): Promise<void> {
  await expect(assertRoboticsNodeSetContractV1({ readFile })).rejects.toMatchObject({
    code: 'OPC_UA_ROBOTICS_NODESET_MISMATCH',
  })
}

describe('OPC UA Robotics NodeSet contract v1', () => {
  it('loads Standard, DI, IA, and Robotics in dependency order', () => {
    expect(ROBOTICS_NODESET_FILES_V1).toEqual([
      nodesets.standard,
      nodesets.di,
      nodesets.ia,
      nodesets.robotics,
    ])
    expect(Object.isFrozen(ROBOTICS_NODESET_FILES_V1)).toBe(true)
    expect(() => {
      ;(ROBOTICS_NODESET_FILES_V1 as string[]).push('copied-fallback.xml')
    }).toThrow(TypeError)
  })

  it('pins the published Robotics v1.02 namespace', async () => {
    await expect(assertRoboticsNodeSetContractV1()).resolves.toMatchObject({
      namespaceUri: ROBOTICS_URI,
      version: '1.02',
      publicationDate: '2025-09-08',
    })
  })

  it('rejects a live Robotics Model with the wrong URI', async () => {
    await expectMismatch(reads(roboticsXml({ modelUri: 'urn:spoofed:robotics' })))
  })

  it.each([
    ['version', roboticsXml({ version: '1.03' })],
    ['publication date', roboticsXml({ publicationDate: '2025-09-09T00:00:00Z' })],
  ])('rejects a live Robotics Model with the wrong %s', async (_name, source) => {
    await expectMismatch(reads(source))
  })

  it('rejects a live Robotics Model missing DI', async () => {
    const source = roboticsXml({ requiredUris: [STANDARD_URI, IA_URI] })
      .replace('</Model>', `<Spoof><RequiredModel ModelUri="${DI_URI}" /></Spoof></Model>`)
    await expectMismatch(reads(source))
  })

  it('rejects a live Robotics Model missing IA', async () => {
    await expectMismatch(reads(roboticsXml({ requiredUris: [STANDARD_URI, DI_URI] })))
  })

  it('rejects malformed XML instead of accepting parsed fragments', async () => {
    await expectMismatch(reads(`${roboticsXml()}<`))
  })

  it('rejects malformed fatal UTF-8 through the read seam', async () => {
    await expectMismatch(reads(new Uint8Array([0xc3, 0x28])))
  })

  it('rejects an async file read failure through the read seam', async () => {
    await expectMismatch(async () => {
      throw new Error('read failure')
    })
  })

  it('does not accept a Robotics Model spoofed inside an XML comment', async () => {
    const spoofedModel = roboticsXml()
      .replace('<?xml version="1.0" encoding="utf-8"?>', '')
      .replace('<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">', '')
      .replace('</UANodeSet>', '')
    const liveWrongModel = roboticsXml({ modelUri: 'urn:spoofed:robotics' })
    const source = liveWrongModel.replace('<Models>', `<Models><!-- ${spoofedModel} -->`)

    await expectMismatch(reads(source))
  })

  it('rejects a UANodeSet nested below a Wrapper root', async () => {
    const nestedNodeSet = roboticsXml().replace('<?xml version="1.0" encoding="utf-8"?>', '')
    await expectMismatch(reads(`<?xml version="1.0" encoding="utf-8"?><Wrapper>${nestedNodeSet}</Wrapper>`))
  })

  it('rejects duplicate live Robotics Model entries', async () => {
    const secondModel = `<Model ModelUri="${ROBOTICS_URI}" Version="1.02" PublicationDate="2025-09-08T00:00:00Z">
      <RequiredModel ModelUri="${STANDARD_URI}" />
      <RequiredModel ModelUri="${DI_URI}" />
      <RequiredModel ModelUri="${IA_URI}" />
    </Model>`
    const source = roboticsXml().replace('</Models>', `${secondModel}</Models>`)
    expect(() => new SaxesParser({ xmlns: true }).write(source).close()).not.toThrow()

    await expect(assertRoboticsNodeSetContractV1({ readFile: reads(source) })).rejects.toMatchObject({
      code: 'OPC_UA_ROBOTICS_NODESET_MISMATCH',
      message: 'OPC_UA_ROBOTICS_NODESET_MISMATCH: expected exactly one live Robotics Model, received 2.',
    })
  })
})
