import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync, zipSync } from 'fflate'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

type ProjectSnapshot = {
  manifest: { name: string }
  robot: { sources: Array<{ sha256: string }>; links: Array<Record<string, unknown>> }
  scene: {
    robotMountContact: { baseLinkId: string; mountSurfaceCollisionEntityId: string | null }
    entities: Array<Record<string, any>>
  }
  objectAssets: Array<Record<string, unknown>>
  objectInstances: Array<Record<string, unknown>>
  simulation: {
    activeJobId: string | null
    jobs: Array<{ id: string; poses: Array<Record<string, unknown>> }>
  }
  opcUa: Record<string, any>
  collisionPolicy: Record<string, unknown>
}

function jsonEntry<T>(entries: Record<string, Uint8Array>, path: string): T {
  const bytes = entries[path]
  if (bytes === undefined) throw new Error(`Missing archive entry: ${path}`)
  return JSON.parse(decoder.decode(bytes)) as T
}

function putJson(
  entries: Record<string, Uint8Array>,
  path: string,
  value: unknown,
): void {
  entries[path] = encoder.encode(JSON.stringify(value, null, 2))
}

function canonicalDurationMs(
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
      1_000 * 100 / speedPercentToNext))
}

async function downloadPath(download: Download): Promise<string> {
  const path = await download.path()
  if (path === null) throw new Error('Playwright did not retain the download.')
  return path
}

async function exportProject(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export project' }).click(),
  ])
  return readFile(await downloadPath(download))
}

function reusableWorkcellFixture(source: Uint8Array): Buffer {
  const entries = unzipSync(source)
  const manifest = jsonEntry<Record<string, unknown>>(entries, 'manifest.json')
  const sources = jsonEntry<Array<Record<string, unknown>>>(
    entries,
    'robot/sources/index.json',
  )
  const links = jsonEntry<Array<Record<string, any>>>(entries, 'robot/links/index.json')
  const scene = jsonEntry<Record<string, any>>(entries, 'scene/state.json')
  const opcUa = jsonEntry<Record<string, any>>(entries, 'opcua/bindings.json')
  const sourceRecord = sources[0]
  const sourceLink = links[0]
  if (sourceRecord === undefined || sourceLink === undefined) {
    throw new Error('Default project has no Robot source to reuse as a deterministic Object fixture.')
  }
  const digest = String(sourceRecord.sha256)
  const sourcePath = `robot/sources/${digest}.step`
  const sourceBytes = entries[sourcePath]
  if (sourceBytes === undefined) throw new Error(`Missing Robot source ${sourcePath}`)
  entries[`objects/assets/${digest}.step`] = sourceBytes.slice()

  putJson(entries, 'manifest.json', {
    ...manifest,
    projectId: 'reusable-scene-acceptance',
    name: 'Reusable Scene Acceptance',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  })
  putJson(entries, 'objects/assets.json', [{
    id: 'asset-cup',
    name: 'Cup Asset',
    sourceKind: 'step',
    sourceFileName: 'cup.step',
    sourceSha256: digest,
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.04, 0.04, 0.08],
    collisionBoxes: [{
      id: 'cup-body',
      center: [0, 0, 0],
      halfExtents: [0.04, 0.04, 0.08],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: sourceLink.statistics,
  }])
  putJson(entries, 'objects/instances.json', [{
    id: 'cup',
    assetId: 'asset-cup',
    name: 'Cup',
    manualNumericStatus: 17,
    statusSource: 'manual',
    statusOverlayVisible: true,
    scale: [1, 1, 1],
    graspable: false,
  }])

  const robot = (scene.entities as Array<Record<string, any>>).find(
    ({ kind }) => kind === 'robot',
  )
  if (robot === undefined) throw new Error('Default project has no Robot Scene Entity.')
  const robotWorldPosition = robot.localPose.positionM as [number, number, number]
  const axisPositionM = 0.5
  putJson(entries, 'scene/state.json', {
    ...scene,
    robotMountContact: {
      baseLinkId: 'LINK00',
      mountSurfaceCollisionEntityId: 'workcell:workbench',
    },
    entities: [
      {
        kind: 'linear-axis',
        id: 'linear-axis:active',
        name: 'Robot Track',
        parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        visible: true,
        direction: 'x',
        minPositionM: 0,
        maxPositionM: 1,
        homePositionM: 0,
        currentPositionM: axisPositionM,
        carriageEntityId: null,
        robotEntityId: 'robot:active',
      },
      {
        ...robot,
        parentId: 'linear-axis:active',
        localPose: {
          ...robot.localPose,
          positionM: [
            robotWorldPosition[0] - axisPositionM,
            robotWorldPosition[1],
            robotWorldPosition[2],
          ],
        },
      },
      {
        kind: 'group',
        id: 'group:fixture-a',
        name: 'Fixture A',
        parentId: null,
        localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
        visible: true,
      },
      {
        kind: 'object',
        id: 'object:cup',
        name: 'Cup',
        parentId: null,
        localPose: {
          positionM: [0.4, 0.2, 0.1],
          quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        },
        visible: true,
        target: { kind: 'object-instance', id: 'cup' },
        transformSource: 'opcua',
      },
    ],
  })
  const angles = [[0, 0, 0, 0, 0, 0], [5, 3, 0, 0, 0, 0], [10, 6, 0, 0, 0, 0]]
  const speeds = [25, 60, 20]
  putJson(entries, 'simulation/jobs.json', {
    activeJobId: 'job-pick',
    jobs: [{
      id: 'job-pick',
      name: 'Pick Cycle',
      revision: 1,
      poses: speeds.map((speedPercentToNext, index) => ({
        id: `pose-${index + 1}`,
        name: `Pose ${index + 1}`,
        anglesDeg: angles[index],
        durationMs: index === angles.length - 1
          ? 1_000
          : canonicalDurationMs(
              entries,
              angles[index]!,
              angles[index + 1]!,
              speedPercentToNext,
            ),
        easing: 'linear',
        speedPercentToNext,
      })),
    }],
  })
  putJson(entries, 'opcua/bindings.json', {
    ...opcUa,
    equipmentTransforms: [{
      entityId: 'object:cup',
      gatewayId: 'gateway-1',
      gatewayProfileId: 'profile-1',
      gatewayProfileRevision: 'b'.repeat(64),
      mode: 'absolute',
      referenceFrameId: 'mcp',
      smoothing: { mode: 'two-cycle', cycles: 2 },
    }],
  })

  return Buffer.from(zipSync(
    Object.fromEntries(Object.entries(entries).sort(([left], [right]) =>
      left.localeCompare(right))),
    { level: 6 },
  ))
}

async function snapshot(page: Page): Promise<ProjectSnapshot> {
  const text = await page.getByTestId('project-semantic-diagnostic').textContent()
  if (text === null || text === 'null') throw new Error('Project diagnostic is unavailable.')
  return JSON.parse(text) as ProjectSnapshot
}

async function waitForProject(page: Page, name: string): Promise<void> {
  await expect(page.getByLabel('Project controls')).toContainText(name, {
    timeout: 180_000,
  })
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 180_000 },
  )
}

function entity(project: ProjectSnapshot, id: string): Record<string, any> {
  const match = project.scene.entities.find((candidate) => candidate.id === id)
  if (match === undefined) throw new Error(`Missing Scene Entity ${id}`)
  return match
}

function worldPosition(project: ProjectSnapshot, id: string): number[] {
  const current = entity(project, id)
  const local = [...current.localPose.positionM] as number[]
  if (current.parentId === null) return local
  const parent = entity(project, current.parentId)
  const parentWorld = worldPosition(project, parent.id)
  const axisOffset = parent.kind === 'linear-axis'
    ? parent.direction === 'x'
      ? [parent.currentPositionM, 0, 0]
      : parent.direction === 'y'
        ? [0, parent.currentPositionM, 0]
        : [0, 0, parent.currentPositionM]
    : [0, 0, 0]
  return local.map((value, index) => value + parentWorld[index]! + axisOffset[index]!)
}

async function openDrawer(page: Page, label: string): Promise<void> {
  const control = page.getByRole('button', { name: label })
  if (await control.count() === 0) return
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click()
}

async function openTimeline(page: Page): Promise<void> {
  await openDrawer(page, 'Timeline and Events sheet')
  const tab = page.getByRole('tab', { name: 'Timeline', exact: true })
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click()
}

function installDeterministicStepWorker(page: Page): Promise<void> {
  return page.addInitScript(() => {
    const NativeWorker = window.Worker
    const result = {
      success: true as const,
      root: { name: 'root', meshes: [0], children: [] },
      meshes: [{
        name: 'deterministic-fixture',
        color: [0.5, 0.5, 0.5],
        brep_faces: [],
        attributes: {
          position: { array: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0.1] },
        },
        index: { array: [0, 1, 2] },
      }],
    }
    class StepWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: ((event: MessageEvent) => void) | null = null
      postMessage() {
        queueMicrotask(() => this.onmessage?.({
          data: { kind: 'success', result },
        } as MessageEvent))
      }
      terminate() {}
    }
    function WorkerProxy(this: unknown, url: string | URL, options?: WorkerOptions) {
      if (String(url).includes('step-import.worker')) return new StepWorker()
      return new NativeWorker(url, options)
    }
    WorkerProxy.prototype = NativeWorker.prototype
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      writable: true,
      value: WorkerProxy,
    })
  })
}

test('builds, saves, reloads, and edits a reusable workcell', async ({ page }) => {
  test.setTimeout(300_000)
  await installDeterministicStepWorker(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const fixture = reusableWorkcellFixture(await exportProject(page))
  await page.getByLabel('Import project').setInputFiles({
    name: 'reusable-scene.wdtwin',
    mimeType: 'application/zip',
    buffer: fixture,
  })
  await waitForProject(page, 'Reusable Scene Acceptance')
  await openDrawer(page, 'Scene Assets drawer')
  await openDrawer(page, 'Inspector drawer')

  await expect(page.getByRole('button', { name: '+ New Job' })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: 'Pick Cycle, 3 Poses' }))
    .toHaveAttribute('aria-selected', 'true')
  await openTimeline(page)
  await expect(page.getByRole('list', { name: 'Timeline' })).toBeVisible()
  for (const [index, speed] of [25, 60, 20].entries()) {
    await expect(page.getByLabel(`Pose ${index + 1} speed to next pose`))
      .toHaveValue(String(speed))
  }
  const jointOneInput = page.getByRole('spinbutton', { name: 'J1' })
  await expect(jointOneInput).toBeVisible()
  const jointBeforeHome = await page.getByTestId('robot-joint-diagnostic').textContent()

  const cupTreeItem = page.getByRole('treeitem', { name: 'Cup', exact: true })
  await cupTreeItem.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move to group' }).click()
  await expect(page.getByRole('dialog', { name: 'Switch transform source?' })).toBeVisible()
  expect(entity(await snapshot(page), 'object:cup')).toMatchObject({
    parentId: null,
    transformSource: 'opcua',
  })
  await page.getByRole('button', { name: 'Switch to Manual' }).click({ timeout: 15_000 })
  await expect.poll(async () => entity(await snapshot(page), 'object:cup').transformSource)
    .toBe('manual')
  expect(entity(await snapshot(page), 'object:cup').parentId).toBeNull()
  const beforeGroupWorld = worldPosition(await snapshot(page), 'object:cup')
  await page.getByRole('button', { name: 'Move to Fixture A' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'object:cup').parentId)
    .toBe('group:fixture-a')
  expect(worldPosition(await snapshot(page), 'object:cup')).toEqual(beforeGroupWorld)

  await page.getByRole('button', { name: 'Select Cup' }).click()
  await expect(page.getByText('Relative to: Fixture A')).toBeVisible()
  await page.getByLabel('Local X (mm)').fill('450')
  await page.getByLabel('Local Y (mm)').fill('200')
  await page.getByLabel('Local Z (mm)').fill('100')
  await page.getByLabel('Roll (deg)', { exact: true }).fill('0')
  await page.getByLabel('Pitch (deg)', { exact: true }).fill('0')
  await page.getByLabel('Yaw (deg)', { exact: true }).fill('90')
  await page.getByRole('button', { name: 'Apply transform' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'object:cup').localPose.positionM[0])
    .toBeCloseTo(0.45)

  await page.getByRole('button', { name: 'Select Robot Track' }).click()
  const mountedWorld = worldPosition(await snapshot(page), 'robot:active')
  await page.getByRole('button', { name: 'Detach Robot' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'robot:active').parentId).toBeNull()
  expect(worldPosition(await snapshot(page), 'robot:active')).toEqual(mountedWorld)
  await page.getByRole('button', { name: 'Attach Robot' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'robot:active').parentId)
    .toBe('linear-axis:active')
  expect(worldPosition(await snapshot(page), 'robot:active')).toEqual(mountedWorld)

  const semanticsBeforeHome = JSON.stringify(await snapshot(page))
  await page.getByRole('button', { name: 'Home View' }).click()
  expect(JSON.stringify(await snapshot(page))).toBe(semanticsBeforeHome)
  expect(await page.getByTestId('robot-joint-diagnostic').textContent()).toBe(jointBeforeHome)

  const fixtureGroupRow = page.locator(
    '[data-scene-entity-id="group:fixture-a"] > .scene-tree-row',
  )
  await fixtureGroupRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Isolate' }).click()
  await expect(page.getByTestId('scene-editor-diagnostic')).toHaveText('group:fixture-a')
  await page.getByRole('button', { name: 'Hide Fixture A' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'group:fixture-a').visible).toBe(false)

  const projectBeforeTheme = JSON.stringify(await snapshot(page))
  await page.getByLabel('Theme').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(JSON.stringify(await snapshot(page))).toBe(projectBeforeTheme)
  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await exportProject(page)

  await page.reload()
  await waitForProject(page, 'Reusable Scene Acceptance')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTestId('scene-editor-diagnostic')).toHaveText('null')
  expect(entity(await snapshot(page), 'group:fixture-a')).toMatchObject({ visible: false })
  expect(entity(await snapshot(page), 'object:cup')).toMatchObject({
    parentId: 'group:fixture-a',
    transformSource: 'manual',
    localPose: { positionM: [0.45, 0.2, 0.1] },
  })
  expect((await snapshot(page)).simulation.jobs[0]!.poses.map(
    (pose) => pose.speedPercentToNext,
  )).toEqual([25, 60, 20])
  expect((await snapshot(page)).scene.robotMountContact).toEqual({
    baseLinkId: 'LINK00',
    mountSurfaceCollisionEntityId: 'workcell:workbench',
  })

  const scroll = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }))
  expect(scroll).toEqual({ horizontal: false, vertical: false })
  await expect(page.getByRole('region', { name: 'Scene Objects' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Robot Jobs' })).toBeVisible()

  await openDrawer(page, 'Scene Assets drawer')
  const beforeUngroupWorld = worldPosition(await snapshot(page), 'object:cup')
  await fixtureGroupRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ungroup' }).click()
  await page.getByRole('button', { name: 'Ungroup Children' }).click()
  await expect.poll(async () => entity(await snapshot(page), 'object:cup').parentId).toBeNull()
  expect(worldPosition(await snapshot(page), 'object:cup')).toEqual(beforeUngroupWorld)
})
