import { readFile } from 'node:fs/promises'

import { nodesets } from 'node-opcua-nodesets'
import { SaxesParser, type SaxesTagNS } from 'saxes'

export const OPC_UA_ROBOTICS_NAMESPACE_URI_V1 =
  'http://opcfoundation.org/UA/Robotics/' as const

export const ROBOTICS_NODESET_FILES_V1 = Object.freeze([
  nodesets.standard,
  nodesets.di,
  nodesets.ia,
  nodesets.robotics,
])

const OPC_UA_ROBOTICS_NODESET_MISMATCH = 'OPC_UA_ROBOTICS_NODESET_MISMATCH'
const OPC_UA_NODESET_XML_NAMESPACE_URI = 'http://opcfoundation.org/UA/2011/03/UANodeSet.xsd'
const OPC_UA_DI_NAMESPACE_URI = 'http://opcfoundation.org/UA/DI/'
const OPC_UA_IA_NAMESPACE_URI = 'http://opcfoundation.org/UA/IA/'
const OPC_UA_ROBOTICS_VERSION_V1 = '1.02'
const OPC_UA_ROBOTICS_PUBLICATION_DATE_V1 = '2025-09-08T00:00:00Z'

export type RoboticsNodeSetContractV1 = Readonly<{
  namespaceUri: typeof OPC_UA_ROBOTICS_NAMESPACE_URI_V1
  version: typeof OPC_UA_ROBOTICS_VERSION_V1
  publicationDate: '2025-09-08'
}>

export type RoboticsNodeSetReadFileV1 = (path: string) => Promise<Uint8Array>

export type RoboticsNodeSetContractOptionsV1 = Readonly<{
  readFile?: RoboticsNodeSetReadFileV1
}>

class RoboticsNodeSetMismatchError extends Error {
  readonly code = OPC_UA_ROBOTICS_NODESET_MISMATCH

  constructor(detail: string) {
    super(`${OPC_UA_ROBOTICS_NODESET_MISMATCH}: ${detail}`)
    this.name = 'RoboticsNodeSetMismatchError'
  }
}

function mismatch(detail: string): never {
  throw new RoboticsNodeSetMismatchError(detail)
}

function requiredAttribute(tag: SaxesTagNS, name: string): string {
  const value = tag.attributes[name]?.value
  if (value === undefined) {
    return mismatch(`${tag.local} is missing ${name}.`)
  }
  return value
}

type ParsedModel = {
  readonly modelUri: string
  readonly version: string
  readonly publicationDate: string
  readonly requiredModelUris: Set<string>
}

type OpenElement = {
  readonly local: string
  readonly uri: string
  readonly model?: ParsedModel
}

function parseRoboticsModels(xml: string): readonly ParsedModel[] {
  const models: ParsedModel[] = []
  const elements: OpenElement[] = []
  const parser = new SaxesParser({ xmlns: true })

  parser.on('opentag', (tag) => {
    const parent = elements.at(-1)
    const grandparent = elements.at(-2)
    let model: ParsedModel | undefined
    if (
      tag.uri === OPC_UA_NODESET_XML_NAMESPACE_URI
      && tag.local === 'Model'
      && parent?.uri === OPC_UA_NODESET_XML_NAMESPACE_URI
      && parent.local === 'Models'
      && grandparent?.uri === OPC_UA_NODESET_XML_NAMESPACE_URI
      && grandparent.local === 'UANodeSet'
    ) {
      model = {
        modelUri: requiredAttribute(tag, 'ModelUri'),
        version: requiredAttribute(tag, 'Version'),
        publicationDate: requiredAttribute(tag, 'PublicationDate'),
        requiredModelUris: new Set<string>(),
      }
      models.push(model)
    }

    if (
      tag.uri === OPC_UA_NODESET_XML_NAMESPACE_URI
      && tag.local === 'RequiredModel'
      && parent?.uri === OPC_UA_NODESET_XML_NAMESPACE_URI
      && parent.local === 'Model'
      && parent.model !== undefined
    ) {
      parent.model.requiredModelUris.add(requiredAttribute(tag, 'ModelUri'))
    }

    elements.push({ local: tag.local, uri: tag.uri, ...(model === undefined ? {} : { model }) })
  })
  parser.on('closetag', () => {
    elements.pop()
  })

  parser.write(xml).close()
  return models
}

function assertRoboticsModel(model: ParsedModel): void {
  if (model.version !== OPC_UA_ROBOTICS_VERSION_V1) {
    mismatch(`expected Robotics Version ${OPC_UA_ROBOTICS_VERSION_V1}, received ${model.version}.`)
  }
  if (model.publicationDate !== OPC_UA_ROBOTICS_PUBLICATION_DATE_V1) {
    mismatch(
      `expected Robotics PublicationDate ${OPC_UA_ROBOTICS_PUBLICATION_DATE_V1}, received ${model.publicationDate}.`,
    )
  }

  for (const requiredNamespaceUri of [OPC_UA_DI_NAMESPACE_URI, OPC_UA_IA_NAMESPACE_URI]) {
    if (!model.requiredModelUris.has(requiredNamespaceUri)) {
      mismatch(`Robotics Model is missing required model ${requiredNamespaceUri}.`)
    }
  }
}

async function readPackagedRoboticsNodeSet(path: string): Promise<Uint8Array> {
  return readFile(path)
}

/**
 * Verifies that the packaged OPC UA Robotics XML remains the published v1.02 contract.
 * The resulting error is deliberately fatal: callers must not substitute copied types.
 */
export async function assertRoboticsNodeSetContractV1(
  options: RoboticsNodeSetContractOptionsV1 = {},
): Promise<RoboticsNodeSetContractV1> {
  try {
    const bytes = await (options.readFile ?? readPackagedRoboticsNodeSet)(nodesets.robotics)
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const roboticsModels = parseRoboticsModels(source)
      .filter((model) => model.modelUri === OPC_UA_ROBOTICS_NAMESPACE_URI_V1)

    if (roboticsModels.length !== 1) {
      return mismatch(`expected exactly one live Robotics Model, received ${roboticsModels.length}.`)
    }

    const roboticsModel = roboticsModels[0]
    if (roboticsModel === undefined) {
      return mismatch('Robotics Model is absent.')
    }
    assertRoboticsModel(roboticsModel)

    return Object.freeze({
      namespaceUri: OPC_UA_ROBOTICS_NAMESPACE_URI_V1,
      version: OPC_UA_ROBOTICS_VERSION_V1,
      publicationDate: '2025-09-08',
    })
  } catch (error) {
    if (error instanceof RoboticsNodeSetMismatchError) {
      throw error
    }
    return mismatch('unable to read and validate the packaged Robotics XML as UTF-8.')
  }
}
