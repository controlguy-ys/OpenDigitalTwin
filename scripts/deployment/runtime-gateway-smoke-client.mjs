import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { chromium } from '@playwright/test'
import {
  AttributeIds,
  MessageSecurityMode,
  OPCUACertificateManager,
  OPCUAClient,
  SecurityPolicy,
  StatusCodes,
  VariableIds,
} from 'node-opcua'

const ROBOT_SIM_NAMESPACE_URI = 'urn:web-digital-twin:robot-sim:v4'

function actualJointNodeId(namespaceIndex, robotId, jointId) {
  return `ns=${namespaceIndex};s=RobotSim/Robots/${robotId}/Joints/${jointId}/Actual`
}

async function readDualRobotJointValues(session) {
  const namespaceData = await session.read({
    nodeId: `i=${VariableIds.Server_NamespaceArray}`,
    attributeId: AttributeIds.Value,
  })
  if (!namespaceData.statusCode.equals(StatusCodes.Good)) {
    throw new Error(`OPC UA NamespaceArray read failed: ${namespaceData.statusCode.toString()}`)
  }
  const namespaceArray = namespaceData.value.value
  if (!Array.isArray(namespaceArray)) {
    throw new Error('OPC UA NamespaceArray was not an array.')
  }
  const namespaceIndex = namespaceArray.indexOf(ROBOT_SIM_NAMESPACE_URI)
  if (namespaceIndex < 0) {
    throw new Error(`OPC UA namespace is missing: ${ROBOT_SIM_NAMESPACE_URI}`)
  }

  const targets = [
    {
      key: 'crbJ1',
      nodeId: actualJointNodeId(namespaceIndex, 'robot-sample-crb', 'J1'),
    },
    {
      key: 'slideX',
      nodeId: actualJointNodeId(
        namespaceIndex,
        'robot-sample-linear-slide',
        'SLIDE_X',
      ),
    },
  ]
  const values = await session.read(targets.map(({ nodeId }) => ({
    nodeId,
    attributeId: AttributeIds.Value,
  })))
  const result = {}
  for (const [index, dataValue] of values.entries()) {
    const target = targets[index]
    if (target === undefined || !dataValue.statusCode.equals(StatusCodes.Good)) {
      throw new Error(
        `OPC UA Actual Joint read failed: ${target?.nodeId ?? 'unknown'} ${dataValue.statusCode.toString()}`,
      )
    }
    const value = dataValue.value.value
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`OPC UA Actual Joint was not finite: ${target.nodeId}`)
    }
    result[target.key] = value
  }
  return Object.freeze(result)
}

export async function probeDualRobotOpcUaServer({
  endpointUrl,
  gatewayBaseUrl,
  webBaseUrl,
}) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(webBaseUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Load dual-Robot sample' }).click()
    await page.getByText('Dual Robot Simulation Sample', { exact: true }).waitFor()
    await page.getByLabel('OPC UA Server mode').selectOption('server')
    const gatewayBadge = page.getByLabel('Runtime Gateway status')
    try {
      await gatewayBadge.filter({ hasText: 'Gateway ready' })
        .waitFor({ timeout: 30_000 })
    } catch (error) {
      const statusResponse = await fetch(`${gatewayBaseUrl}/status`).catch(() => null)
      const statusText = statusResponse === null
        ? 'unreachable'
        : `${statusResponse.status} ${await statusResponse.text()}`
      const badgeText = await gatewayBadge.textContent().catch(() => null)
      const badgeTitle = await gatewayBadge.getAttribute('title').catch(() => null)
      throw new Error(
        `Gateway ready UI timeout; badge=${JSON.stringify({ badgeText, badgeTitle })}; status=${statusText}; cause=${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const statusResponse = await fetch(`${gatewayBaseUrl}/status`)
    if (!statusResponse.ok) {
      throw new Error(`Runtime Gateway status returned HTTP ${statusResponse.status}.`)
    }
    const status = await statusResponse.json()
    if (
      status?.mode !== 'server'
      || status?.ready !== true
      || status?.opcUaStarted !== true
    ) {
      throw new Error('Runtime Gateway did not report a ready OPC UA Server.')
    }
    const readinessResponse = await fetch(`${gatewayBaseUrl}/readyz`)
    const readiness = await readinessResponse.json()
    if (
      !readinessResponse.ok
      || readiness?.projectId !== status.projectId
      || readiness?.revisionId !== status.revisionId
      || readiness?.mode !== 'server'
      || readiness?.opcUaStarted !== true
    ) {
      throw new Error('Runtime Gateway readiness did not match the active Server revision.')
    }

    const certificateManager = new OPCUACertificateManager({
      automaticallyAcceptUnknownCertificate: true,
      rootFolder: join(tmpdir(), 'robotsim-opcua-smoke-client-pki'),
    })
    const client = OPCUAClient.create({
      applicationName: 'RobotSim deployment smoke client',
      clientCertificateManager: certificateManager,
      connectionStrategy: { maxRetry: 0 },
      endpointMustExist: true,
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
    })

    await client.connect(endpointUrl)
    try {
      const session = await client.createSession()
      try {
        const values = await readDualRobotJointValues(session)
        process.stdout.write(
          `[deploy] OPC UA Actual values: CRB J1=${values.crbJ1}, Slide X=${values.slideX}\n`,
        )
        return values
      } finally {
        await session.close()
      }
    } finally {
      await client.disconnect()
      await certificateManager.dispose()
    }
  } finally {
    await browser.close()
  }
}
