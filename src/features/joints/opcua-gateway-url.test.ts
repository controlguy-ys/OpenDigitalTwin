import { describe, expect, it } from 'vitest'
import { resolveOpcUaGatewayUrl } from './opcua-gateway-url'

describe('resolveOpcUaGatewayUrl', () => {
  it('uses a non-empty explicit build override', () => {
    expect(
      resolveOpcUaGatewayUrl('  ws://gateway.local:9000/live  ', {
        protocol: 'https:',
        host: 'robotsim.local',
      }),
    ).toBe('ws://gateway.local:9000/live')
  })

  it('uses same-origin WebSocket paths for HTTP and HTTPS deployments', () => {
    expect(
      resolveOpcUaGatewayUrl(undefined, {
        protocol: 'http:',
        host: 'robotsim.local:8080',
      }),
    ).toBe('ws://robotsim.local:8080/opcua')
    expect(
      resolveOpcUaGatewayUrl(undefined, {
        protocol: 'https:',
        host: 'robotsim.example',
      }),
    ).toBe('wss://robotsim.example/opcua')
  })

  it('falls back for unavailable locations and unsupported protocols', () => {
    expect(resolveOpcUaGatewayUrl(undefined)).toBe('ws://127.0.0.1:4841')
    expect(
      resolveOpcUaGatewayUrl('', {
        protocol: 'file:',
        host: '',
      }),
    ).toBe('ws://127.0.0.1:4841')
  })
})
