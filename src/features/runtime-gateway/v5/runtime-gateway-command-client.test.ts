/// <reference types="node" />

import { builtinModules } from 'node:module'
import * as ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { validateWorkcellProjectV5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import {
  validateCommandRequestV1,
  type CommandRequestV1,
  type CommandResultV1,
  type RuntimePublisherLeaseV1,
} from '../../../core/runtime-protocol/v1.js'
import {
  GatewaySignalWriteErrorV1,
  RuntimeGatewayCommandClientV1Error,
  createGatewaySignalWritePortV1,
  createRuntimeGatewayCommandClientV1,
  isGatewaySignalWriteErrorV1,
  isRuntimeGatewayCommandClientV1Error,
  type RuntimeGatewayCommandClientOptionsV1,
} from './runtime-gateway-command-client.js'

const REVISION_A = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)
const WRITE_A = Object.freeze({
  projectId: 'project-v5',
  configRevision: REVISION_A,
  targetId: 'map-start',
  value: true,
})

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function lease(overrides: Partial<RuntimePublisherLeaseV1> = {}): RuntimePublisherLeaseV1 {
  return {
    projectId: WRITE_A.projectId,
    configRevision: WRITE_A.configRevision,
    publisherId: 'gateway-local:client-write',
    generation: 9,
    expiresAt: 9_000,
    ...overrides,
  }
}

function resultFor(
  command: CommandRequestV1,
  overrides: Partial<CommandResultV1> = {},
): CommandResultV1 {
  return {
    type: 'command-result-v1',
    protocolVersion: 1,
    projectId: command.projectId,
    configRevision: command.configRevision,
    leaseGeneration: command.leaseGeneration,
    targetId: command.targetId,
    commandId: command.commandId,
    acknowledgement: 'ACCEPTED',
    executionState: 'SUCCEEDED',
    failureCode: null,
    message: 'done',
    attachedObjectId: null,
    completedAt: 1_001,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, redirected = false): Response {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
  if (redirected) Object.defineProperty(response, 'redirected', { value: true })
  return response
}

function customResponse(options: {
  readonly status?: number
  readonly redirected?: boolean
  readonly json: () => Promise<unknown>
}): Response {
  return {
    status: options.status ?? 200,
    redirected: options.redirected ?? false,
    json: options.json,
  } as Response
}

function postedCommand(init: RequestInit): CommandRequestV1 {
  return validateCommandRequestV1(JSON.parse(String(init.body)))
}

function echoingFetch(options: {
  readonly lease?: RuntimePublisherLeaseV1
  readonly result?: (command: CommandRequestV1) => CommandResultV1
} = {}) {
  const calls: Array<{ readonly url: string; readonly init: RequestInit }> = []
  const call = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    if (url.endsWith('/command-lease')) return jsonResponse(options.lease ?? lease())
    const command = postedCommand(init)
    return jsonResponse(options.result?.(command) ?? resultFor(command))
  })
  return { call, calls }
}

function createClient(
  fetch: NonNullable<RuntimeGatewayCommandClientOptionsV1['fetch']>,
  overrides: Partial<RuntimeGatewayCommandClientOptionsV1> = {},
) {
  return createRuntimeGatewayCommandClientV1({
    fetch,
    nowMs: () => 1_000,
    createCommandId: () => 'command-1',
    ...overrides,
  })
}

function writableProject(): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.logicalSignals[0] as unknown as { id: string; direction: 'output' }).id = 'start'
  ;(project.logicalSignals[0] as unknown as { direction: 'output' }).direction = 'output'
  ;(project.opcUa.endpoints[0] as unknown as { endpointId: string }).endpointId = 'plc'
  const mapping = project.opcUa.mappings[0] as unknown as {
    id: string
    endpointId: string
    direction: 'write'
    nodeAddress: { identifier: string }
    leaves: Array<{ projectTarget: { type: 'logical-signal'; signalId: string } }>
  }
  mapping.id = 'map-start'
  mapping.endpointId = 'plc'
  mapping.direction = 'write'
  mapping.nodeAddress.identifier = 'Start'
  mapping.leaves[0]!.projectTarget = { type: 'logical-signal', signalId: 'start' }
  return validateWorkcellProjectV5(project)
}

async function waitForCalls(fetch: { readonly mock: { readonly calls: readonly unknown[][] } }, count: number): Promise<void> {
  await expect.poll(() => fetch.mock.calls.length).toBe(count)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RuntimeGatewayCommandClientV1 request contract', () => {
  it('obtains the current lease and posts one exact revision-qualified command', async () => {
    const fetch = echoingFetch()
    const createCommandId = vi.fn(() => 'command-1')
    const client = createClient(fetch.call, { basePath: ' /runtime/ ', createCommandId })

    await expect(client.writeBoolean(WRITE_A)).resolves.toMatchObject({ executionState: 'SUCCEEDED' })

    expect(createCommandId).toHaveBeenCalledOnce()
    expect(fetch.calls.map(({ url }) => url)).toEqual(['/runtime/command-lease', '/runtime/command'])
    expect(fetch.calls[0]!.init).toMatchObject({
      method: 'GET', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' },
    })
    expect(fetch.calls[1]!.init).toMatchObject({
      method: 'POST', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    expect(postedCommand(fetch.calls[1]!.init)).toEqual({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1',
      projectId: WRITE_A.projectId, configRevision: REVISION_A, leaseGeneration: 9,
      expiresAt: 6_000, targetId: WRITE_A.targetId, value: true,
    })
  })

  it.each([
    [9_000, 6_000],
    [4_000, 4_000],
  ])('uses the exact five-second/lease expiry horizon for lease expiry %i', async (leaseExpiry, expected) => {
    const fetch = echoingFetch({ lease: lease({ expiresAt: leaseExpiry }) })
    await createClient(fetch.call).writeBoolean(WRITE_A)
    expect(postedCommand(fetch.calls[1]!.init).expiresAt).toBe(expected)
  })

  it('retries one stale lease with one Command ID and returns the second stale unchanged', async () => {
    const createCommandId = vi.fn(() => 'stable-id')
    let generation = 0
    let posts = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) return jsonResponse(lease({ generation: ++generation }))
      posts += 1
      const command = postedCommand(init)
      return jsonResponse(resultFor(command, {
        acknowledgement: 'REJECTED', executionState: 'FAILED',
        failureCode: 'COMMAND_LEASE_STALE', message: `stale-${posts}`,
      }))
    })
    const client = createClient(fetch, { createCommandId })

    const returned = await client.writeBoolean(WRITE_A)

    expect(returned).toMatchObject({ failureCode: 'COMMAND_LEASE_STALE', message: 'stale-2', leaseGeneration: 2 })
    expect(createCommandId).toHaveBeenCalledOnce()
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/command'))).toHaveLength(2)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/command-lease'))).toHaveLength(2)
    const ids = fetch.mock.calls
      .filter(([url]) => String(url).endsWith('/command'))
      .map(([, init]) => postedCommand(init as RequestInit).commandId)
    expect(ids).toEqual(['stable-id', 'stable-id'])
  })

  it('retries one stale lease with the same Command ID and observes one successful execution', async () => {
    const createCommandId = vi.fn(() => 'stable-id')
    let generation = 0
    let successfulExecutions = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) return jsonResponse(lease({ generation: ++generation }))
      const command = postedCommand(init)
      if (command.leaseGeneration === 1) return jsonResponse(resultFor(command, {
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      }))
      successfulExecutions += 1
      return jsonResponse(resultFor(command))
    })
    await expect(createClient(fetch, { createCommandId }).writeBoolean(WRITE_A)).resolves.toMatchObject({
      acknowledgement: 'ACCEPTED', executionState: 'SUCCEEDED', leaseGeneration: 2,
    })
    expect(createCommandId).toHaveBeenCalledOnce()
    expect(successfulExecutions).toBe(1)
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/command')).map(([, init]) => postedCommand(init as RequestInit).commandId)).toEqual([
      'stable-id', 'stable-id',
    ])
  })

  it('returns ACCEPTED/FAILED COMMAND_LEASE_STALE unchanged without retrying', async () => {
    const fetch = echoingFetch({ result: (command) => resultFor(command, {
      acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
    }) })
    await expect(createClient(fetch.call).writeBoolean(WRITE_A)).resolves.toMatchObject({
      acknowledgement: 'ACCEPTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
    })
    expect(fetch.calls).toHaveLength(2)
  })
})

describe('RuntimeGatewayCommandClientV1 lease cache fencing', () => {
  it('reuses at equality, refreshes beyond expiry, and refreshes after clearLease', async () => {
    let now = 1_000
    let generation = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        generation += 1
        return jsonResponse(lease({ generation, expiresAt: generation === 1 ? 1_500 : 9_000 }))
      }
      return jsonResponse(resultFor(postedCommand(init)))
    })
    const client = createClient(fetch, { nowMs: () => now, createCommandId: (() => { let id = 0; return () => `command-${++id}` })() })

    await client.writeBoolean(WRITE_A)
    now = 1_500
    await client.writeBoolean(WRITE_A)
    expect(generation).toBe(1)
    now = 1_501
    await client.writeBoolean(WRITE_A)
    expect(generation).toBe(2)
    client.clearLease()
    await client.writeBoolean(WRITE_A)
    expect(generation).toBe(3)
  })

  it('invalidates the cache on Project and Revision changes in both directions', async () => {
    const contexts = [
      lease({ configRevision: REVISION_A, generation: 1 }),
      lease({ configRevision: REVISION_B, generation: 2 }),
      lease({ projectId: 'other-project', configRevision: REVISION_A, generation: 3 }),
      lease({ configRevision: REVISION_A, generation: 4 }),
    ]
    let gets = 0
    let ids = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) return jsonResponse(contexts[gets++]!)
      return jsonResponse(resultFor(postedCommand(init)))
    })
    const client = createClient(fetch, { createCommandId: () => `command-${++ids}` })
    await client.writeBoolean(WRITE_A)
    await client.writeBoolean({ ...WRITE_A, configRevision: REVISION_B })
    await client.writeBoolean({ ...WRITE_A, projectId: 'other-project' })
    await client.writeBoolean(WRITE_A)
    expect(gets).toBe(4)
  })

  it('does not let an in-flight lease GET repopulate after clearLease', async () => {
    const firstLease = deferred<Response>()
    let gets = 0
    let ids = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        gets += 1
        return gets === 1 ? firstLease.promise : jsonResponse(lease({ generation: 2 }))
      }
      return jsonResponse(resultFor(postedCommand(init)))
    })
    const client = createClient(fetch, { createCommandId: () => `command-${++ids}` })
    const pending = client.writeBoolean(WRITE_A)
    await waitForCalls(fetch, 1)
    client.clearLease()
    firstLease.resolve(jsonResponse(lease({ generation: 1 })))
    await pending
    await client.writeBoolean(WRITE_A)
    expect(gets).toBe(2)
  })

  it('keeps the higher concurrent lease when an older GET completes later', async () => {
    const older = deferred<Response>()
    let gets = 0
    let ids = 0
    const postedGenerations: number[] = []
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        gets += 1
        return gets === 1 ? older.promise : jsonResponse(lease({ generation: 2, expiresAt: 8_000 }))
      }
      const command = postedCommand(init)
      postedGenerations.push(command.leaseGeneration)
      return jsonResponse(resultFor(command))
    })
    const client = createClient(fetch, { createCommandId: () => `command-${++ids}` })
    const first = client.writeBoolean(WRITE_A)
    await waitForCalls(fetch, 1)
    const second = client.writeBoolean(WRITE_A)
    await second
    older.resolve(jsonResponse(lease({ generation: 1, expiresAt: 7_000 })))
    await first
    await client.writeBoolean(WRITE_A)
    expect(gets).toBe(2)
    expect(postedGenerations).toEqual([2, 1, 2])
  })

  it('keeps the later-expiring concurrent lease when generations are equal', async () => {
    const earlier = deferred<Response>()
    let gets = 0
    let ids = 0
    const postedExpiries: number[] = []
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        gets += 1
        return gets === 1 ? earlier.promise : jsonResponse(lease({ generation: 4, expiresAt: 9_000 }))
      }
      const command = postedCommand(init)
      postedExpiries.push(command.expiresAt)
      return jsonResponse(resultFor(command))
    })
    const client = createClient(fetch, { createCommandId: () => `command-${++ids}` })
    const first = client.writeBoolean(WRITE_A)
    await waitForCalls(fetch, 1)
    await client.writeBoolean(WRITE_A)
    earlier.resolve(jsonResponse(lease({ generation: 4, expiresAt: 8_000 })))
    await first
    await client.writeBoolean(WRITE_A)
    expect(gets).toBe(2)
    expect(postedExpiries).toEqual([6_000, 6_000, 6_000])
  })

  it('does not erase a concurrent newer lease while invalidating the exact stale lease', async () => {
    let now = 1_000
    let gets = 0
    let ids = 0
    const firstStale = deferred<Response>()
    const forcedRefresh = deferred<Response>()
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        gets += 1
        if (gets === 1) return jsonResponse(lease({ generation: 1, expiresAt: 1_100 }))
        if (gets === 2) return jsonResponse(lease({ generation: 2, expiresAt: 9_000 }))
        return forcedRefresh.promise
      }
      const command = postedCommand(init)
      if (command.leaseGeneration === 1) return firstStale.promise
      return jsonResponse(resultFor(command))
    })
    const client = createClient(fetch, { nowMs: () => now, createCommandId: () => `command-${++ids}` })
    const staleOperation = client.writeBoolean(WRITE_A)
    await waitForCalls(fetch, 2)
    now = 1_101
    await client.writeBoolean(WRITE_A)
    firstStale.resolve(jsonResponse(resultFor({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: WRITE_A.projectId,
      configRevision: REVISION_A, leaseGeneration: 1, expiresAt: 6_000, targetId: WRITE_A.targetId, value: true,
    }, { acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })))
    await expect.poll(() => gets).toBe(3)
    await client.writeBoolean(WRITE_A)
    expect(gets).toBe(3)
    forcedRefresh.resolve(jsonResponse(lease({ generation: 3, expiresAt: 9_500 })))
    await staleOperation
  })

  it('does not reactivate stale context A when its retry resumes after context B became active', async () => {
    const staleA = deferred<Response>()
    let gets = 0
    let ids = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        gets += 1
        if (gets === 1) return jsonResponse(lease({ generation: 1, configRevision: REVISION_A }))
        if (gets === 2) return jsonResponse(lease({ generation: 10, configRevision: REVISION_B }))
        if (gets === 3) return jsonResponse(lease({ generation: 2, configRevision: REVISION_A }))
        return jsonResponse(lease({ generation: 11, configRevision: REVISION_B }))
      }
      const command = postedCommand(init)
      if (command.configRevision === REVISION_A && command.leaseGeneration === 1) return staleA.promise
      return jsonResponse(resultFor(command))
    })
    const client = createClient(fetch, { createCommandId: () => `command-${++ids}` })
    const operationA = client.writeBoolean(WRITE_A)
    await waitForCalls(fetch, 2)
    const writeB = { ...WRITE_A, configRevision: REVISION_B }
    await client.writeBoolean(writeB)
    staleA.resolve(jsonResponse(resultFor({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: WRITE_A.projectId,
      configRevision: REVISION_A, leaseGeneration: 1, expiresAt: 6_000, targetId: WRITE_A.targetId, value: true,
    }, { acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE' })))
    await operationA
    await client.writeBoolean(writeB)
    expect(gets).toBe(3)
  })
})

describe('RuntimeGatewayCommandClientV1 validation and HTTP errors', () => {
  it.each([
    ['projectId', { projectId: 'other-project' }],
    ['configRevision', { configRevision: REVISION_B }],
    ['leaseGeneration', { leaseGeneration: 10 }],
    ['targetId', { targetId: 'other-target' }],
    ['commandId', { commandId: 'other-command' }],
    ['attachedObjectId', { attachedObjectId: 'object-1' }],
    ['IDLE', { acknowledgement: 'IDLE', executionState: 'IDLE', completedAt: null }],
    ['RUNNING', { acknowledgement: 'ACCEPTED', executionState: 'RUNNING', completedAt: null }],
  ] satisfies ReadonlyArray<readonly [string, Partial<CommandResultV1>]>)('rejects mismatched/non-terminal %s without retry', async (_name, overrides) => {
    const fetch = echoingFetch({ result: (command) => resultFor(command, overrides) })
    await expect(createClient(fetch.call).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_RESPONSE_INVALID', statusCode: null,
    })
    expect(fetch.calls).toHaveLength(2)
  })

  it('maps malformed 200 JSON to RUNTIME_GATEWAY_RESPONSE_INVALID', async () => {
    const fetch = vi.fn(async (): Promise<Response> => new Response('{bad json', { status: 200 }))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
  })

  it('maps malformed 200 POST result JSON to RESPONSE_INVALID without retry', async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit): Promise<Response> => url.endsWith('/command-lease')
      ? jsonResponse(lease())
      : new Response('{bad result json', { status: 200 }))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_RESPONSE_INVALID', statusCode: null,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual(['GET', 'POST'])
  })

  it('rejects a newly fetched already-expired lease', async () => {
    const fetch = vi.fn(async (): Promise<Response> => jsonResponse(lease({ expiresAt: 999 })))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['Project', { projectId: 'other-project' }],
    ['Revision', { configRevision: REVISION_B }],
    ['publisher suffix', { publisherId: 'gateway-local:state' }],
  ] satisfies ReadonlyArray<readonly [string, Partial<RuntimePublisherLeaseV1>]>)('rejects a lease with mismatched %s', async (_name, overrides) => {
    const fetch = vi.fn(async (): Promise<Response> => jsonResponse(lease(overrides)))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('maps a malformed 200 lease envelope to RUNTIME_GATEWAY_RESPONSE_INVALID', async () => {
    const fetch = vi.fn(async (): Promise<Response> => jsonResponse({ projectId: WRITE_A.projectId }))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
  })

  it('maps network rejection to RUNTIME_GATEWAY_UNAVAILABLE', async () => {
    const unavailable = new TypeError('socket closed')
    const fetch = vi.fn(async (): Promise<Response> => { throw unavailable })
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_UNAVAILABLE', statusCode: null, cause: unavailable,
    })
  })

  it('preserves an exact closed error body and HTTP status', async () => {
    const fetch = vi.fn(async (): Promise<Response> => jsonResponse({ code: 'COMMAND_SERVICE_CLOSED', message: 'closed' }, 503))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: 'COMMAND_SERVICE_CLOSED', message: 'closed', statusCode: 503,
    })
  })

  it('applies status-first generic HTTP mapping to a malformed POST error body', async () => {
    const fetch = vi.fn(async (url: string): Promise<Response> => url.endsWith('/command-lease')
      ? jsonResponse(lease())
      : new Response('not-json', { status: 409 }))
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: 'RUNTIME_GATEWAY_HTTP_409', statusCode: 409,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['extra property', new Response(JSON.stringify({ code: 'NOT_EXACT', message: 'bad', path: '$' }), { status: 422 })],
    ['empty body', new Response('', { status: 503 })],
    ['text body', new Response('unavailable', { status: 502 })],
    ['malformed JSON', new Response('{', { status: 409 })],
    ['reserved client code', new Response(JSON.stringify({ code: 'RUNTIME_GATEWAY_TIMEOUT', message: 'spoofed' }), { status: 503 })],
  ])('maps a non-exact %s before success-envelope validation', async (_name, response) => {
    const fetch = vi.fn(async (): Promise<Response> => response)
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({
      code: `RUNTIME_GATEWAY_HTTP_${response.status}`, statusCode: response.status,
    })
  })

  it.each(['lease', 'command'])('rejects a defensively redirected %s response', async (phase) => {
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) return phase === 'lease' ? jsonResponse(lease(), 200, true) : jsonResponse(lease())
      return phase === 'command' ? jsonResponse(resultFor(postedCommand(init)), 200, true) : jsonResponse(resultFor(postedCommand(init)))
    })
    await expect(createClient(fetch).writeBoolean(WRITE_A)).rejects.toMatchObject({ code: 'RUNTIME_GATEWAY_RESPONSE_INVALID' })
    expect(fetch.mock.calls.every(([, init]) => (init as RequestInit).redirect === 'error')).toBe(true)
  })
})

describe('RuntimeGatewayCommandClientV1 abort and deadline coverage', () => {
  it('fails an already-aborted caller before fetch or Command ID creation', async () => {
    const controller = new AbortController()
    controller.abort()
    const createCommandId = vi.fn(() => 'command-1')
    const fetch = vi.fn()
    const client = createRuntimeGatewayCommandClientV1({ createCommandId, fetch })
    await expect(client.writeBoolean(WRITE_A, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(createCommandId).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps a synchronous caller abort inside createCommandId to AbortError before fetch', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const createCommandId = vi.fn(() => {
      controller.abort()
      return 'command-1'
    })
    const fetch = vi.fn(async (): Promise<Response> => jsonResponse(lease()))
    const client = createClient(fetch, { createCommandId })

    await expect(client.writeBoolean(WRITE_A, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(createCommandId).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    expect(remove.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(
      add.mock.calls.filter(([type]) => type === 'abort').length,
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['GET', 1],
    ['POST', 2],
    ['stale retry GET', 3],
    ['stale retry POST', 4],
  ])('maps a caller abort during %s fetch to AbortError', async (_phase, heldCall) => {
    const controller = new AbortController()
    let generation = 0
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      const call = fetch.mock.calls.length
      if (call === heldCall) {
        return new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new Error('fetch aborted')), { once: true })
        })
      }
      if (url.endsWith('/command-lease')) return jsonResponse(lease({ generation: ++generation }))
      const command = postedCommand(init)
      return jsonResponse(resultFor(command, generation === 1 ? {
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      } : {}))
    })
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    await waitForCalls(fetch, heldCall)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['lease', 'command', 'retry-lease'])('keeps caller abort authoritative during %s body parsing', async (phase) => {
    const controller = new AbortController()
    const body = deferred<unknown>()
    let generation = 0
    let posts = 0
    let bodyStarted = false
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      if (url.endsWith('/command-lease')) {
        generation += 1
        if ((phase === 'lease' && generation === 1) || (phase === 'retry-lease' && generation === 2)) {
          return customResponse({ json: () => { bodyStarted = true; return body.promise } })
        }
        return jsonResponse(lease({ generation }))
      }
      posts += 1
      const command = postedCommand(init)
      if (phase === 'command' && posts === 1) return customResponse({ json: () => { bodyStarted = true; return body.promise } })
      if (posts === 1) return jsonResponse(resultFor(command, {
        acknowledgement: 'REJECTED', executionState: 'FAILED', failureCode: 'COMMAND_LEASE_STALE',
      }))
      return jsonResponse(resultFor(command))
    })
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    await expect.poll(() => bodyStarted).toBe(true)
    controller.abort()
    if (phase === 'lease') body.resolve(lease({ generation: 1 }))
    else if (phase === 'command') body.resolve(resultFor({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: WRITE_A.projectId,
      configRevision: REVISION_A, leaseGeneration: 1, expiresAt: 6_000, targetId: WRITE_A.targetId, value: true,
    }))
    else body.resolve(lease({ generation: 2 }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('keeps caller abort authoritative when response.json rejects after the abort', async () => {
    const controller = new AbortController()
    const body = deferred<unknown>()
    const fetch = vi.fn(async (): Promise<Response> => customResponse({ json: () => body.promise }))
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    await waitForCalls(fetch, 1)
    controller.abort()
    body.reject(new SyntaxError('late parser failure'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('settles caller abort while response.json remains unresolved', async () => {
    const controller = new AbortController()
    let bodyStarted = false
    const fetch = vi.fn(async (): Promise<Response> => customResponse({
      json: () => {
        bodyStarted = true
        return new Promise<unknown>(() => undefined)
      },
    }))
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    await expect.poll(() => bodyStarted).toBe(true)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each(['fetch', 'json'])('does not miss a synchronous caller abort between checks and the %s Promise race', async (phase) => {
    const controller = new AbortController()
    const fetch = vi.fn(async (): Promise<Response> => {
      if (phase === 'fetch') {
        controller.abort()
        return new Promise<Response>(() => undefined)
      }
      return customResponse({ json: () => {
        controller.abort()
        return new Promise<unknown>(() => undefined)
      } })
    })
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('observes the underlying rejection after a synchronous abort race is already settled', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async (): Promise<Response> => {
      controller.abort()
      throw new Error('late transport rejection')
    })
    await expect(createClient(fetch).writeBoolean(WRITE_A, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
  })

  it.each(['fetch', 'body'])('times out one never-settling %s across the whole operation', async (phase) => {
    vi.useFakeTimers()
    const fetch = vi.fn(async (): Promise<Response> => phase === 'fetch'
      ? new Promise<Response>(() => undefined)
      : customResponse({ json: () => new Promise<unknown>(() => undefined) }))
    const pending = createClient(fetch).writeBoolean(WRITE_A)
    const settlement = pending.then(
      () => ({ kind: 'value' as const }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await settlement).toMatchObject({ kind: 'error', error: { code: 'RUNTIME_GATEWAY_TIMEOUT' } })
  })

  it('removes the caller listener and deadline timer after success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetch = echoingFetch()
    await createClient(fetch.call).writeBoolean(WRITE_A, controller.signal)
    const addedAbort = add.mock.calls.find(([type]) => type === 'abort')
    expect(addedAbort).toBeDefined()
    expect(remove).toHaveBeenCalledWith('abort', addedAbort![1])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('removes the caller listener and deadline timer after timeout', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const fetch = vi.fn(async (): Promise<Response> => new Promise<Response>(() => undefined))
    const pending = createClient(fetch).writeBoolean(WRITE_A, controller.signal)
    const observed = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(observed).resolves.toMatchObject({ code: 'RUNTIME_GATEWAY_TIMEOUT' })
    const addedAbort = add.mock.calls.find(([type]) => type === 'abort')
    expect(remove).toHaveBeenCalledWith('abort', addedAbort![1])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('RuntimeGatewayCommandClientV1 base path and error guards', () => {
  it.each([
    [undefined, '/runtime/command-lease'],
    ['/custom///', '/custom/command-lease'],
    ['  /outer/path//  ', '/outer/path/command-lease'],
  ])('normalizes base path %s', async (basePath, expectedUrl) => {
    const fetch = echoingFetch()
    await createClient(fetch.call, basePath === undefined ? {} : { basePath }).writeBoolean(WRITE_A)
    expect(fetch.calls[0]!.url).toBe(expectedUrl)
  })

  it.each(['', '   ', ' /// '])('rejects empty normalized base path %j before fetch', (basePath) => {
    const fetch = vi.fn()
    expect(() => createRuntimeGatewayCommandClientV1({ basePath, fetch, createCommandId: () => 'command-1' }))
      .toThrow(expect.objectContaining({ code: 'RUNTIME_GATEWAY_BASE_PATH_INVALID', statusCode: null }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires an explicitly injected Command ID factory', () => {
    expect(() => createRuntimeGatewayCommandClientV1({} as RuntimeGatewayCommandClientOptionsV1)).toThrow('createCommandId is required.')
  })

  it('accepts only real Runtime client errors with valid closed code/status pairs', () => {
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'timeout'))).toBe(true)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_HTTP_503', 'http', { statusCode: 503 }))).toBe(true)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('COMMAND_SERVICE_CLOSED', 'closed', { statusCode: 503 }))).toBe(true)
    expect(isRuntimeGatewayCommandClientV1Error({ code: 'RUNTIME_GATEWAY_TIMEOUT', statusCode: null })).toBe(false)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_TIMEOUT', 'bad', { statusCode: 503 }))).toBe(false)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('RUNTIME_GATEWAY_HTTP_503', 'bad', { statusCode: 502 }))).toBe(false)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('UNTRACKED_CODE', 'bad'))).toBe(false)
    expect(isRuntimeGatewayCommandClientV1Error(new RuntimeGatewayCommandClientV1Error('COMMAND_SERVICE_CLOSED', 'bad', { statusCode: 200 }))).toBe(false)
  })

  it('accepts only real closed Signal write errors', () => {
    expect(isGatewaySignalWriteErrorV1(new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_NOT_FOUND', 'missing'))).toBe(true)
    expect(isGatewaySignalWriteErrorV1(new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_AMBIGUOUS', 'ambiguous'))).toBe(true)
    expect(isGatewaySignalWriteErrorV1({ code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' })).toBe(false)
    const changed = new GatewaySignalWriteErrorV1('SIGNAL_WRITE_MAPPING_NOT_FOUND', 'changed')
    ;(changed as unknown as { code: string }).code = 'OTHER'
    expect(isGatewaySignalWriteErrorV1(changed)).toBe(false)
  })
})

describe('GatewaySignalWritePortV1', () => {
  it('reads one atomic context and forwards the canonical revision with explicit undefined', async () => {
    const project = writableProject()
    const readActiveContext = vi.fn(() => ({ project, configRevision: REVISION_A }))
    const writeBoolean = vi.fn(async (
      _request: typeof WRITE_A,
      _signal?: AbortSignal,
    ): Promise<CommandResultV1> => resultFor({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: project.projectId,
      configRevision: REVISION_A, leaseGeneration: 1, expiresAt: 1, targetId: 'map-start', value: true,
    }))
    const port = createGatewaySignalWritePortV1({ readActiveContext, commandClient: { writeBoolean, clearLease() {} } })
    await port.writeBoolean('start', true)
    expect(readActiveContext).toHaveBeenCalledOnce()
    expect(writeBoolean).toHaveBeenCalledExactlyOnceWith({
      projectId: project.projectId, configRevision: REVISION_A, targetId: 'map-start', value: true,
    }, undefined)
    expect(REVISION_A).not.toBe(project.revisionId)
  })

  it('forwards the identical caller AbortSignal', async () => {
    const writeBoolean = vi.fn(async (
      _request: typeof WRITE_A,
      _signal?: AbortSignal,
    ): Promise<CommandResultV1> => resultFor({
      type: 'command-request-v1', protocolVersion: 1, commandId: 'command-1', projectId: WRITE_A.projectId,
      configRevision: REVISION_A, leaseGeneration: 1, expiresAt: 1, targetId: 'map-start', value: true,
    }))
    const port = createGatewaySignalWritePortV1({
      readActiveContext: () => ({ project: writableProject(), configRevision: REVISION_A }),
      commandClient: { writeBoolean, clearLease() {} },
    })
    const signal = new AbortController().signal
    await port.writeBoolean('start', true, signal)
    expect(writeBoolean.mock.calls[0]![1]).toBe(signal)
  })

  it('rejects zero local Mapping candidates with no client call', async () => {
    const project = cloneWorkcellProjectV5(writableProject())
    ;(project.opcUa.mappings as unknown as unknown[]).splice(0)
    const writeBoolean = vi.fn()
    const port = createGatewaySignalWritePortV1({
      readActiveContext: () => ({ project: validateWorkcellProjectV5(project), configRevision: REVISION_A }),
      commandClient: { writeBoolean, clearLease() {} },
    })
    await expect(port.writeBoolean('start', true)).rejects.toMatchObject({ code: 'SIGNAL_WRITE_MAPPING_NOT_FOUND' })
    expect(writeBoolean).not.toHaveBeenCalled()
  })

  it('rejects ambiguous local Mapping candidates with no client call', async () => {
    const project = cloneWorkcellProjectV5(writableProject())
    const duplicate = structuredClone(project.opcUa.mappings[0]!) as unknown as { id: string; nodeAddress: { identifier: string } }
    duplicate.id = 'map-start-second'
    duplicate.nodeAddress.identifier = 'Start.Second'
    ;(project.opcUa.mappings as unknown as unknown[]).push(duplicate)
    const writeBoolean = vi.fn()
    const port = createGatewaySignalWritePortV1({
      readActiveContext: () => ({ project: validateWorkcellProjectV5(project), configRevision: REVISION_A }),
      commandClient: { writeBoolean, clearLease() {} },
    })
    await expect(port.writeBoolean('start', true)).rejects.toMatchObject({ code: 'SIGNAL_WRITE_MAPPING_AMBIGUOUS' })
    expect(writeBoolean).not.toHaveBeenCalled()
  })
})

const NODE_BUILTIN_ROOTS = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/u, '').split('/')[0]!),
)

interface BrowserBoundaryReport {
  readonly forbiddenSpecifiers: readonly string[]
  readonly forbiddenIdentifiers: readonly string[]
  readonly parserFailures: readonly string[]
}

function sourceModuleSpecifiers(sourceFile: ts.SourceFile): readonly string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    } else if (
      ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    } else if (ts.isCallExpression(node)) {
      const [argument] = node.arguments
      if (
        argument !== undefined
        && ts.isStringLiteralLike(argument)
        && (
          node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
        )
      ) specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function isForbiddenBrowserSpecifier(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/').toLowerCase()
  const root = normalized.replace(/^node:/u, '').split('/')[0]!
  return normalized.startsWith('node:')
    || NODE_BUILTIN_ROOTS.has(root)
    || normalized === 'node-opcua'
    || normalized.startsWith('node-opcua/')
    || normalized.includes('project-v4')
    || normalized.includes('runtime-gateway/v4')
    || normalized.includes('/v4/')
    || normalized.split('/').includes('middleware')
}

function scanBrowserCommandBoundary(
  sources: Readonly<Record<string, string>>,
): BrowserBoundaryReport {
  const forbiddenSpecifiers: string[] = []
  const forbiddenIdentifiers: string[] = []
  const parserFailures: string[] = []
  for (const [path, source] of Object.entries(sources)) {
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const diagnostics = (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? []
    parserFailures.push(...diagnostics.map((diagnostic) => (
      `${path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
    )))
    for (const specifier of sourceModuleSpecifiers(sourceFile)) {
      if (isForbiddenBrowserSpecifier(specifier)) forbiddenSpecifiers.push(`${path}: ${specifier}`)
    }
    const visitIdentifiers = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && (node.text === 'process' || node.text === 'Buffer')) {
        forbiddenIdentifiers.push(`${path}: ${node.text}`)
      }
      ts.forEachChild(node, visitIdentifiers)
    }
    visitIdentifiers(sourceFile)
  }
  return { forbiddenSpecifiers, forbiddenIdentifiers, parserFailures }
}

describe('browser command static boundary', () => {
  it('keeps the shared compiler and all three V5 Runtime Gateway files browser-safe', async () => {
    const [compiler, lifecycle, command, stream] = await Promise.all([
      import('../../../core/project-v5/opcua-boolean-write-targets.ts?raw'),
      import('./endpoint-lifecycle-router.ts?raw'),
      import('./runtime-gateway-command-client.ts?raw'),
      import('./runtime-gateway-state-stream.ts?raw'),
    ])
    expect(scanBrowserCommandBoundary({
      'src/core/project-v5/opcua-boolean-write-targets.ts': compiler.default,
      'src/features/runtime-gateway/v5/endpoint-lifecycle-router.ts': lifecycle.default,
      'src/features/runtime-gateway/v5/runtime-gateway-command-client.ts': command.default,
      'src/features/runtime-gateway/v5/runtime-gateway-state-stream.ts': stream.default,
    })).toEqual({ forbiddenSpecifiers: [], forbiddenIdentifiers: [], parserFailures: [] })
  })

  it('detects static, dynamic, side-effect, export, import-type, and require Node/V4/server dependencies', () => {
    const report = scanBrowserCommandBoundary({
      'synthetic.ts': `
        import fs from 'fs'
        import 'node:os'
        export * from 'node:util'
        type Stat = import('fs/promises').Stats
        const pathModule = import('node:path')
        const timers = require('timers/promises')
        import { validateWorkcellProjectV4 } from '../../../core/project-v4/index.js'
        import { createLegacyStream } from '../v4/runtime-gateway-stream-v4.js'
        import { startGateway } from '../../../../middleware/runtime-gateway/main.js'
        import { OPCUAClient } from 'node-opcua'
        void process
        void Buffer
        void fs
        void pathModule
        void timers
      `,
    })
    expect(report).toEqual({
      forbiddenSpecifiers: [
        'synthetic.ts: fs',
        'synthetic.ts: node:os',
        'synthetic.ts: node:util',
        'synthetic.ts: fs/promises',
        'synthetic.ts: node:path',
        'synthetic.ts: timers/promises',
        'synthetic.ts: ../../../core/project-v4/index.js',
        'synthetic.ts: ../v4/runtime-gateway-stream-v4.js',
        'synthetic.ts: ../../../../middleware/runtime-gateway/main.js',
        'synthetic.ts: node-opcua',
      ],
      forbiddenIdentifiers: ['synthetic.ts: process', 'synthetic.ts: Buffer'],
      parserFailures: [],
    })
  })
})
