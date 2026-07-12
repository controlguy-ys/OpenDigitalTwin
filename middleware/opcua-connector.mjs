import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  AttributeIds,
  MessageSecurityMode,
  OPCUAClient,
  SecurityPolicy,
} from 'node-opcua'
import { WebSocket, WebSocketServer } from 'ws'
import {
  readOpcUaConnectorConfig,
  validateOpcUaConnectorConfig,
} from './opcua-config.mjs'

const configPath = resolve(
  process.env.OPCUA_CONFIG ??
    fileURLToPath(new URL('./opcua.config.json', import.meta.url)),
)
const fileConfig = await readOpcUaConnectorConfig(configPath)
const config = process.env.OPCUA_HEALTH_PORT === undefined
  ? fileConfig
  : validateOpcUaConnectorConfig({
      ...fileConfig,
      healthPort: Number(process.env.OPCUA_HEALTH_PORT),
    })

const equipmentNodes = Array.isArray(config.equipment) ? config.equipment : []
const allNodes = [...config.joints, ...equipmentNodes]
const websocketServer = new WebSocketServer({ port: config.websocketPort })
const healthServer = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok\n')
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('not found\n')
})
healthServer.listen(config.healthPort)
let lastJointFrame = null
let lastEquipmentFrame = null
let stopped = false
let activeClient = null
let activeSession = null

function broadcast(message) {
  const payload = JSON.stringify(message)
  for (const socket of websocketServer.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload)
  }
}

websocketServer.on('connection', (socket) => {
  if (lastJointFrame !== null) socket.send(JSON.stringify(lastJointFrame))
  if (lastEquipmentFrame !== null) socket.send(JSON.stringify(lastEquipmentFrame))
})

function numericValue(dataValue, mapping) {
  const raw = Number(dataValue?.value?.value)
  if (!Number.isFinite(raw)) return null
  const scale = Number.isFinite(mapping.scale) ? mapping.scale : 1
  const offset = Number.isFinite(mapping.offset) ? mapping.offset : 0
  const value = raw * scale + offset
  return Number.isFinite(value) ? value : null
}

async function poll(session) {
  const values = await session.read(
    allNodes.map(({ nodeId }) => ({ nodeId, attributeId: AttributeIds.Value })),
  )
  const jointValues = values.slice(0, config.joints.length)
  const anglesDeg = jointValues.map((value, index) =>
    numericValue(value, config.joints[index]),
  )
  const jointGood =
    anglesDeg.every((value) => value !== null) &&
    jointValues.every((value) => value.statusCode?.isGood())
  lastJointFrame = {
    type: 'joint-frame',
    anglesDeg: jointGood ? anglesDeg : [0, 0, 0, 0, 0, 0],
    timestampMs: Date.now(),
    quality: jointGood ? 'GOOD' : 'BAD',
  }
  broadcast(lastJointFrame)

  if (equipmentNodes.length > 0) {
    const equipmentValues = values.slice(config.joints.length)
    lastEquipmentFrame = {
      type: 'equipment-status',
      timestampMs: Date.now(),
      values: Object.fromEntries(
        equipmentNodes.map((mapping, index) => [
          mapping.id,
          numericValue(equipmentValues[index], mapping),
        ]),
      ),
    }
    broadcast(lastEquipmentFrame)
  }
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

async function runConnector() {
  while (!stopped) {
    const client = OPCUAClient.create({
      applicationName: 'WebDigitalTwin OPC UA Connector',
      endpointMustExist: false,
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      connectionStrategy: { initialDelay: 500, maxDelay: 2000, maxRetry: 2 },
    })
    activeClient = client
    try {
      await client.connect(config.endpointUrl)
      const session = await client.createSession()
      activeSession = session
      while (!stopped) {
        await poll(session)
        await delay(config.samplingIntervalMs ?? 100)
      }
    } catch (error) {
      lastJointFrame = {
        type: 'joint-frame',
        anglesDeg: lastJointFrame?.anglesDeg ?? [0, 0, 0, 0, 0, 0],
        timestampMs: Date.now(),
        quality: 'BAD',
      }
      broadcast(lastJointFrame)
      console.error('[opcua-connector]', error instanceof Error ? error.message : error)
    } finally {
      if (activeSession !== null) {
        await activeSession.close().catch(() => undefined)
        activeSession = null
      }
      await client.disconnect().catch(() => undefined)
      if (activeClient === client) activeClient = null
    }
    if (!stopped) await delay(config.reconnectDelayMs ?? 2000)
  }
}

async function shutdown() {
  if (stopped) return
  stopped = true
  await activeSession?.close().catch(() => undefined)
  await activeClient?.disconnect().catch(() => undefined)
  await new Promise((resolveClose) => websocketServer.close(resolveClose))
  await new Promise((resolveClose) => healthServer.close(resolveClose))
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

console.log(
  `[opcua-connector] ws://127.0.0.1:${config.websocketPort}, health :${config.healthPort} -> ${config.endpointUrl}`,
)
void runConnector()
