import { expect, test } from '@playwright/test'

const MIB = 1024 * 1024
const CHUNK_BYTES = 4 * MIB
const EXPANSION_BYTES = 50 * MIB
const AUXILIARY_BYTES = 64 * MIB
const CENTRAL_BYTES = 16 * MIB
const SOURCE_BYTES = 256 * MIB
const COMPRESSED_BYTES = 300 * MIB

interface ProjectArchiveBrowserEvidence {
  readonly sourceByteLength: number
  readonly archiveByteLength: number
  readonly rafFrames: number
  readonly workersConstructed: number
  readonly workersTerminated: number
  readonly maxActiveWorkers: number
  readonly workerUrls: readonly string[]
  readonly requestChunkByteLengths: readonly number[]
  readonly outputChunkByteLengths: readonly number[]
  readonly maxActiveExpansions: number
  readonly expandedEntryByteLengths: readonly number[]
  readonly expandedSourceBytes: number
  readonly expandedJsonBytes: number
  readonly centralAuxiliaryBytes: readonly number[]
  readonly entryAuxiliaryBytes: readonly number[]
  readonly callerBoundaryBefore: readonly number[]
  readonly callerBoundaryAfter: readonly number[]
  readonly sourceLimit: number
  readonly sourceLimitExactAccepted: boolean
  readonly sourceLimitExactErrorCode: string
  readonly sourceLimitExactEncodeChunks: number
  readonly sourceLimitExactEncodedBytes: number
  readonly sourceLimitPlusOneErrorCode: string
  readonly sourceLimitPlusOneEncodeChunks: number
  readonly sourceLimitPlusOneCallerByteLength: number
  readonly sourceLimitPlusOneCallerBoundary: number
  readonly compressedLimit: number
  readonly compressedLimitExactAccepted: boolean
  readonly compressedLimitExactErrorCode: string
  readonly compressedLimitExactArchiveBytes: number
  readonly compressedLimitExactTailBytes: number
  readonly compressedLimitExactReadAttempts: number
  readonly compressedLimitExactReadBytes: number
  readonly compressedLimitExactMaxSliceBytes: number
  readonly compressedLimitPlusOneErrorCode: string
  readonly compressedLimitPlusOneWorkerDelta: number
  readonly compressedLimitPlusOneReadAttempts: number
}

type ProjectArchiveEvidenceWindow = Window & {
  __projectArchiveWorkerEvidence?: Promise<ProjectArchiveBrowserEvidence>
}

test('fully processes boundary archives responsively and rejects cap+1 plans before mutation in the real Worker path', async ({
  page,
  browserName,
}) => {
  expect(browserName).toBe('chromium')
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/tests/project-archive-worker.html')
  await expect(page).toHaveTitle('Project Archive Worker Evidence')
  const run = page.getByRole('button', { name: 'Run archive Worker evidence' })
  await expect(run).toBeEnabled()
  await run.click()

  const evidence = await page.evaluate(async () => {
    const pending = (window as ProjectArchiveEvidenceWindow)
      .__projectArchiveWorkerEvidence
    if (pending === undefined) {
      throw new Error('Project archive browser evidence did not start.')
    }
    return pending
  })

  expect(evidence.sourceByteLength).toBe(EXPANSION_BYTES)
  expect(evidence.archiveByteLength).toBeGreaterThan(0)
  expect(evidence.archiveByteLength).toBeLessThanOrEqual(COMPRESSED_BYTES)
  expect(evidence.rafFrames).toBeGreaterThan(10)

  expect(evidence.workersConstructed).toBeGreaterThanOrEqual(3)
  expect(evidence.workersTerminated).toBe(evidence.workersConstructed)
  expect(evidence.maxActiveWorkers).toBe(1)
  expect(evidence.workerUrls.length).toBe(evidence.workersConstructed)
  expect(evidence.workerUrls.every((url) => url.includes('project-archive-worker')))
    .toBe(true)

  expect(evidence.requestChunkByteLengths.length).toBeGreaterThan(0)
  expect(evidence.outputChunkByteLengths.length).toBeGreaterThan(0)
  expect(Math.max(...evidence.requestChunkByteLengths)).toBeLessThanOrEqual(CHUNK_BYTES)
  expect(Math.max(...evidence.outputChunkByteLengths)).toBeLessThanOrEqual(CHUNK_BYTES)
  expect(evidence.maxActiveExpansions).toBe(1)
  expect(evidence.expandedEntryByteLengths).toHaveLength(12)
  expect(Math.max(...evidence.expandedEntryByteLengths)).toBe(EXPANSION_BYTES)
  expect(evidence.expandedSourceBytes).toBe(SOURCE_BYTES)
  expect(evidence.expandedJsonBytes).toBeGreaterThan(40 * MIB)
  expect(evidence.expandedJsonBytes).toBeLessThanOrEqual(44 * MIB)
  expect(evidence.centralAuxiliaryBytes.length).toBeGreaterThan(0)
  expect(Math.max(...evidence.centralAuxiliaryBytes)).toBeLessThanOrEqual(CENTRAL_BYTES)
  expect(evidence.entryAuxiliaryBytes.length).toBe(12)
  expect(Math.max(...evidence.entryAuxiliaryBytes)).toBeLessThanOrEqual(AUXILIARY_BYTES)
  expect(evidence.callerBoundaryAfter).toEqual(evidence.callerBoundaryBefore)

  expect(evidence.sourceLimit).toBe(SOURCE_BYTES)
  expect(evidence.sourceLimitExactAccepted).toBe(true)
  expect(evidence.sourceLimitExactErrorCode).toBe('RESOLVED')
  expect(evidence.sourceLimitExactEncodeChunks).toBeGreaterThan(0)
  expect(evidence.sourceLimitExactEncodedBytes).toBe(SOURCE_BYTES)
  expect(evidence.sourceLimitPlusOneErrorCode).toBe('PROJECT_ARCHIVE_WORKER_FAILED')
  expect(evidence.sourceLimitPlusOneEncodeChunks).toBe(0)
  expect(evidence.sourceLimitPlusOneCallerByteLength).toBe(6 * MIB + 1)
  expect(evidence.sourceLimitPlusOneCallerBoundary).toBe(0x6b)

  expect(evidence.compressedLimit).toBe(COMPRESSED_BYTES)
  expect(evidence.compressedLimitExactAccepted).toBe(true)
  expect(evidence.compressedLimitExactErrorCode).toBe('RESOLVED')
  expect(evidence.compressedLimitExactArchiveBytes).toBe(COMPRESSED_BYTES)
  expect(evidence.compressedLimitExactTailBytes).toBe(CENTRAL_BYTES)
  expect(evidence.compressedLimitExactReadAttempts).toBeGreaterThan(12)
  expect(evidence.compressedLimitExactReadBytes).toBeGreaterThan(COMPRESSED_BYTES)
  expect(evidence.compressedLimitExactMaxSliceBytes).toBeLessThanOrEqual(CHUNK_BYTES)
  expect(evidence.compressedLimitPlusOneErrorCode).toBe('PROJECT_ARCHIVE_INVALID')
  expect(evidence.compressedLimitPlusOneWorkerDelta).toBe(0)
  expect(evidence.compressedLimitPlusOneReadAttempts).toBe(0)

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
