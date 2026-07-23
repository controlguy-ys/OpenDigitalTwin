import { readFile } from 'node:fs/promises'

import { nodesets } from 'node-opcua-nodesets'

export const OPC_UA_ROBOTICS_NAMESPACE_URI_V1 =
  'http://opcfoundation.org/UA/Robotics/' as const

export const ROBOTICS_NODESET_FILES_V1 = Object.freeze([
  nodesets.standard,
  nodesets.di,
  nodesets.ia,
  nodesets.robotics,
])

const OPC_UA_ROBOTICS_NODESET_MISMATCH = 'OPC_UA_ROBOTICS_NODESET_MISMATCH'
const OPC_UA_STANDARD_NAMESPACE_URI = 'http://opcfoundation.org/UA/'
const OPC_UA_DI_NAMESPACE_URI = 'http://opcfoundation.org/UA/DI/'
const OPC_UA_IA_NAMESPACE_URI = 'http://opcfoundation.org/UA/IA/'
const OPC_UA_ROBOTICS_VERSION_V1 = '1.02'
const OPC_UA_ROBOTICS_PUBLICATION_DATE_V1 = '2025-09-08T00:00:00Z'

export type RoboticsNodeSetContractV1 = Readonly<{
  namespaceUri: typeof OPC_UA_ROBOTICS_NAMESPACE_URI_V1
  version: typeof OPC_UA_ROBOTICS_VERSION_V1
  publicationDate: '2025-09-08'
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

function requiredAttribute(attributes: string, attribute: string): string {
  const match = new RegExp(`\\b${attribute}="([^"]*)"`, 'u').exec(attributes)
  if (match?.[1] === undefined) {
    return mismatch(`Robotics Model is missing ${attribute}.`)
  }
  return match[1]
}

function readRoboticsModel(xml: string): { attributes: string; contents: string } {
  for (const match of xml.matchAll(/<Model\b([^>]*)>([\s\S]*?)<\/Model>/gu)) {
    const attributes = match[1]
    const contents = match[2]
    if (attributes === undefined || contents === undefined) {
      continue
    }
    if (requiredAttribute(attributes, 'ModelUri') === OPC_UA_ROBOTICS_NAMESPACE_URI_V1) {
      return { attributes, contents }
    }
  }
  return mismatch('Robotics Model is absent.')
}

function assertRequiredModels(modelContents: string): void {
  const requiredModelUris = new Set<string>()
  for (const match of modelContents.matchAll(/<RequiredModel\b([^>]*)\/?\s*>/gu)) {
    const attributes = match[1]
    if (attributes !== undefined) {
      requiredModelUris.add(requiredAttribute(attributes, 'ModelUri'))
    }
  }

  for (const requiredNamespaceUri of [
    OPC_UA_STANDARD_NAMESPACE_URI,
    OPC_UA_DI_NAMESPACE_URI,
    OPC_UA_IA_NAMESPACE_URI,
  ]) {
    if (!requiredModelUris.has(requiredNamespaceUri)) {
      mismatch(`Robotics Model is missing required model ${requiredNamespaceUri}.`)
    }
  }
}

/**
 * Verifies that the packaged OPC UA Robotics XML remains the published v1.02 contract.
 * The resulting error is deliberately fatal: callers must not substitute copied types.
 */
export async function assertRoboticsNodeSetContractV1(): Promise<RoboticsNodeSetContractV1> {
  let source: string
  try {
    const bytes = await readFile(nodesets.robotics)
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    if (error instanceof RoboticsNodeSetMismatchError) {
      throw error
    }
    return mismatch('unable to read the packaged Robotics XML as UTF-8.')
  }

  const model = readRoboticsModel(source)
  const version = requiredAttribute(model.attributes, 'Version')
  const publicationDate = requiredAttribute(model.attributes, 'PublicationDate')

  if (version !== OPC_UA_ROBOTICS_VERSION_V1) {
    return mismatch(`expected Robotics Version ${OPC_UA_ROBOTICS_VERSION_V1}, received ${version}.`)
  }
  if (publicationDate !== OPC_UA_ROBOTICS_PUBLICATION_DATE_V1) {
    return mismatch(
      `expected Robotics PublicationDate ${OPC_UA_ROBOTICS_PUBLICATION_DATE_V1}, received ${publicationDate}.`,
    )
  }

  assertRequiredModels(model.contents)

  return Object.freeze({
    namespaceUri: OPC_UA_ROBOTICS_NAMESPACE_URI_V1,
    version: OPC_UA_ROBOTICS_VERSION_V1,
    publicationDate: '2025-09-08',
  })
}
