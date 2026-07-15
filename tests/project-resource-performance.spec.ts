import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'
import { unzipSync, zipSync } from 'fflate'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

type RevisionSummary = {
  revisionId: string
  instanceCount: number
  stepAssetCount: number
}

function jsonEntry<T>(entries: Record<string, Uint8Array>, path: string): T {
  const bytes = entries[path]
  if (bytes === undefined) throw new Error(`Missing archive entry: ${path}`)
  return JSON.parse(decoder.decode(bytes)) as T
}

function putJson(entries: Record<string, Uint8Array>, path: string, value: unknown): void {
  entries[path] = encoder.encode(JSON.stringify(value, null, 2))
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

function resourceFixture(
  source: Uint8Array,
  options: Readonly<{ name: string; instanceCount: number; stepAssetCount: number }>,
): Buffer {
  const entries = unzipSync(source)
  const manifest = jsonEntry<Record<string, unknown>>(entries, 'manifest.json')
  const robotSources = jsonEntry<Array<Record<string, unknown>>>(
    entries,
    'robot/sources/index.json',
  )
  const scene = jsonEntry<Record<string, any>>(entries, 'scene/state.json')
  const opcUa = jsonEntry<Record<string, any>>(entries, 'opcua/bindings.json')
  const digest = String(robotSources[0]?.sha256)
  const sourceBytes = entries[`robot/sources/${digest}.step`]
  if (sourceBytes === undefined) throw new Error('Default Robot source is unavailable.')
  if (options.stepAssetCount > 0) {
    entries[`objects/assets/${digest}.step`] = sourceBytes.slice()
  }

  putJson(entries, 'manifest.json', {
    ...manifest,
    projectId: options.name.toLowerCase().replaceAll(' ', '-'),
    name: options.name,
    updatedAt: '2026-07-15T00:00:00.000Z',
  })

  const boxAsset = {
    id: 'asset-box',
    name: 'Boundary Box',
    sourceKind: 'box',
    dimensionsM: [0.1, 0.1, 0.1],
    color: '#38BDF8',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.05, 0.05, 0.05],
    collisionBoxes: [{
      id: 'primitive-body', center: [0, 0, 0], halfExtents: [0.05, 0.05, 0.05],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 24, triangles: 12, meshes: 1, materials: 1 },
  }
  const stepAssets = Array.from({ length: options.stepAssetCount }, (_, index) => ({
    id: `asset-step-${index}`,
    name: `STEP ${index}`,
    sourceKind: 'step',
    sourceFileName: `step-${index}.step`,
    sourceSha256: digest,
    importScale: 0.001,
    originMode: 'source',
    colliderCenter: [0, 0, 0],
    collisionHalfExtents: [0.05, 0.05, 0.05],
    collisionBoxes: [{
      id: 'step-body', center: [0, 0, 0], halfExtents: [0.05, 0.05, 0.05],
      quaternion: [0, 0, 0, 1],
    }],
    statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
  }))
  putJson(entries, 'objects/assets.json', [
    ...(options.instanceCount > 0 ? [boxAsset] : []),
    ...stepAssets,
  ])

  const instances = Array.from({ length: options.instanceCount }, (_, index) => ({
    id: `boundary-${index}`,
    assetId: 'asset-box',
    name: `Boundary Object ${index}`,
    manualNumericStatus: 0,
    statusSource: 'manual',
    statusOverlayVisible: false,
    scale: [1, 1, 1],
    graspable: false,
  }))
  putJson(entries, 'objects/instances.json', instances)

  const durableEntities = (scene.entities as Array<Record<string, any>>).filter(
    ({ target }) => target?.kind !== 'object-instance',
  )
  putJson(entries, 'scene/state.json', {
    ...scene,
    entities: [
      ...durableEntities,
      ...instances.map((instance, index) => ({
        kind: 'object',
        id: `object:${instance.id}`,
        name: instance.name,
        parentId: null,
        localPose: {
          positionM: [(index % 16) * 0.02, Math.floor(index / 16) * 0.02, 0],
          quaternion: [0, 0, 0, 1],
        },
        visible: false,
        target: { kind: 'object-instance', id: instance.id },
        transformSource: 'manual',
      })),
    ],
  })
  putJson(entries, 'opcua/bindings.json', {
    ...opcUa,
    numericStatusBindings: (opcUa.numericStatusBindings ?? []).filter(
      ({ entityId }: { entityId: string }) => !entityId.startsWith('object:'),
    ),
    equipmentTransforms: (opcUa.equipmentTransforms ?? []).filter(
      ({ entityId }: { entityId: string }) => !entityId.startsWith('object:'),
    ),
  })

  return Buffer.from(zipSync(
    Object.fromEntries(Object.entries(entries).sort(([left], [right]) =>
      left.localeCompare(right))),
    { level: 6 },
  ))
}

async function activeRevision(page: Page): Promise<RevisionSummary> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('robot-sim-project')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    const request = <Value>(value: IDBRequest<Value>) => new Promise<Value>((resolve, reject) => {
      value.onerror = () => reject(value.error)
      value.onsuccess = () => resolve(value.result)
    })
    try {
      const pointerTransaction = database.transaction('projectPointers', 'readonly')
      const pointer = await request<any>(
        pointerTransaction.objectStore('projectPointers').get('active'),
      )
      const revisionTransaction = database.transaction('projectRevisions', 'readonly')
      const revision = await request<any>(
        revisionTransaction.objectStore('projectRevisions').get(pointer.revisionId),
      )
      return {
        revisionId: revision.revisionId,
        instanceCount: revision.snapshot.objectInstances.length,
        stepAssetCount: revision.snapshot.objectAssets.filter(
          ({ sourceKind }: { sourceKind: string }) => sourceKind === 'step',
        ).length,
      }
    } finally {
      database.close()
    }
  })
}

async function importFixture(
  page: Page,
  options: Readonly<{ name: string; instanceCount: number; stepAssetCount: number }>,
): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy', 'false',
  )
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const fixture = resourceFixture(await exportProject(page), options)
  await page.getByLabel('Import project').setInputFiles({
    name: 'resource-boundary.wdtwin', mimeType: 'application/zip', buffer: fixture,
  })
  await expect(page.getByLabel('Project controls')).toContainText(options.name, {
    timeout: 180_000,
  })
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy', 'false', { timeout: 180_000 },
  )
}

function installStepWorkerProbe(page: Page): Promise<void> {
  return page.addInitScript(() => {
    ;(window as any).__stepParseRequests = 0
    const NativeWorker = window.Worker
    const result = {
      success: true as const,
      root: { name: 'root', meshes: [0], children: [] },
      meshes: [{
        name: 'resource-fixture', color: [0.5, 0.5, 0.5], brep_faces: [],
        attributes: { position: { array: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0.1] } },
        index: { array: [0, 1, 2] },
      }],
    }
    class StepWorker {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      onmessageerror: ((event: MessageEvent) => void) | null = null
      postMessage() {
        ;(window as any).__stepParseRequests += 1
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
      configurable: true, writable: true, value: WorkerProxy,
    })
  })
}

test('emits non-blocking 80 percent warnings for Instances and STEP Assets', async ({ page }) => {
  test.setTimeout(300_000)
  await installStepWorkerProbe(page)
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  await importFixture(page, {
    name: 'Resource Warning', instanceCount: 204, stepAssetCount: 51,
  })
  const parseRequestsBeforeImport = await page.evaluate(
    () => (window as any).__stepParseRequests as number,
  )

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Box' }).click()
  await expect.poll(async () => (await activeRevision(page)).instanceCount).toBe(205)
  expect(warnings).toContain('OBJECT_INSTANCE_WARNING: 205 of 256')

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import STEP' }).click()
  await page.getByLabel('STEP file').setInputFiles({
    name: 'warning.step',
    mimeType: 'application/step',
    buffer: Buffer.from('ISO-10303-21;\nSI_UNIT(.MILLI.,.METRE.);\nEND-ISO-10303-21;'),
  })
  await expect(page.getByRole('button', { name: 'Add to scene' })).toBeEnabled()
  await page.getByRole('button', { name: 'Add to scene' }).click()
  await expect.poll(async () => (await activeRevision(page)).stepAssetCount).toBe(52)
  expect(warnings).toContain('STEP_ASSET_WARNING: 52 of 64')
  expect(await page.evaluate(() => (window as any).__stepParseRequests))
    .toBeGreaterThan(parseRequestsBeforeImport)
})

test('blocks a 65th STEP Asset before parsing or revising the project', async ({ page }) => {
  test.setTimeout(300_000)
  await installStepWorkerProbe(page)
  await importFixture(page, {
    name: 'STEP Boundary', instanceCount: 0, stepAssetCount: 64,
  })
  const before = await activeRevision(page)
  const parseRequestsBeforeDialog = await page.evaluate(
    () => (window as any).__stepParseRequests as number,
  )

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import STEP' }).click()
  await expect(page.getByLabel('STEP file')).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('STEP Asset limit reached: 64 of 64')
  expect(await page.evaluate(() => (window as any).__stepParseRequests))
    .toBe(parseRequestsBeforeDialog)
  expect(await activeRevision(page)).toEqual(before)
})
