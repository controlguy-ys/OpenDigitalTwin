import { expect, test } from '@playwright/test'

const MIB = 1024 * 1024
const SOURCE_BYTES = 64 * MIB
const PROJECT_BYTES = 256 * MIB
const EXPECTED_DIGESTS = [
  '3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351',
  '9aeda0ca13e528c577f7436bdf406521ffbce63dde0d7ae17dc0aa0ea709fe89',
  '57601e835866583c18d6f6a09d23cd7f1dd4fd10794ee12660cbc63c9b3a52a4',
  '9110bd3e5ffaf8ef6a16c8c18d36abcf8d33747d0f3c4072d775d3d228bdca68',
] as const

interface ProjectHashBrowserEvidence {
  readonly projectByteLength: number
  readonly sourceOwnerKeys: readonly string[]
  readonly sourceByteLengths: readonly number[]
  readonly digests: readonly string[]
  readonly perSourceElapsedMs: readonly number[]
  readonly totalElapsedMs: number
  readonly rafFrames: number
  readonly workersConstructed: number
  readonly workersTerminated: number
  readonly maxActiveWorkers: number
  readonly workerUrls: readonly string[]
  readonly callerBoundaryBytes: readonly number[]
}

type ProjectHashEvidenceWindow = Window & {
  __projectHashWorkerEvidence?: Promise<ProjectHashBrowserEvidence>
}

test('hashes a responsive multi-source 256 MiB Project through the real fallback Worker', async ({
  page,
  browserName,
}) => {
  expect(browserName).toBe('chromium')
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/tests/project-hash-worker.html')
  await expect(page).toHaveTitle('Project SHA-256 Worker Evidence')
  const run = page.getByRole('button', { name: 'Run 256 MiB hash evidence' })
  await expect(run).toBeEnabled()
  await run.click()

  const evidence = await page.evaluate(async () => {
    const pending = (window as ProjectHashEvidenceWindow)
      .__projectHashWorkerEvidence
    if (pending === undefined) {
      throw new Error('Project hash browser evidence did not start.')
    }
    return pending
  })
  expect(evidence.projectByteLength).toBe(PROJECT_BYTES)
  expect(evidence.sourceOwnerKeys).toEqual([
    'robot-source:robot-0',
    'robot-source:robot-1',
    'object-asset:object-0',
    'object-asset:object-1',
  ])
  expect(evidence.sourceByteLengths).toEqual([
    SOURCE_BYTES,
    SOURCE_BYTES,
    SOURCE_BYTES,
    SOURCE_BYTES,
  ])
  expect(evidence.digests).toEqual(EXPECTED_DIGESTS)
  expect(evidence.perSourceElapsedMs).toHaveLength(4)
  expect(evidence.perSourceElapsedMs.every((elapsedMs) => elapsedMs < 60_000))
    .toBe(true)
  expect(evidence.rafFrames).toBeGreaterThan(10)
  expect(evidence.workersConstructed).toBe(4)
  expect(evidence.workersTerminated).toBe(4)
  expect(evidence.maxActiveWorkers).toBe(1)
  expect(evidence.workerUrls).toHaveLength(4)
  expect(evidence.workerUrls.every((url) => url.includes('sha256-worker')))
    .toBe(true)
  expect(evidence.callerBoundaryBytes).toEqual([0, 1, 2, 3])
  expect(consoleErrors).toEqual([])
})
