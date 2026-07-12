import { expect, test } from '@playwright/test'

interface SemanticProject {
  projectId: string
  robotName: string
  linkFiles: string[]
  linkBytes: number[]
  objectAssetCount: number
  objectInstanceCount: number
  poseCount: number
  mcpPosition: number[]
  tcpPosition: number[]
  basePosition: number[]
}

async function semanticProject(page: import('@playwright/test').Page) {
  return page.evaluate(async (): Promise<SemanticProject> => {
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
    if (snapshot === undefined) throw new Error('Active project was not persisted.')
    return {
      projectId: snapshot.manifest.projectId,
      robotName: snapshot.robot.name,
      linkFiles: snapshot.robot.links.map((link: any) => link.sourceFileName),
      linkBytes: snapshot.robot.links.map((link: any) => link.sourceBytes.byteLength),
      objectAssetCount: snapshot.objectAssets.length,
      objectInstanceCount: snapshot.objectInstances.length,
      poseCount: snapshot.poses.length,
      mcpPosition: snapshot.frames.mcp.position,
      tcpPosition: snapshot.frames.tcp.position,
      basePosition: snapshot.robot.basePosition,
    }
  })
}

test('exports and restores the complete default workcell project', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toHaveAttribute(
    'aria-busy',
    'false',
  )

  await page.getByRole('button', { name: 'Coordinate Frames' }).click()
  await page.getByLabel('Position X (mm)').fill('125')
  await page.getByRole('button', { name: 'Apply frame' }).click()
  await page.getByLabel('Coordinate frame', { exact: true }).selectOption('base')
  await page.getByLabel('Position Y (mm)').fill('-80')
  await page.getByRole('button', { name: 'Apply frame' }).click()
  await page.getByLabel('Coordinate frame', { exact: true }).selectOption('tcp')
  await page.getByLabel('Position Z (mm)').fill('65')
  await page.getByRole('button', { name: 'Apply frame' }).click()
  await page.getByRole('button', { name: 'Close Coordinate Frames' }).click()

  await page.getByRole('button', { name: 'Save project' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const before = await semanticProject(page)
  expect(before.linkFiles).toHaveLength(7)
  expect(before.linkBytes.every((byteLength) => byteLength > 0)).toBe(true)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export project' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Untitled Workcell.wdtwin')
  const archivePath = await download.path()
  expect(archivePath).not.toBeNull()

  await page.evaluate(async () => {
    localStorage.clear()
    const databases = await indexedDB.databases()
    await Promise.all(databases.flatMap(({ name }) => {
      if (name === undefined) return []
      return [new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const stores = Array.from(database.objectStoreNames)
          if (stores.length === 0) {
            database.close()
            resolve()
            return
          }
          const transaction = database.transaction(stores, 'readwrite')
          stores.forEach((store) => transaction.objectStore(store).clear())
          transaction.oncomplete = () => {
            database.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })]
    }))
  })
  await page.reload()
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible()
  await page.getByLabel('Import project').setInputFiles(archivePath!)
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })

  expect(await semanticProject(page)).toEqual(before)

  await page.getByRole('button', { name: 'Coordinate Frames' }).click()
  await page.getByLabel('Coordinate frame', { exact: true }).selectOption('mcp')
  await expect(page.getByLabel('Position X (mm)')).toHaveValue('125')
  await page.getByLabel('Coordinate frame', { exact: true }).selectOption('base')
  await expect(page.getByLabel('Position Y (mm)')).toHaveValue('-80')
  await page.getByLabel('Coordinate frame', { exact: true }).selectOption('tcp')
  await expect(page.getByLabel('Position Z (mm)')).toHaveValue('65')
})
