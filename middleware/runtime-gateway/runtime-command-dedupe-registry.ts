import type { CommandResultV1 } from '../../src/core/runtime-protocol/v1.js'

export const MAX_RUNTIME_COMMAND_RECORDS_V1 = 4_096

export type RuntimeCommandChannelV1 = 'client-write' | 'server-command'

export interface RuntimeCommandDedupeRecordV1 {
  readonly channel: RuntimeCommandChannelV1
  readonly key: string
  readonly fingerprint: string
}

export interface RuntimeCommandDedupeRegistryV1 {
  execute(
    record: RuntimeCommandDedupeRecordV1,
    callbacks: Readonly<{
      preflight: () => CommandResultV1 | null
      operation: () => Promise<CommandResultV1>
    }>,
  ): Promise<CommandResultV1>
  size(): number
  has(channel: RuntimeCommandChannelV1, key: string): boolean
  clear(): void
}

export class RuntimeCommandDedupeAdmissionErrorV1 extends Error {
  readonly code: 'COMMAND_ID_CONFLICT' | 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED'

  constructor(code: 'COMMAND_ID_CONFLICT' | 'COMMAND_DEDUPE_CAPACITY_EXHAUSTED') {
    super(code)
    this.name = 'RuntimeCommandDedupeAdmissionErrorV1'
    this.code = code
  }
}

interface StoredCommandV1 {
  readonly fingerprint: string
  readonly promise: Promise<CommandResultV1>
  settled: boolean
}

function identity(channel: RuntimeCommandChannelV1, key: string): string {
  return `${channel}\u0000${key}`
}

export function createRuntimeCommandDedupeRegistryV1(): RuntimeCommandDedupeRegistryV1 {
  const records = new Map<string, StoredCommandV1>()

  function evictOldestTerminal(): boolean {
    for (const [key, stored] of records) {
      if (!stored.settled) continue
      records.delete(key)
      return true
    }
    return false
  }

  function execute(
    record: RuntimeCommandDedupeRecordV1,
    callbacks: Readonly<{
      preflight: () => CommandResultV1 | null
      operation: () => Promise<CommandResultV1>
    }>,
  ): Promise<CommandResultV1> {
    const recordIdentity = identity(record.channel, record.key)
    const existing = records.get(recordIdentity)
    if (existing !== undefined) {
      if (existing.fingerprint === record.fingerprint) return existing.promise
      return Promise.reject(new RuntimeCommandDedupeAdmissionErrorV1('COMMAND_ID_CONFLICT'))
    }

    let preflight: CommandResultV1 | null
    try {
      preflight = callbacks.preflight()
    } catch (error) {
      return Promise.reject(error)
    }
    if (preflight !== null) return Promise.resolve(preflight)

    if (records.size >= MAX_RUNTIME_COMMAND_RECORDS_V1 && !evictOldestTerminal()) {
      return Promise.reject(new RuntimeCommandDedupeAdmissionErrorV1('COMMAND_DEDUPE_CAPACITY_EXHAUSTED'))
    }

    let resolve!: (value: CommandResultV1) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<CommandResultV1>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const stored: StoredCommandV1 = { fingerprint: record.fingerprint, promise, settled: false }
    records.set(recordIdentity, stored)

    let operation: Promise<CommandResultV1>
    try {
      operation = callbacks.operation()
    } catch (error) {
      operation = Promise.reject(error)
    }
    Promise.resolve(operation).then((value) => {
      if (records.get(recordIdentity) === stored) stored.settled = true
      resolve(value)
    }, (error: unknown) => {
      if (records.get(recordIdentity) === stored) stored.settled = true
      reject(error)
    })
    return promise
  }

  return Object.freeze({
    execute,
    size: () => records.size,
    has: (channel: RuntimeCommandChannelV1, key: string) => records.has(identity(channel, key)),
    clear: () => records.clear(),
  })
}
