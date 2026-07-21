import { createDemoOpcUaServer } from './demo-opcua-server.js'

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`)
  return parsed
}

async function main(): Promise<void> {
  const server = createDemoOpcUaServer({
    host: process.env.DEMO_OPCUA_HOST ?? '127.0.0.1',
    advertisedHost: process.env.DEMO_OPCUA_ADVERTISED_HOST ?? '127.0.0.1',
    port: envInteger('DEMO_OPCUA_PORT', 4_840),
    tickMs: envInteger('DEMO_OPCUA_TICK_MS', 100),
    autoStartRobot: process.env.DEMO_OPCUA_AUTO_START_ROBOT === '1',
  })
  const started = await server.start()

  console.log(`OpenDigitalTwin demo OPC UA Server: ${started.endpointUrl}`)
  console.log(`Namespace URI: http://br-automation.com/OpcUa/PLC/PV/ (ns=${started.namespaceIndex})`)
  console.log('ObjectPos[0..19] is moving automatically; values use mm and degrees.')
  console.log(`Example X Node ID: ${started.nodeIds.objectPos[0]!.X}`)
  console.log(`Robot Q1 Node ID: ${started.nodeIds.robot.Q1}`)
  console.log(`Write Int32 1 or 2 to ${started.nodeIds.button} to start or stop Robot Jobs.`)

  let stopping = false
  const stop = async (): Promise<void> => {
    if (stopping) return
    stopping = true
    await server.stop()
  }
  process.once('SIGINT', () => void stop().finally(() => process.exit(0)))
  process.once('SIGTERM', () => void stop().finally(() => process.exit(0)))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
