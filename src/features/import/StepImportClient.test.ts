import { describe, expect, it, vi } from 'vitest'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import {
  StepImportClient,
  type StepImportWorker,
} from './StepImportClient'
import type {
  StepWorkerRequest,
  StepWorkerResponse,
} from './step-worker-protocol'

const SUCCESS_RESULT: OcctSuccessResult = {
  success: true,
  root: { name: 'root', meshes: [0], children: [] },
  meshes: [
    {
      name: 'fixture',
      brep_faces: [],
      attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } },
      index: { array: [0, 1, 2] },
    },
  ],
}

class FakeWorker implements StepImportWorker {
  onmessage: ((event: MessageEvent<StepWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly postMessage = vi.fn<
    (message: StepWorkerRequest, transfer: Transferable[]) => void
  >()
  readonly terminate = vi.fn()

  respond(response: StepWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<StepWorkerResponse>)
  }

  fail(message = 'worker crashed'): void {
    this.onerror?.({ message } as ErrorEvent)
  }

  failClone(): void {
    this.onmessageerror?.({ data: null } as MessageEvent<unknown>)
  }
}

function createHarness() {
  const workers: FakeWorker[] = []
  const factory = vi.fn(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  return { client: new StepImportClient(factory), factory, workers }
}

describe('StepImportClient', () => {
  it('transfers a private byte copy with the fixed metre tessellation request', async () => {
    const { client, workers } = createHarness()
    const source = new Uint8Array([7, 11, 13, 17]).buffer
    const pending = client.import(source)
    const worker = workers[0]!

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    const [request, transfer] = worker.postMessage.mock.calls[0]!
    expect(request).toMatchObject({
      kind: 'import-step',
      options: {
        linearUnit: 'meter',
        linearDeflectionType: 'bounding_box_ratio',
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      },
    })
    expect(request.bytes).not.toBe(source)
    expect(Array.from(request.bytes)).toEqual([7, 11, 13, 17])
    expect(transfer).toEqual([request.bytes.buffer])
    expect(source.byteLength).toBe(4)

    worker.respond({ kind: 'success', result: SUCCESS_RESULT })
    await expect(pending).resolves.toBe(SUCCESS_RESULT)
  })

  it('rejects a worker error response and permits retry', async () => {
    const { client, workers } = createHarness()
    const first = client.import(new Uint8Array([1]).buffer)
    workers[0]!.respond({ kind: 'error', message: 'corrupt STEP' })

    await expect(first).rejects.toThrow('corrupt STEP')

    const retry = client.import(new Uint8Array([2]).buffer)
    workers[0]!.respond({ kind: 'success', result: SUCCESS_RESULT })
    await expect(retry).resolves.toBe(SUCCESS_RESULT)
  })

  it('rejects worker errors and message clone errors with actionable messages', async () => {
    const crashed = createHarness()
    const crashPending = crashed.client.import(new Uint8Array([1]).buffer)
    crashed.workers[0]!.fail('WASM failed')
    await expect(crashPending).rejects.toThrow('WASM failed')

    const cloneFailed = createHarness()
    const clonePending = cloneFailed.client.import(new Uint8Array([1]).buffer)
    cloneFailed.workers[0]!.failClone()
    await expect(clonePending).rejects.toThrow(/message/i)
  })

  it('rejects concurrent imports explicitly', async () => {
    const { client, workers } = createHarness()
    const first = client.import(new Uint8Array([1]).buffer)

    await expect(client.import(new Uint8Array([2]).buffer)).rejects.toThrow(
      /already in progress/i,
    )
    workers[0]!.respond({ kind: 'success', result: SUCCESS_RESULT })
    await first
  })

  it('cancel terminates, rejects once with AbortError, ignores late replies, and recreates the worker', async () => {
    const { client, factory, workers } = createHarness()
    const first = client.import(new Uint8Array([1]).buffer)
    const firstWorker = workers[0]!
    const rejection = vi.fn()
    void first.catch(rejection)

    client.cancel()
    client.cancel()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(rejection).toHaveBeenCalledTimes(1)

    firstWorker.respond({ kind: 'success', result: SUCCESS_RESULT })
    const second = client.import(new Uint8Array([2]).buffer)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(workers[1]).not.toBe(firstWorker)
    workers[1]!.respond({ kind: 'success', result: SUCCESS_RESULT })
    await expect(second).resolves.toBe(SUCCESS_RESULT)
  })

  it('dispose aborts an active import and permanently terminates its worker', async () => {
    const { client, workers } = createHarness()
    const pending = client.import(new Uint8Array([1]).buffer)

    client.dispose()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]!.terminate).toHaveBeenCalledTimes(1)
    await expect(client.import(new Uint8Array([2]).buffer)).rejects.toThrow(
      /disposed/i,
    )
  })
})
