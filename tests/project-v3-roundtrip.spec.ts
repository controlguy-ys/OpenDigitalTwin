import { expect, test, type Page } from '@playwright/test'

interface DurableV3ProjectSummary {
  pointerState: string
  commitToken: string
  revisionId: string
  schemaVersion: number
  projectId: string
  projectName: string
  sourceCount: number
  linkCount: number
  sourceProjectionIsByteFree: boolean
  sourceBlobCount: number
  sourceBlobBytes: number[]
  revisionProjection: unknown
  sourceBlobs: readonly {
    key: string
    namespace: string
    sha256: string
    byteLength: number
    contentSha256: string
  }[]
}

async function durableV3Project(page: Page): Promise<DurableV3ProjectSummary> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('robot-sim-project')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
    try {
      const transaction = database.transaction(
        ['projectPointers', 'projectRevisions', 'projectSourceBlobs'],
        'readonly',
      )
      const request = <Value>(value: IDBRequest<Value>) => new Promise<Value>((resolve, reject) => {
        value.onerror = () => reject(value.error)
        value.onsuccess = () => resolve(value.result)
      })
      const pointer = await request<any>(
        transaction.objectStore('projectPointers').get('active'),
      )
      if (pointer === undefined) throw new Error('Active V3 pointer was not persisted.')
      const revision = await request<any>(
        transaction.objectStore('projectRevisions').get(pointer.revisionId),
      )
      if (revision === undefined) throw new Error('Active V3 revision was not persisted.')
      const sourceBlobKeys = await request<IDBValidKey[]>(
        transaction.objectStore('projectSourceBlobs').getAllKeys(),
      )
      const sourceBlobs: {
        key: string
        namespace: string
        sha256: string
        byteLength: number
        contentSha256: string
      }[] = []
      for (const sourceBlobKey of sourceBlobKeys) {
        const sourceTransaction = database.transaction('projectSourceBlobs', 'readonly')
        const sourceBlob = await request<any>(
          sourceTransaction.objectStore('projectSourceBlobs').get(sourceBlobKey),
        )
        if (sourceBlob === undefined) {
          throw new Error(`Source Blob ${String(sourceBlobKey)} was not persisted.`)
        }
        const digest = await crypto.subtle.digest('SHA-256', sourceBlob.sourceBytes)
        sourceBlobs.push({
          key: sourceBlob.key,
          namespace: sourceBlob.namespace,
          sha256: sourceBlob.sha256,
          byteLength: sourceBlob.byteLength,
          contentSha256: Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0')).join(''),
        })
      }
      sourceBlobs.sort((left, right) => left.key.localeCompare(right.key))
      return {
        pointerState: pointer.state,
        commitToken: pointer.commitToken,
        revisionId: revision.revisionId,
        schemaVersion: revision.snapshot.manifest.schemaVersion,
        projectId: revision.snapshot.manifest.projectId,
        projectName: revision.snapshot.manifest.name,
        sourceCount: revision.snapshot.robot.sources.length,
        linkCount: revision.snapshot.robot.links.length,
        sourceProjectionIsByteFree: revision.snapshot.robot.sources.every(
          (source: Record<string, unknown>) => !('sourceBytes' in source),
        ),
        revisionProjection: revision.snapshot,
        sourceBlobCount: sourceBlobs.length,
        sourceBlobBytes: sourceBlobs.map((blob) => blob.byteLength).sort((a, b) => a - b),
        sourceBlobs,
      }
    } finally {
      database.close()
    }
  })
}

test('New, Save, Export, Import, and reload preserve one byte-free V3 revision', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'New' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()

  const before = await durableV3Project(page)
  expect(before).toMatchObject({
    pointerState: 'stable',
    schemaVersion: 3,
    projectName: 'Untitled Workcell',
    sourceCount: 7,
    linkCount: 7,
    sourceProjectionIsByteFree: true,
    sourceBlobCount: 7,
  })
  expect(before.sourceBlobBytes.every((byteLength) => byteLength > 0)).toBe(true)
  expect(before.revisionProjection).toBeDefined()
  expect(before.sourceBlobs).toHaveLength(7)
  for (const sourceBlob of before.sourceBlobs) {
    expect(sourceBlob.key).toBe(`${sourceBlob.namespace}:${sourceBlob.sha256}`)
    expect(sourceBlob.byteLength).toBeGreaterThan(0)
    expect(sourceBlob.contentSha256).toBe(sourceBlob.sha256)
  }

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export project' }).click()
  const archive = await downloadPromise
  expect(archive.suggestedFilename()).toBe('Untitled Workcell.wdtwin')
  const archivePath = await archive.path()
  expect(archivePath).not.toBeNull()

  await page.getByLabel('Import project').setInputFiles(archivePath!)
  await expect(page.getByText('Working…', { exact: true })).toBeVisible()
  await expect.poll(
    async () => {
      const current = await durableV3Project(page)
      return current.commitToken === before.commitToken
        ? 'unchanged'
        : current.pointerState
    },
    { timeout: 180_000 },
  ).toBe('stable')
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })

  const imported = await durableV3Project(page)
  expect(imported.revisionProjection).toEqual(before.revisionProjection)
  expect(imported.sourceBlobs).toEqual(before.sourceBlobs)
  expect(imported).toEqual({ ...before, commitToken: imported.commitToken })

  await page.reload()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  const reloaded = await durableV3Project(page)
  expect(reloaded.revisionProjection).toEqual(imported.revisionProjection)
  expect(reloaded.sourceBlobs).toEqual(imported.sourceBlobs)
  expect(reloaded).toEqual(imported)
})
