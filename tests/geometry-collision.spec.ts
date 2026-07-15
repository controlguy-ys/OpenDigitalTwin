import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync, zipSync } from 'fflate'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const FIXTURE_ENTITY_ID = 'object:collision-fixture'
const LINK00_PAIR = `${FIXTURE_ENTITY_ID}|robot-link:LINK00`
const HELD_WORKER_PAIR =
  `${FIXTURE_ENTITY_ID}|object:collision-worker-load-00`

interface CollisionReportRow {
  kind: 'collision' | 'near-miss'
  pairKey: string
  firstEntityId: string
  secondEntityId: string
  firstBoxId: string
  secondBoxId: string
  approximateClearanceMm: number
  sampleIndex: number | null
  timeMs: number | null
}

interface CollisionReport {
  schemaVersion: number
  summary: {
    totalFindings: number
    collisions: number
    nearMisses: number
    truncated: boolean
  }
  findings: CollisionReportRow[]
}

interface CollisionWorkerEvidence {
  constructedUrls: string[]
  progressEvents: Array<{
    processedSamples: number
    totalSamples: number
    rafFrames: number
  }>
  rafFrames: number
  inFlightFrames: number
  partialProgressFrames: number
}

type CollisionWorkerEvidenceWindow = Window & {
  __geometryCollisionWorkerEvidence: CollisionWorkerEvidence
}

interface ProjectSemantics {
  schemaVersion: number
  name: string
  objectInstanceCount: number
  objectTransform: {
    position: number[]
    quaternion: number[]
    scale: number[]
  }
  objectCollisionBoxes: unknown[]
  poseAngles: number[][]
  collisionPolicy: {
    enabled: boolean
    warningDistanceM: number
    ignoredPairKeys: string[]
    enabledRobotSelfPairs: string[]
  }
}

function jsonEntry<T>(
  entries: Record<string, Uint8Array>,
  path: string,
): T {
  const bytes = entries[path]
  if (bytes === undefined) throw new Error(`Missing fixture entry: ${path}`)
  return JSON.parse(decoder.decode(bytes)) as T
}

function putJson(
  entries: Record<string, Uint8Array>,
  path: string,
  value: unknown,
): void {
  entries[path] = encoder.encode(JSON.stringify(value, null, 2))
}

function canonicalPoseDurationMs(
  entries: Record<string, Uint8Array>,
  fromAnglesDeg: readonly number[],
  toAnglesDeg: readonly number[],
  speedPercentToNext: number,
): number {
  const configuration = jsonEntry<{
    mechanics: { joints: Array<{ maxVelocityDegPerSec: number }> }
  }>(entries, 'robot/configuration.json')
  return Math.max(16, ...fromAnglesDeg.map((fromDeg, index) =>
    Math.abs(toAnglesDeg[index]! - fromDeg) /
      configuration.mechanics.joints[index]!.maxVelocityDegPerSec *
      1_000 * 100 / speedPercentToNext,
  ))
}

function v3CollisionFixture(source: Uint8Array): Buffer {
  const entries = unzipSync(source)
  const manifest = jsonEntry<Record<string, unknown>>(entries, 'manifest.json')
  const externalEntities = jsonEntry<Record<string, unknown>[]>(
    entries,
    'external/entities.json',
  )
  const sources = jsonEntry<Record<string, unknown>[]>(entries, 'robot/sources/index.json')
  const links = jsonEntry<Record<string, unknown>[]>(entries, 'robot/links/index.json')
  const sourceRecord = sources[0]
  const sourceLink = links[0]
  if (sourceRecord === undefined || sourceLink === undefined) {
    throw new Error('Default Robot has no Link source.')
  }
  const digest = String(sourceRecord.sha256)
  const sourcePath = `robot/sources/${digest}.step`
  const sourceBytes = entries[sourcePath]
  if (sourceBytes === undefined) throw new Error(`Missing source STEP: ${sourcePath}`)
  for (const candidate of sources.slice(1)) {
    delete entries[`robot/sources/${String(candidate.sha256)}.step`]
  }
  putJson(entries, 'robot/sources/index.json', [sourceRecord])
  putJson(entries, 'robot/links/index.json', links.map((link) => ({
    ...link,
    sourceRefs: (link.sourceRefs as Record<string, unknown>[]).map((sourceRef) => ({
      ...sourceRef,
      sourceAssetId: digest,
    })),
  })))

  putJson(entries, 'manifest.json', {
    ...manifest,
    schemaVersion: 3,
    projectId: 'geometry-collision-acceptance',
    name: 'Geometry Collision Acceptance',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  })
  const objectStepPath = `objects/assets/${digest}.step`
  entries[objectStepPath] = sourceBytes.slice()
  putJson(entries, 'objects/assets.json', [{
    id: 'collision-fixture-asset',
    name: 'Collision Fixture Asset',
    sourceKind: 'step',
    sourceFileName: 'collision-fixture.step',
    sourceSha256: digest,
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.02, 0.02, 0.02],
    collisionBoxes: [{
      id: 'fixture-body',
      center: [0, 0, 0],
      halfExtents: [0.02, 0.02, 0.02],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: sourceLink.statistics,
  }])
  putJson(entries, 'objects/instances.json', [{
    id: 'collision-fixture',
    assetId: 'collision-fixture-asset',
    name: 'Collision Fixture',
    manualNumericStatus: 7,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
    graspable: false,
  }])
  putJson(entries, 'external/entities.json', [
    ...externalEntities,
    {
      entityId: FIXTURE_ENTITY_ID,
      manualTransform: {
        position: [0, 0, 1.15],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      transformSource: 'manual',
    },
  ])
  const startAngles = [-249.75, 0, 0, 0, 0, 0]
  const endAngles = [249.75, 0, 0, 0, 0, 0]
  putJson(entries, 'simulation/jobs.json', {
    activeJobId: 'geometry-job',
    jobs: [{
      id: 'geometry-job',
      name: 'Geometry acceptance',
      revision: 1,
      poses: [{
      id: 'pose-home',
      name: 'Home',
      anglesDeg: startAngles,
      durationMs: canonicalPoseDurationMs(entries, startAngles, endAngles, 100),
      easing: 'linear',
      speedPercentToNext: 100,
      }, {
      id: 'pose-cup',
      name: 'Cup Pick',
      anglesDeg: endAngles,
      durationMs: 1_000,
      easing: 'linear',
      speedPercentToNext: 100,
      }],
    }],
  })
  putJson(entries, 'collision/policy.json', {
    enabled: true,
    warningDistanceM: 0.02,
    ignoredPairKeys: [],
    enabledRobotSelfPairs: [],
  })

  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      { level: 6 },
    ),
  )
}

function heldWorkerFixture(source: Uint8Array): Buffer {
  const entries = unzipSync(source)
  const manifest = jsonEntry<Record<string, unknown>>(entries, 'manifest.json')
  const externalEntities = jsonEntry<Record<string, unknown>[]>(
    entries,
    'external/entities.json',
  )
  const sources = jsonEntry<Record<string, unknown>[]>(entries, 'robot/sources/index.json')
  const links = jsonEntry<Record<string, unknown>[]>(
    entries,
    'robot/links/index.json',
  )
  const sourceRecord = sources[0]
  const sourceLink = links[0]
  if (sourceRecord === undefined || sourceLink === undefined) {
    throw new Error('Default Robot has no Link source.')
  }
  const digest = String(sourceRecord.sha256)
  const sourcePath = `robot/sources/${digest}.step`
  const sourceBytes = entries[sourcePath]
  if (sourceBytes === undefined) throw new Error(`Missing source STEP: ${sourcePath}`)
  const collisionBoxes = Array.from({ length: 10 }, (_, index) => ({
    id: `worker-${index.toString().padStart(2, '0')}`,
    center: [0, 0, 0],
    halfExtents: [0.02, 0.02, 0.02],
    quaternion: [0, 0, 0, 1],
  }))

  putJson(entries, 'manifest.json', {
    ...manifest,
    schemaVersion: 3,
    projectId: 'geometry-collision-worker-acceptance',
    name: 'Geometry Collision Worker Acceptance',
    createdAt: '2026-07-13T01:00:00.000Z',
    updatedAt: '2026-07-13T01:00:00.000Z',
  })
  const objectStepPath = `objects/assets/${digest}.step`
  entries[objectStepPath] = sourceBytes.slice()
  putJson(entries, 'objects/assets.json', [{
    id: 'collision-fixture-asset',
    name: 'Collision Fixture Asset',
    sourceKind: 'step',
    sourceFileName: 'collision-fixture.step',
    sourceSha256: digest,
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.02, 0.02, 0.02],
    collisionBoxes,
    statistics: sourceLink.statistics,
  }])
  const fixture = {
    id: 'collision-fixture',
    assetId: 'collision-fixture-asset',
    name: 'Collision Fixture',
    manualNumericStatus: 7,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
    graspable: true,
  }
  const instances = [
    fixture,
    ...Array.from({ length: 4 }, (_, index) => ({
      ...fixture,
      id: `collision-worker-load-${index.toString().padStart(2, '0')}`,
      name: `Collision Worker Load ${index + 1}`,
      manualNumericStatus: 0,
      statusOverlayVisible: false,
      graspable: false,
    })),
  ]
  putJson(entries, 'objects/instances.json', instances)
  putJson(entries, 'external/entities.json', [
    ...externalEntities,
    ...instances.map((instance, index) => ({
      entityId: `object:${instance.id}`,
      manualTransform: {
        position: index === 0
          ? [0.725, 0, 2.315]
          : index === 1
            ? [0.755, 0, 2.315]
            : [10 + (index - 1) * 0.25, 10, 10],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      transformSource: 'manual',
    })),
  ])
  const startAngles = [-249.75, 0, 0, 0, 0, 0]
  const endAngles = [249.75, 0, 0, 0, 0, 0]
  putJson(entries, 'simulation/jobs.json', {
    activeJobId: 'worker-job',
    jobs: [{
      id: 'worker-job',
      name: 'Worker acceptance',
      revision: 1,
      poses: [{
      id: 'worker-start',
      name: 'Worker Start',
      anglesDeg: startAngles,
      durationMs: canonicalPoseDurationMs(entries, startAngles, endAngles, 100),
      easing: 'linear',
      speedPercentToNext: 100,
      }, {
      id: 'worker-end',
      name: 'Worker End',
      anglesDeg: endAngles,
      durationMs: 1_000,
      easing: 'linear',
      speedPercentToNext: 100,
      }],
    }],
  })
  putJson(entries, 'collision/policy.json', {
    enabled: true,
    warningDistanceM: 0.05,
    ignoredPairKeys: [],
    enabledRobotSelfPairs: [],
  })

  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      { level: 6 },
    ),
  )
}

async function downloadPath(download: Download): Promise<string> {
  const path = await download.path()
  if (path === null) throw new Error('Playwright did not retain the download.')
  return path
}

async function downloadJsonReport(page: Page): Promise<CollisionReport> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download JSON report' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('geometry-proxy-collision.json')
  return JSON.parse(await readFile(await downloadPath(download), 'utf8')) as CollisionReport
}

async function downloadCsvReport(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV report' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('geometry-proxy-collision.csv')
  return readFile(await downloadPath(download), 'utf8')
}

async function waitForImportedProject(page: Page, name: string): Promise<void> {
  await Promise.race([
    page.getByText(name, { exact: true }).waitFor({ state: 'visible', timeout: 180_000 }),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 180_000 }).then(async () => {
      throw new Error(await page.getByRole('alert').innerText())
    }),
  ])
}

async function openDrawer(page: Page, name: string): Promise<void> {
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.getAttribute('aria-label') === label)
    if (button === undefined) throw new Error(`Missing drawer control: ${label}`)
    if (button.getAttribute('aria-expanded') !== 'true') button.click()
  }, name)
}

async function activeProjectSemantics(page: Page): Promise<ProjectSemantics> {
  return page.evaluate(async (fixtureEntityId) => {
    const snapshot = await new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('robot-sim-project')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction(
          ['projectPointers', 'projectRevisions'],
          'readonly',
        )
        const pointerRequest = transaction.objectStore('projectPointers').get('active')
        pointerRequest.onerror = () => reject(pointerRequest.error)
        pointerRequest.onsuccess = () => {
          const pointer = pointerRequest.result
          if (pointer === undefined) {
            database.close()
            reject(new Error('Active project pointer is missing.'))
            return
          }
          const revisionRequest = transaction
            .objectStore('projectRevisions')
            .get(pointer.revisionId)
          revisionRequest.onerror = () => reject(revisionRequest.error)
          revisionRequest.onsuccess = () => {
            database.close()
            resolve(revisionRequest.result?.snapshot)
          }
        }
      }
    })
    if (snapshot === undefined) throw new Error('Active project is missing.')
    const instance = snapshot.objectInstances.find(
      ({ id }: { id: string }) => id === 'collision-fixture',
    )
    const asset = snapshot.objectAssets.find(
      ({ id }: { id: string }) => id === 'collision-fixture-asset',
    )
    if (instance === undefined || asset === undefined) {
      throw new Error('Collision fixture is missing from the active project.')
    }
    const entity = snapshot.externalEntities.find(
      ({ entityId }: { entityId: string }) => entityId === fixtureEntityId,
    )
    if (entity === undefined) throw new Error('Collision fixture transform is missing.')
    const job = snapshot.simulation.jobs.find(
      ({ id }: { id: string }) => id === snapshot.simulation.activeJobId,
    )
    if (job === undefined) throw new Error('Active simulation Job is missing.')
    return {
      schemaVersion: snapshot.manifest.schemaVersion,
      name: snapshot.manifest.name,
      objectInstanceCount: snapshot.objectInstances.length,
      objectTransform: entity.manualTransform,
      objectCollisionBoxes: asset.collisionBoxes,
      poseAngles: job.poses.map(({ anglesDeg }: { anglesDeg: number[] }) =>
        anglesDeg,
      ),
      collisionPolicy: snapshot.collisionPolicy,
    }
  }, FIXTURE_ENTITY_ID)
}

async function selectCollisionFixture(page: Page): Promise<void> {
  await openDrawer(page, 'Scene Assets drawer')
  await openDrawer(page, 'Inspector drawer')
  await page.getByRole('button', { name: 'Select Collision Fixture' }).click()
}

async function applyFixturePosition(
  page: Page,
  positionMm: readonly [number, number, number],
): Promise<void> {
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await inspector.getByLabel('X (mm)').fill(String(positionMm[0]))
  await inspector.getByLabel('Y (mm)').fill(String(positionMm[1]))
  await inspector.getByLabel('Z (mm)').fill(String(positionMm[2]))
  await inspector.getByRole('button', { name: 'Apply transform' }).click()
  await expect(inspector.getByLabel('X (mm)')).toHaveValue(String(positionMm[0]))
  await expect(inspector.getByLabel('Y (mm)')).toHaveValue(String(positionMm[1]))
  await expect(inspector.getByLabel('Z (mm)')).toHaveValue(String(positionMm[2]))
}

test('accepts V3 geometry collision and report workflows', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const [defaultDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  const fixture = v3CollisionFixture(
    await readFile(await downloadPath(defaultDownload)),
  )
  await page.getByLabel('Import project').setInputFiles({
    name: 'geometry-collision-v3.wdtwin',
    mimeType: 'application/zip',
    buffer: fixture,
  })
  await waitForImportedProject(page, 'Geometry Collision Acceptance')

  const migrated = await activeProjectSemantics(page)
  expect(migrated).toMatchObject({
    schemaVersion: 3,
    name: 'Geometry Collision Acceptance',
    objectTransform: { position: [0, 0, 1.15] },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
    },
  })
  expect(migrated.objectCollisionBoxes).toHaveLength(1)
  expect(migrated.poseAngles).toHaveLength(2)

  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Collision [1-9]/,
  )
  const collisionReport = await downloadJsonReport(page)
  expect(collisionReport.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'collision', pairKey: LINK00_PAIR }),
      expect.objectContaining({
        kind: 'collision',
        pairKey: 'robot-link:LINK01|workcell:workbench',
      }),
    ]),
  )
  expect(collisionReport.findings.map(({ pairKey }) => pairKey)).not.toContain(
    'robot-link:LINK00|workcell:workbench',
  )

  await selectCollisionFixture(page)
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  await expect(inspector.getByLabel('X (mm)')).toHaveValue('0')
  await expect(inspector.getByLabel('Z (mm)')).toHaveValue('1150')

  await page.getByLabel('Warning distance (mm)').fill('50')
  await applyFixturePosition(page, [135, 0, 1_150])
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Near-miss [1-9]/,
  )
  const nearReport = await downloadJsonReport(page)
  const nearIndex = nearReport.findings.findIndex(
    ({ kind, pairKey }) => kind === 'near-miss' && pairKey === LINK00_PAIR,
  )
  expect(nearIndex).toBeGreaterThanOrEqual(0)
  expect(nearReport.findings).not.toContainEqual(
    expect.objectContaining({ pairKey: 'robot-link:LINK00|workcell:workbench' }),
  )
  await expect(inspector.getByLabel('X (mm)')).toHaveValue('135')
  await expect(inspector.getByLabel('Z (mm)')).toHaveValue('1150')

  const firstFinding = page.getByRole('button', { name: 'First finding' })
  if (await firstFinding.isEnabled()) await firstFinding.click()
  const nextFinding = page.getByRole('button', { name: 'Next finding' })
  if (await nextFinding.isEnabled()) {
    await nextFinding.click()
    await firstFinding.click()
    await expect(page.getByText(/^Finding 1 of /)).toBeVisible()
  }
  for (let index = 0; index < nearIndex; index += 1) await nextFinding.click()
  await expect(page.locator('.collision-finding code')).toHaveText(LINK00_PAIR)
  await page.getByRole('button', {
    name: `Ignore ${FIXTURE_ENTITY_ID} and robot-link:LINK00`,
  }).click()
  await expect(page.getByRole('list', { name: 'Ignored collision pairs' }))
    .toContainText(LINK00_PAIR)
  const ignoredReport = await downloadJsonReport(page)
  expect(ignoredReport.findings.map(({ pairKey }) => pairKey)).not.toContain(
    LINK00_PAIR,
  )

  await page.getByRole('button', { name: `Restore ${LINK00_PAIR}` }).click()
  await expect(page.getByRole('list', { name: 'Ignored collision pairs' }))
    .not.toBeVisible()
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Near-miss [1-9]/,
  )
  const restoredReport = await downloadJsonReport(page)
  const restoredRow = restoredReport.findings.find(
    ({ kind, pairKey }) => kind === 'near-miss' && pairKey === LINK00_PAIR,
  )
  expect(restoredRow).toBeDefined()
  expect(await downloadCsvReport(page)).toContain(
    'Kind,Pair,First Entity,Second Entity,First Box,Second Box,Approximate Clearance (mm),Sample,Time (ms)',
  )
})

test('preserves V3 collision semantics and report rows through Save, Export, and reload', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const [defaultDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  const fixture = v3CollisionFixture(
    await readFile(await downloadPath(defaultDownload)),
  )
  await page.getByLabel('Import project').setInputFiles({
    name: 'geometry-collision-v3.wdtwin',
    mimeType: 'application/zip',
    buffer: fixture,
  })
  await waitForImportedProject(page, 'Geometry Collision Acceptance')
  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Collision [1-9]/,
  )
  const beforeSemantics = await activeProjectSemantics(page)
  const beforeRow = (await downloadJsonReport(page)).findings.find(
    ({ kind, pairKey }) => kind === 'collision' && pairKey === LINK00_PAIR,
  )
  expect(beforeRow).toBeDefined()

  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  expect(projectDownload.suggestedFilename()).toBe(
    'Geometry Collision Acceptance.wdtwin',
  )
  await downloadPath(projectDownload)

  await page.reload()
  await waitForImportedProject(page, 'Geometry Collision Acceptance')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 180_000 },
  )
  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Collision [1-9]/,
  )
  const reloadedRow = (await downloadJsonReport(page)).findings.find(
    ({ kind, pairKey }) => kind === 'collision' && pairKey === LINK00_PAIR,
  )
  expect(reloadedRow).toEqual(beforeRow)
  expect(await activeProjectSemantics(page)).toEqual(beforeSemantics)
})

test('keeps browser animation responsive during held-object Worker validation', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.addInitScript(() => {
    const evidence: CollisionWorkerEvidence = {
      constructedUrls: [],
      progressEvents: [],
      rafFrames: 0,
      inFlightFrames: 0,
      partialProgressFrames: 0,
    }
    const NativeWorker = window.Worker
    class InstrumentedWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        const url = String(scriptURL)
        if (!url.includes('collision-validation.worker')) return
        evidence.constructedUrls.push(url)
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (event.data === null || typeof event.data !== 'object') return
          const message = event.data as {
            type?: unknown
            progress?: {
              processedSamples?: unknown
              totalSamples?: unknown
            }
          }
          if (
            message.type !== 'progress' ||
            typeof message.progress?.processedSamples !== 'number' ||
            typeof message.progress.totalSamples !== 'number'
          ) return
          evidence.progressEvents.push({
            processedSamples: message.progress.processedSamples,
            totalSamples: message.progress.totalSamples,
            rafFrames: evidence.rafFrames,
          })
        })
      }
    }
    ;(window as CollisionWorkerEvidenceWindow)
      .__geometryCollisionWorkerEvidence = evidence
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      writable: true,
      value: InstrumentedWorker,
    })
  })
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const [defaultDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  const workerFixture = heldWorkerFixture(
    await readFile(await downloadPath(defaultDownload)),
  )
  await page.getByLabel('Import project').setInputFiles({
    name: 'geometry-collision-worker-v3.wdtwin',
    mimeType: 'application/zip',
    buffer: workerFixture,
  })
  await waitForImportedProject(page, 'Geometry Collision Worker Acceptance')
  const workerSemantics = await activeProjectSemantics(page)
  expect(workerSemantics.objectInstanceCount).toBe(5)
  expect(workerSemantics.objectCollisionBoxes).toHaveLength(10)
  expect(
    workerSemantics.objectInstanceCount *
      workerSemantics.objectCollisionBoxes.length,
  ).toBe(50)
  await openDrawer(page, 'Scene Assets drawer')
  for (const name of ['Cup 01', 'Cup 02', 'Machine 01']) {
    const deleteEquipment = page.getByRole('button', {
      name: `Delete ${name}`,
    })
    await deleteEquipment.click()
    await expect(deleteEquipment).not.toBeVisible()
  }
  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByRole('status', {
    name: 'Scene collision telemetry',
  })).toContainText('Boxes 59', { timeout: 180_000 })

  await openDrawer(page, 'Inspector drawer')
  await expect(page.getByRole('spinbutton', { name: 'J1' })).toHaveValue('0')
  await page.getByRole('button', { name: 'Close Gripper' }).click()
  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByRole('status', { name: 'Held collision entity' }))
    .toHaveText(`Held Object: ${FIXTURE_ENTITY_ID}`)
  await page.evaluate(() => {
    const evidence = (window as CollisionWorkerEvidenceWindow)
      .__geometryCollisionWorkerEvidence
    evidence.rafFrames = 0
    evidence.inFlightFrames = 0
    evidence.partialProgressFrames = 0
    evidence.progressEvents.length = 0
    const countFrame = () => {
      evidence.rafFrames += 1
      const cancel = document.querySelector(
        'button[aria-label="Cancel Validation"]',
      )
      if (cancel !== null) {
        evidence.inFlightFrames += 1
        const status = document.querySelector(
          'output[aria-label="Sequence validation progress"]',
        )
        const match = status?.textContent?.trim().match(/^(\d+) \/ (\d+)$/)
        if (match !== null && Number(match?.[1]) < Number(match?.[2])) {
          evidence.partialProgressFrames += 1
        }
      }
      requestAnimationFrame(countFrame)
    }
    requestAnimationFrame(countFrame)
  })
  const rafFramesBeforeValidation = await page.evaluate(() =>
    (window as CollisionWorkerEvidenceWindow)
      .__geometryCollisionWorkerEvidence.rafFrames,
  )
  await page.getByRole('button', { name: 'Validate Sequence' }).click()
  await expect(page.getByRole('button', { name: 'Cancel Validation' }))
    .toBeVisible()
  const progress = page.getByRole('status', {
    name: 'Sequence validation progress',
  })
  await expect(progress).toHaveText(/^(250|500|750) \/ 1000$/)
  await expect(page.getByRole('button', { name: 'Validate Sequence' }))
    .toBeEnabled({ timeout: 180_000 })

  const workerEvidence = await page.evaluate(() => {
    const evidence = (window as CollisionWorkerEvidenceWindow)
      .__geometryCollisionWorkerEvidence
    return {
      ...evidence,
      constructedUrls: [...evidence.constructedUrls],
      progressEvents: evidence.progressEvents.map((event) => ({ ...event })),
    }
  })
  expect(workerEvidence.constructedUrls).toHaveLength(1)
  expect(workerEvidence.constructedUrls[0]).toContain(
    'collision-validation.worker',
  )
  expect(
    workerEvidence.progressEvents.map(({ processedSamples }) => processedSamples),
  ).toEqual([250, 500, 750, 1_000])
  expect(
    workerEvidence.progressEvents.every(({ totalSamples }) =>
      totalSamples === 1_000,
    ),
  ).toBe(true)
  const partialWorkerProgress = workerEvidence.progressEvents.filter(
    ({ processedSamples, totalSamples }) => processedSamples < totalSamples,
  )
  expect(partialWorkerProgress).toHaveLength(3)
  expect(
    partialWorkerProgress.at(-1)!.rafFrames -
      partialWorkerProgress[0]!.rafFrames,
  ).toBeGreaterThan(5)
  expect(workerEvidence.rafFrames - rafFramesBeforeValidation)
    .toBeGreaterThan(10)
  expect(workerEvidence.inFlightFrames).toBeGreaterThan(10)
  expect(workerEvidence.partialProgressFrames).toBeGreaterThan(10)

  const sequenceReport = await downloadJsonReport(page)
  const heldWorkerFindings = sequenceReport.findings.filter(
    ({ pairKey, sampleIndex, timeMs }) =>
      pairKey === HELD_WORKER_PAIR && sampleIndex !== null && timeMs !== null,
  )
  expect(heldWorkerFindings.length).toBeGreaterThan(0)
  const heldWorkerOutOfWindow = heldWorkerFindings.filter(
    ({ sampleIndex, timeMs }) =>
      sampleIndex === null || sampleIndex <= 400 || sampleIndex >= 600 ||
      timeMs === null || timeMs <= 1_200 || timeMs >= 1_600,
  )
  expect(
    heldWorkerOutOfWindow,
    `Held/static sequence findings escaped the middle window: ${JSON.stringify(
      heldWorkerOutOfWindow.slice(0, 10),
    )}`,
  ).toHaveLength(0)
  expect(heldWorkerFindings.every(({ firstBoxId, secondBoxId }) =>
    firstBoxId.startsWith('worker-') && secondBoxId.startsWith('worker-'),
  )).toBe(true)
  const heldSequenceFinding = sequenceReport.findings.find(
    ({ firstEntityId, secondEntityId, sampleIndex, timeMs }) =>
      (firstEntityId === FIXTURE_ENTITY_ID || secondEntityId === FIXTURE_ENTITY_ID) &&
      sampleIndex !== null && sampleIndex > 0 &&
      timeMs !== null && timeMs > 0,
  )
  expect(heldSequenceFinding).toEqual(
    expect.objectContaining({
      sampleIndex: expect.any(Number),
      timeMs: expect.any(Number),
    }),
  )
  expect(
    heldSequenceFinding?.firstEntityId === FIXTURE_ENTITY_ID
      ? heldSequenceFinding.firstBoxId
      : heldSequenceFinding?.secondBoxId,
  ).toMatch(/^worker-/)
  expect(sequenceReport.summary.totalFindings).toBeGreaterThan(0)
  expect(sequenceReport.summary.truncated).toBe(false)
})
