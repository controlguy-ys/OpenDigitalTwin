import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync, zipSync } from 'fflate'

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const FIXTURE_ENTITY_ID = 'object:collision-fixture'
const LINK00_PAIR = `${FIXTURE_ENTITY_ID}|robot-link:LINK00`

interface CollisionReportRow {
  kind: 'collision' | 'near-miss'
  pairKey: string
  firstEntityId: string
  secondEntityId: string
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

interface ProjectSemantics {
  schemaVersion: number
  name: string
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

function legacyCollisionFixture(source: Uint8Array): Buffer {
  const entries = unzipSync(source)
  const manifest = jsonEntry<Record<string, unknown>>(entries, 'manifest.json')
  const links = jsonEntry<Record<string, unknown>[]>(
    entries,
    'robot/links/index.json',
  )
  const sourceLink = links[0]
  if (sourceLink === undefined) throw new Error('Default Robot has no Link source.')
  const sourcePath = String(sourceLink.archivePath)
  const sourceBytes = entries[sourcePath]
  if (sourceBytes === undefined) throw new Error(`Missing source STEP: ${sourcePath}`)

  putJson(entries, 'manifest.json', {
    ...manifest,
    schemaVersion: 1,
    projectId: 'geometry-collision-acceptance',
    name: 'Geometry Collision Acceptance',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  })
  putJson(
    entries,
    'robot/links/index.json',
    links.map(({ collisionBoxes: _collisionBoxes, ...link }) => link),
  )

  const objectStepPath = 'objects/assets/0000.step'
  entries[objectStepPath] = sourceBytes.slice()
  putJson(entries, 'objects/assets.json', [{
    id: 'collision-fixture-asset',
    name: 'Collision Fixture Asset',
    sourceFileName: 'collision-fixture.step',
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.02, 0.02, 0.02],
    statistics: sourceLink.statistics,
    archivePath: objectStepPath,
  }])
  putJson(entries, 'objects/instances.json', [{
    id: 'collision-fixture',
    assetId: 'collision-fixture-asset',
    name: 'Collision Fixture',
    transform: {
      position: [0, 0, 1.15],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    numericStatus: 7,
    statusSource: 'manual',
    statusOverlayVisible: true,
    visible: true,
  }])
  putJson(entries, 'poses/sequences.json', [
    {
      id: 'pose-home',
      name: 'Home',
      anglesDeg: [0, 0, 0, 0, 0, 0],
      durationMs: 1_000,
      easing: 'linear',
      speedPercentToNext: 100,
    },
    {
      id: 'pose-cup',
      name: 'Cup Pick',
      anglesDeg: [184.8, -63.6, -205.2, -152, -22.1, -144.2],
      durationMs: 1_000,
      easing: 'linear',
      speedPercentToNext: 100,
    },
  ])
  delete entries['collision/policy.json']

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

async function openDrawer(page: Page, name: string): Promise<void> {
  await page.evaluate((label) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.getAttribute('aria-label') === label)
    if (button === undefined) throw new Error(`Missing drawer control: ${label}`)
    if (button.getAttribute('aria-expanded') !== 'true') button.click()
  }, name)
}

async function activeProjectSemantics(page: Page): Promise<ProjectSemantics> {
  return page.evaluate(async () => {
    const snapshot = await new Promise<any>((resolve, reject) => {
      const request = indexedDB.open('robot-sim-project')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('projects', 'readonly')
        const get = transaction.objectStore('projects').get('active')
        get.onerror = () => reject(get.error)
        get.onsuccess = () => {
          database.close()
          resolve(get.result?.snapshot)
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
    return {
      schemaVersion: snapshot.manifest.schemaVersion,
      name: snapshot.manifest.name,
      objectTransform: instance.transform,
      objectCollisionBoxes: asset.collisionBoxes,
      poseAngles: snapshot.poses.map(({ anglesDeg }: { anglesDeg: number[] }) =>
        anglesDeg,
      ),
      collisionPolicy: snapshot.collisionPolicy,
    }
  })
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

test('accepts geometry collision, migration, reports, round-trip, and held sequence workflows', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  const [defaultDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  const fixture = legacyCollisionFixture(
    await readFile(await downloadPath(defaultDownload)),
  )
  await page.getByLabel('Import project').setInputFiles({
    name: 'geometry-collision-v1.wdtwin',
    mimeType: 'application/zip',
    buffer: fixture,
  })
  await expect(page.getByText('Geometry Collision Acceptance', { exact: true }))
    .toBeVisible({ timeout: 180_000 })

  const migrated = await activeProjectSemantics(page)
  expect(migrated).toMatchObject({
    schemaVersion: 2,
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

  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const beforeRoundTrip = await activeProjectSemantics(page)
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  expect(projectDownload.suggestedFilename()).toBe(
    'Geometry Collision Acceptance.wdtwin',
  )
  await downloadPath(projectDownload)

  await page.reload()
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 180_000 },
  )
  await openDrawer(page, 'Timeline and Events sheet')
  await expect(page.getByLabel('Live collision counts')).toContainText(
    /Near-miss [1-9]/,
  )
  const reloadedRow = (await downloadJsonReport(page)).findings.find(
    ({ kind, pairKey }) => kind === 'near-miss' && pairKey === LINK00_PAIR,
  )
  expect(reloadedRow).toEqual(restoredRow)
  expect(await activeProjectSemantics(page)).toEqual(beforeRoundTrip)

  await selectCollisionFixture(page)
  await applyFixturePosition(page, [725, 0, 2_315])
  await page.getByRole('button', { name: 'Save project' }).click()
  await page.reload()
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 180_000 },
  )
  await openDrawer(page, 'Inspector drawer')
  await expect(page.getByRole('spinbutton', { name: 'J1' })).toHaveValue('0')
  await page.getByRole('button', { name: 'Close Gripper' }).click()
  await openDrawer(page, 'Timeline and Events sheet')
  await page.getByRole('button', { name: 'Validate Sequence' }).click()
  await expect(page.getByRole('button', { name: 'Validate Sequence' }))
    .toBeEnabled({ timeout: 180_000 })

  const sequenceReport = await downloadJsonReport(page)
  expect(sequenceReport.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        firstEntityId: FIXTURE_ENTITY_ID,
        sampleIndex: expect.any(Number),
        timeMs: expect.any(Number),
      }),
    ]),
  )
  expect(sequenceReport.summary.totalFindings).toBeGreaterThan(0)
  expect(sequenceReport.summary.truncated).toBe(false)
})
