import { describe, expect, it } from 'vitest'

import { ProjectV4Error } from './errors'
import {
  canonicalProjectV4Bytes,
  canonicalProjectV4Json,
  configRevisionForProjectV4,
} from './canonical-json'
import { makeMinimalWorkcellProjectV4, projectAtLimit } from './test-support'
import type { SourceConventionV4, WorkcellProjectV4 } from './types'

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function reverseObjectKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => reverseObjectKeyOrder(item)) as T
  }
  if (value === null || typeof value !== 'object') return value

  const clone: Record<string, unknown> = {}
  for (const key of Object.keys(value).reverse()) {
    clone[key] = reverseObjectKeyOrder((value as Record<string, unknown>)[key])
  }
  return clone as T
}

function projectWithNumericLookingRecordKeys(): WorkcellProjectV4 {
  const project = jsonClone(makeMinimalWorkcellProjectV4())
  const definition = project.robotDefinitions[0]!
  const convention: SourceConventionV4 = {
    linearUnit: 'meter',
    sourceToMeters: 1,
    orientation: { mode: 'up-axis', upAxis: 'z' },
  }
  return {
    ...project,
    assetReferences: [
      ...project.assetReferences,
      {
        id: '10',
        uri: 'asset://local/ten.step',
        sha256: '1'.repeat(64),
        byteLength: 10,
        sourceFileName: 'ten.step',
        mediaType: 'model/step',
      },
      {
        id: '2',
        uri: 'asset://local/two.step',
        sha256: '2'.repeat(64),
        byteLength: 2,
        sourceFileName: 'two.step',
        mediaType: 'model/step',
      },
    ],
    robotDefinitions: [{
      ...definition,
      assetReferenceIds: [...definition.assetReferenceIds, '10', '2'],
      sourceConventions: {
        2: convention,
        10: convention,
        ...definition.sourceConventions,
      },
    }],
  }
}

function projectWithJobs(): WorkcellProjectV4 {
  const project = jsonClone(makeMinimalWorkcellProjectV4())
  return {
    ...project,
    actions: [
      {
        id: 'action-open',
        kind: 'set-gripper-state',
        robotId: 'robot-1',
        state: 'OPEN',
      },
      {
        id: 'action-close',
        kind: 'set-gripper-state',
        robotId: 'robot-1',
        state: 'CLOSED',
      },
    ],
    jobs: [
      {
        id: 'job-a',
        name: 'Job A',
        robotId: 'robot-1',
        steps: [
          { kind: 'joint-pose', jointValues: { J1: 0 }, speedPercentToNext: 25 },
          { kind: 'action-reference', actionId: 'action-open' },
        ],
      },
      {
        id: 'job-b',
        name: 'Job B',
        robotId: 'robot-1',
        steps: [
          { kind: 'joint-pose', jointValues: { J1: 10 }, speedPercentToNext: 50 },
          { kind: 'action-reference', actionId: 'action-close' },
        ],
      },
    ],
  }
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function withCrypto<T>(crypto: Crypto, action: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto })
  try {
    return await action()
  } finally {
    if (descriptor === undefined) delete (globalThis as { crypto?: Crypto }).crypto
    else Object.defineProperty(globalThis, 'crypto', descriptor)
  }
}

describe('canonical Project V4 JSON', () => {
  it('produces identical strings, bytes, and hashes for semantically identical object-key order', async () => {
    const project = projectWithNumericLookingRecordKeys()
    const reordered = reverseObjectKeyOrder(project)

    const canonical = canonicalProjectV4Json(project)
    expect(canonicalProjectV4Json(reordered)).toBe(canonical)
    expect(canonicalProjectV4Bytes(reordered)).toEqual(canonicalProjectV4Bytes(project))
    expect(await configRevisionForProjectV4(reordered)).toBe(await configRevisionForProjectV4(project))
    expect(canonical.indexOf('"10":')).toBeLessThan(canonical.indexOf('"2":'))
  })

  it('preserves semantic Robot, Joint, Job, and Job-step array order', async () => {
    const robots = projectAtLimit('robots', 2)
    const reversedRobots = { ...robots, robots: [...robots.robots].reverse() }
    expect(canonicalProjectV4Bytes(reversedRobots)).not.toEqual(canonicalProjectV4Bytes(robots))

    const joints = projectAtLimit('joints', 2)
    const reversedJoints = {
      ...joints,
      robotDefinitions: [{
        ...joints.robotDefinitions[0]!,
        joints: [...joints.robotDefinitions[0]!.joints].reverse(),
      }],
    }
    expect(canonicalProjectV4Bytes(reversedJoints)).not.toEqual(canonicalProjectV4Bytes(joints))

    const jobs = projectWithJobs()
    const reversedJobs = { ...jobs, jobs: [...jobs.jobs].reverse() }
    expect(canonicalProjectV4Bytes(reversedJobs)).not.toEqual(canonicalProjectV4Bytes(jobs))

    const reversedSteps = {
      ...jobs,
      jobs: [{ ...jobs.jobs[0]!, steps: [...jobs.jobs[0]!.steps].reverse() }, jobs.jobs[1]!],
    }
    expect(canonicalProjectV4Bytes(reversedSteps)).not.toEqual(canonicalProjectV4Bytes(jobs))
    expect(await configRevisionForProjectV4(reversedSteps)).not.toBe(
      await configRevisionForProjectV4(jobs),
    )
  })

  it('normalizes negative zero outside transforms', () => {
    const project = jsonClone(makeMinimalWorkcellProjectV4())
    const robot = project.robots[0]!
    const withNegativeZero = {
      ...project,
      robots: [{
        ...robot,
        numericStatus: { ...robot.numericStatus, value: -0 },
      }],
    }

    const canonical = canonicalProjectV4Json(withNegativeZero)
    expect(canonical).not.toMatch(/(?:^|[:,[])-0(?:[,}\]])/u)
    expect(Object.is((JSON.parse(canonical) as WorkcellProjectV4).robots[0]!.numericStatus.value, -0))
      .toBe(false)
  })

  it.each([
    ['NaN', (project: WorkcellProjectV4) => {
      const robot = project.robots[0]!
      return { ...project, robots: [{
        ...robot,
        numericStatus: { ...robot.numericStatus, value: Number.NaN },
      }] }
    }, 'PROJECT_VALUE_INVALID'],
    ['positive infinity', (project: WorkcellProjectV4) => {
      const robot = project.robots[0]!
      return { ...project, robots: [{
        ...robot,
        numericStatus: { ...robot.numericStatus, value: Number.POSITIVE_INFINITY },
      }] }
    }, 'PROJECT_VALUE_INVALID'],
    ['negative infinity', (project: WorkcellProjectV4) => {
      const robot = project.robots[0]!
      return { ...project, robots: [{
        ...robot,
        numericStatus: { ...robot.numericStatus, value: Number.NEGATIVE_INFINITY },
      }] }
    }, 'PROJECT_VALUE_INVALID'],
  ] as const)('rejects %s through Task 2 validation', (_name, mutate, code) => {
    expect(() => canonicalProjectV4Json(mutate(jsonClone(makeMinimalWorkcellProjectV4()))))
      .toThrow(code)
  })

  it('rejects sparse arrays, extra keys, accessors, and explicit undefined through Task 2 validation', () => {
    const sparse = jsonClone(makeMinimalWorkcellProjectV4())
    const sparseRobots = [...sparse.robots]
    sparseRobots.length = 2
    expect(() => canonicalProjectV4Json({ ...sparse, robots: sparseRobots }))
      .toThrow('PROJECT_ARRAY_NOT_DENSE')

    const extra = jsonClone(makeMinimalWorkcellProjectV4()) as WorkcellProjectV4 & { legacy?: boolean }
    extra.legacy = true
    expect(() => canonicalProjectV4Json(extra)).toThrow('PROJECT_RECORD_NOT_CLOSED')

    const accessor = jsonClone(makeMinimalWorkcellProjectV4())
    Object.defineProperty(accessor, 'revisionId', {
      configurable: true,
      enumerable: true,
      get: () => 'revision-accessor',
    })
    expect(() => canonicalProjectV4Json(accessor)).toThrow('PROJECT_RECORD_NOT_CLOSED')

    const explicitUndefined = jsonClone(makeMinimalWorkcellProjectV4()) as unknown as {
      metadata: { name: undefined }
    }
    explicitUndefined.metadata.name = undefined
    expect(() => canonicalProjectV4Json(explicitUndefined as unknown as WorkcellProjectV4))
      .toThrow('PROJECT_VALUE_INVALID')
  })

  it.each([1, 2, 3])('rejects schema %i before serialization', (schemaVersion) => {
    expect(() => canonicalProjectV4Json({ schemaVersion } as unknown as WorkcellProjectV4))
      .toThrow('PROJECT_SCHEMA_UNSUPPORTED')
  })

  it('emits exact UTF-8 without BOM, indentation, trailing newline, or caller mutation', () => {
    const source = jsonClone(makeMinimalWorkcellProjectV4())
    const project = {
      ...source,
      metadata: { ...source.metadata, name: '한글 Project' },
    }
    const before = JSON.stringify(project)

    const canonical = canonicalProjectV4Json(project)
    const first = canonicalProjectV4Bytes(project)
    const second = canonicalProjectV4Bytes(project)

    expect(new TextDecoder().decode(first)).toBe(canonical)
    expect(first).toEqual(new TextEncoder().encode(canonical))
    expect(first[0]).not.toBe(0xef)
    expect(canonical).not.toMatch(/\n|\r|  /u)
    expect(canonical.endsWith('\n')).toBe(false)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
    expect(JSON.stringify(project)).toBe(before)
    expect(Object.isFrozen(project)).toBe(false)
  })

  it('hashes exactly the canonical bytes with portable Web Crypto', async () => {
    const project = makeMinimalWorkcellProjectV4()
    const bytes = canonicalProjectV4Bytes(project)
    const revision = await configRevisionForProjectV4(project)

    expect(revision).toMatch(/^[a-f0-9]{64}$/u)
    expect(revision).toBe(await digestHex(bytes))
  })

  it('preserves Task 2 validation errors instead of wrapping them as digest failures', async () => {
    await expect(configRevisionForProjectV4({ schemaVersion: 3 } as unknown as WorkcellProjectV4))
      .rejects.toMatchObject({
        code: 'PROJECT_SCHEMA_UNSUPPORTED',
        path: '$.schemaVersion',
      } satisfies Partial<ProjectV4Error>)
  })

  it('reports stable Project errors when Web Crypto is unavailable or digesting fails', async () => {
    const project = makeMinimalWorkcellProjectV4()

    await withCrypto({} as Crypto, async () => {
      await expect(configRevisionForProjectV4(project)).rejects.toMatchObject({
        code: 'PROJECT_CRYPTO_UNAVAILABLE',
        path: '$',
      } satisfies Partial<ProjectV4Error>)
    })

    const rejectingCrypto = {
      subtle: { digest: async () => { throw new Error('platform text must be hidden') } },
    } as unknown as Crypto
    await withCrypto(rejectingCrypto, async () => {
      await expect(configRevisionForProjectV4(project)).rejects.toMatchObject({
        code: 'PROJECT_CONFIG_REVISION_FAILED',
        path: '$',
      } satisfies Partial<ProjectV4Error>)
    })
  })
})
