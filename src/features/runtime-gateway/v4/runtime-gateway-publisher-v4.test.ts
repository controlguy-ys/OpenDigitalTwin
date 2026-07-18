import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import {
  RuntimeGatewayPublisherV4Error,
  createRuntimeGatewayPublisherV4,
  runtimeGatewayStatePublicationRequiresReactivationV4,
  type RuntimeGatewayStatusV4,
} from './runtime-gateway-publisher-v4.js'

function status(
  revisionId = 'revision-test-v4',
  mode: RuntimeGatewayStatusV4['mode'] = 'server',
): RuntimeGatewayStatusV4 {
  return {
    projectId: 'project-test-v4',
    revisionId,
    mode,
    ready: true,
    opcUaStarted: mode !== 'off',
    endpointUrl: mode === 'server' || mode === 'bridge' ? 'opc.tcp://127.0.0.1:4840' : null,
    ...(mode === 'client' || mode === 'bridge'
      ? { opcUaClientEndpoints: [{ endpointId: 'endpoint-client', connected: true, lastError: null }] }
      : {}),
  }
}

function jsonResponse(value: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(value), {
    status: statusCode,
    headers: { 'content-type': 'application/json' },
  })
}

function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolvePromise!: (value: T) => void
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve
    }),
    resolve: (value) => resolvePromise(value),
  }
}

describe('RuntimeGatewayPublisherV4', () => {
  it.each(['client', 'bridge'] as const)('decodes %s mode and typed Client Endpoint status', async (mode) => {
    const expected = status('revision-client-v4', mode)
    const publisher = createRuntimeGatewayPublisherV4({
      fetch: vi.fn(async () => jsonResponse(expected)),
    })

    await expect(publisher.readStatus()).resolves.toEqual(expected)
  })

  it.each([
    new RuntimeGatewayPublisherV4Error(
      'NO_ACTIVE_REVISION',
      'No active Project Revision exists.',
      { statusCode: 409 },
    ),
    new RuntimeGatewayPublisherV4Error(
      'OPC_UA_SERVER_NOT_ACTIVE',
      'OPC UA Server is not active.',
      { statusCode: 409 },
    ),
  ])('classifies lost active-runtime state as reactivation-required', (error) => {
    expect(runtimeGatewayStatePublicationRequiresReactivationV4(error)).toBe(true)
  })

  it.each([
    new RuntimeGatewayPublisherV4Error(
      'RUNTIME_GATEWAY_UNAVAILABLE',
      'Runtime Gateway could not be reached.',
    ),
    new RuntimeGatewayPublisherV4Error(
      'RUNTIME_GATEWAY_HTTP_503',
      'Runtime Gateway is unavailable.',
      { statusCode: 503 },
    ),
    new RuntimeGatewayPublisherV4Error(
      'RUNTIME_GATEWAY_HTTP_409',
      'Runtime Gateway returned an unspecified conflict.',
      { statusCode: 409 },
    ),
    new RuntimeGatewayPublisherV4Error(
      'REVISION_MISMATCH',
      'A different Project Revision is active.',
      { statusCode: 409 },
    ),
    new Error('Unrelated state publication failure.'),
  ])('does not reactivate for unrelated publication failures', (error) => {
    expect(runtimeGatewayStatePublicationRequiresReactivationV4(error)).toBe(false)
  })

  it('PUTs the exact Project V4 revision directly and rejects a mismatched response', async () => {
    const project = {
      ...makeMinimalWorkcellProjectV4(),
      projectId: 'project-test-v4',
      revisionId: 'revision-test-v4',
    }
    const fetchV4 = vi.fn<(
      input: string,
      init: RequestInit,
    ) => Promise<Response>>(async () => jsonResponse(status()))
    const publisher = createRuntimeGatewayPublisherV4({
      fetch: fetchV4,
      basePath: '/runtime/',
    })

    await expect(publisher.activateProject(project)).resolves.toEqual(status())
    expect(fetchV4).toHaveBeenCalledOnce()
    expect(fetchV4.mock.calls[0]![0]).toBe('/runtime/project')
    expect(fetchV4.mock.calls[0]![1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(fetchV4.mock.calls[0]![1]?.body))).toEqual(project)

    fetchV4.mockResolvedValueOnce(jsonResponse(status('revision-stale')))
    await expect(publisher.activateProject(project)).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_REVISION_MISMATCH',
    })
  })

  it('GETs deterministic status from the configured base path', async () => {
    const fetchV4 = vi.fn(async () => jsonResponse({
      projectId: null,
      revisionId: null,
      mode: 'off',
      ready: false,
      opcUaStarted: false,
      endpointUrl: null,
      errorCode: 'NO_ACTIVE_REVISION',
    }))
    const publisher = createRuntimeGatewayPublisherV4({
      fetch: fetchV4,
      basePath: '/custom-runtime',
    })

    await expect(publisher.readStatus()).resolves.toMatchObject({
      ready: false,
      errorCode: 'NO_ACTIVE_REVISION',
    })
    expect(fetchV4).toHaveBeenCalledWith(
      '/custom-runtime/status',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('serializes POSTs and coalesces queued Robot state to the latest snapshot', async () => {
    const firstResponse = deferred<Response>()
    const secondResponse = deferred<Response>()
    const fetchV4 = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise)
    const publisher = createRuntimeGatewayPublisherV4({ fetch: fetchV4 })
    const state = (value: number) => ({
      projectId: 'project-test-v4',
      revisionId: 'revision-test-v4',
      robots: [{ robotId: 'robot-a', jointValues: { J1: value } }],
    })

    const first = publisher.publishRobotState(state(1))
    await vi.waitFor(() => expect(fetchV4).toHaveBeenCalledTimes(1))
    const second = publisher.publishRobotState(state(2))
    const latest = publisher.publishRobotState(state(3))

    expect(latest).toBe(second)

    firstResponse.resolve(jsonResponse(status()))
    await expect(first).resolves.toEqual(status())
    await vi.waitFor(() => expect(fetchV4).toHaveBeenCalledTimes(2))
    expect(fetchV4.mock.calls[1]![0]).toBe('/runtime/state')
    expect(JSON.parse(String(fetchV4.mock.calls[1]![1]?.body))).toEqual(state(3))

    secondResponse.resolve(jsonResponse(status()))
    await expect(Promise.all([second, latest])).resolves.toEqual([status(), status()])
    expect(fetchV4).toHaveBeenCalledTimes(2)
  })

  it('preserves a schema-valid reserved JavaScript key Joint id in the POST body', async () => {
    const fetchV4 = vi.fn<(
      input: string,
      init: RequestInit,
    ) => Promise<Response>>(async () => jsonResponse(status()))
    const publisher = createRuntimeGatewayPublisherV4({ fetch: fetchV4 })
    const jointValues = Object.fromEntries([['__proto__', 4]])

    await publisher.publishRobotState({
      projectId: 'project-test-v4',
      revisionId: 'revision-test-v4',
      robots: [{ robotId: 'robot-a', jointValues }],
    })

    const body = JSON.parse(String(fetchV4.mock.calls[0]![1]?.body)) as {
      robots: Array<{ jointValues: Record<string, number> }>
    }
    expect(Object.hasOwn(body.robots[0]!.jointValues, '__proto__')).toBe(true)
    expect(body.robots[0]!.jointValues.__proto__).toBe(4)
  })

  it('reports deterministic HTTP and unavailable errors', async () => {
    const httpFetch = vi.fn(async () => jsonResponse({
      errorCode: 'REVISION_NOT_ACTIVE',
      message: 'Revision is not active.',
    }, 409))
    const httpPublisher = createRuntimeGatewayPublisherV4({ fetch: httpFetch })

    await expect(httpPublisher.readStatus()).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeGatewayPublisherV4Error>>({
        code: 'REVISION_NOT_ACTIVE',
        statusCode: 409,
      }),
    )

    const unavailablePublisher = createRuntimeGatewayPublisherV4({
      fetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    })
    await expect(unavailablePublisher.readStatus()).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_UNAVAILABLE',
    })
  })
})
