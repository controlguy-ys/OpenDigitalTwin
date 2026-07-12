export interface GatewayLocation {
  readonly protocol: string
  readonly host: string
}

const LOCAL_GATEWAY_URL = 'ws://127.0.0.1:4841'

export function resolveOpcUaGatewayUrl(
  override: string | undefined,
  location?: GatewayLocation,
): string {
  const explicit = override?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  if (location?.host === undefined || location.host.trim() === '') {
    return LOCAL_GATEWAY_URL
  }
  if (location.protocol === 'http:') return `ws://${location.host}/opcua`
  if (location.protocol === 'https:') return `wss://${location.host}/opcua`
  return LOCAL_GATEWAY_URL
}
