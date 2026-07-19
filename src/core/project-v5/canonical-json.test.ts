import { describe, expect, it } from 'vitest'

import {
  canonicalProjectV5Bytes,
  canonicalProjectV5Json,
  configRevisionForProjectV5,
} from './canonical-json'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from './test-support'

function reverseObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseObjectKeys) as T
  if (value !== null && typeof value === 'object') {
    const reversed: Record<string, unknown> = {}
    for (const key of Object.keys(value).reverse()) {
      reversed[key] = reverseObjectKeys((value as Record<string, unknown>)[key])
    }
    return reversed as T
  }
  return value
}

describe('canonical Project V5 JSON', () => {
  it('keeps instruction array order while canonicalizing object keys', async () => {
    const project = makeMinimalWorkcellProjectV5()

    expect(canonicalProjectV5Bytes(reverseObjectKeys(project)))
      .toEqual(canonicalProjectV5Bytes(project))
    expect(await configRevisionForProjectV5(project)).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('emits whitespace-free UTF-8 JSON with lexicographic record keys', () => {
    const project = makeMinimalWorkcellProjectV5()
    const json = canonicalProjectV5Json(project)

    expect(json).toMatch(/^\{"assetReferences":/u)
    expect(json).not.toMatch(/[\n\r\t]|: |, /u)
    expect(new TextDecoder().decode(canonicalProjectV5Bytes(project))).toBe(json)
  })

  it('normalizes negative zero after validation', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.robotDefinitions[0]!.joints[0]!.origin.positionM as unknown as number[])[0] = -0

    expect(canonicalProjectV5Json(project)).toContain('"positionM":[0,0,0]')
  })

  it('preserves authored instruction order while making it revision-significant', async () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.jobs[0]!.instructions as unknown as Array<Record<string, unknown>>).push({
      id: 'instruction-2',
      kind: 'move-joint',
      jointValues: { J1: 1 },
      speedPercentToNext: 50,
    })
    const swapped = cloneWorkcellProjectV5(project)
    ;(swapped.jobs[0]!.instructions as unknown as Array<Record<string, unknown>>).reverse()

    const canonical = JSON.parse(canonicalProjectV5Json(project)) as {
      jobs: Array<{ instructions: Array<{ id: string }> }>
    }
    expect(canonical.jobs[0]!.instructions.map(({ id }) => id))
      .toEqual(['instruction-1', 'instruction-2'])
    expect(canonicalProjectV5Bytes(swapped)).not.toEqual(canonicalProjectV5Bytes(project))
    await expect(configRevisionForProjectV5(swapped)).resolves.not.toBe(
      await configRevisionForProjectV5(project),
    )
  })

  it('validates candidates before canonicalizing', () => {
    const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
    ;(project.logicalSignals[0] as unknown as Record<string, unknown>).quality = 'GOOD'

    expect(() => canonicalProjectV5Json(project)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$.logicalSignals[0]' }),
    )
  })
})
