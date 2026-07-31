import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function invokeMenuCommand(
  page: Page,
  menuName: 'Project' | 'Connectivity',
  commandName: string,
): Promise<void> {
  await page.getByRole('menuitem', { name: menuName, exact: true }).click()
  const menu = page.getByRole('menu', { name: `${menuName} menu` })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: commandName, exact: true }).click()
}

async function resetGateway(request: APIRequestContext): Promise<void> {
  await request.delete('http://127.0.0.1:8081/runtime/project', {
    data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true },
  })
}

async function exportProjectBytes(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await invokeMenuCommand(page, 'Project', 'Export')
  const path = await (await downloadPromise).path()
  if (path === null) throw new Error('Expected the exported Project V5 download.')
  return readFile(path)
}

async function expectProjectV5(page: Page): Promise<void> {
  expect(JSON.parse((await exportProjectBytes(page)).toString('utf8')))
    .toMatchObject({ schemaVersion: 5 })
}

test('boots, persists, and rejects a V4 Project without leaving Project V5', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await expectProjectV5(page)
  await expect(page.getByRole('main')).toBeVisible()
  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeVisible()
  await page.getByRole('dialog', { name: 'OPC UA Settings' })
    .getByRole('button', { name: 'Cancel' })
    .click()
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()
  const projectNameBeforeImport = await page.getByTestId('v6-header-status')
    .locator('.v6-header-status-project')
    .textContent()

  const chooser = page.waitForEvent('filechooser')
  await invokeMenuCommand(page, 'Project', 'Import')
  await (await chooser).setFiles({
    name: 'legacy-v4.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 4, projectId: 'legacy' }), 'utf8'),
  })
  await expect(page.getByRole('alert')).toContainText('PROJECT_SCHEMA_UNSUPPORTED')
  await expect(page.getByTestId('v6-header-status').locator('.v6-header-status-project'))
    .toHaveText(projectNameBeforeImport ?? '')
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()
})

test('applies eight Endpoint profiles atomically and preserves the canonical V5 export across reload', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')

  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await settings.getByRole('button', { name: 'Add Endpoint' }).click()
  await expect(settings.getByLabel('Endpoint profile').locator('option')).toHaveCount(1)
  await settings.getByRole('button', { name: 'Cancel' }).click()
  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  await expect(settings.getByLabel('Endpoint profile').locator('option')).toHaveCount(0)

  const addEndpoint = settings.getByRole('button', { name: 'Add Endpoint' })
  for (let index = 1; index <= 8; index += 1) {
    await addEndpoint.click()
    await settings.getByLabel('Endpoint profile').selectOption(`endpoint-${index}`)
    await settings.getByLabel('Endpoint name').fill(`PLC ${index}`)
  }
  await expect(settings.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await expect(addEndpoint).toBeDisabled()

  await settings.getByLabel('Endpoint profile').selectOption('endpoint-1')
  await settings.getByLabel('Endpoint name').fill('')
  await settings.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(page.getByRole('alert')).toContainText('UTF-8 length')
  await expect(settings).toBeVisible()

  await settings.getByLabel('Endpoint name').fill('PLC 1')
  await settings.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(settings).toBeHidden()

  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  await expect(settings.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await expect(settings.getByLabel('Listener port')).toHaveValue('4841')
  await expect(settings.getByLabel('Listener port')).toHaveAttribute('readonly')
  await settings.getByRole('button', { name: 'Cancel' }).click()

  const downloadPromise = page.waitForEvent('download')
  await invokeMenuCommand(page, 'Project', 'Export')
  const download = await downloadPromise
  const exportedPath = await download.path()
  expect(exportedPath).not.toBeNull()
  const exportedBytes = await readFile(exportedPath!)

  const chooser = page.waitForEvent('filechooser')
  await invokeMenuCommand(page, 'Project', 'Import')
  await (await chooser).setFiles(exportedPath!)
  await page.reload()
  await expectProjectV5(page)
  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  await expect(settings.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await settings.getByRole('button', { name: 'Cancel' }).click()
  expect(await exportProjectBytes(page)).toEqual(exportedBytes)
})

test('keeps the prior canonical Project when Gateway activation rejects Settings', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  const before = await exportProjectBytes(page)
  let rejectNextActivation = true
  await page.route('**/runtime/project', async (route) => {
    if (route.request().method() === 'PUT' && rejectNextActivation) {
      rejectNextActivation = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'TEST_GATEWAY_ACTIVATION_REJECTED',
          message: 'Injected Gateway activation rejection.',
        }),
      })
      return
    }
    await route.fallback()
  })

  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await settings.getByRole('button', { name: 'Add Endpoint' }).click()
  await settings.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(settings).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Injected Gateway activation rejection')
  await settings.getByRole('button', { name: 'Cancel' }).click()

  expect(await exportProjectBytes(page)).toEqual(before)
  await expect.poll(async () => {
    const status = await request.get('http://127.0.0.1:8081/runtime/status')
    return (await status.json()).project.revisionId
  }).not.toBeNull()
})

test('binds Object and Robot targets by Namespace URI and starts the active V5 Job runtime', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await invokeMenuCommand(page, 'Project', 'Load Demo')
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const expandRobots = tree.getByRole('button', { name: 'Expand Robots' })
  if (await expandRobots.isVisible()) await expandRobots.click()
  await expect(tree.getByRole('treeitem', { name: /^NED2/u })).toBeVisible()
  await invokeMenuCommand(page, 'Connectivity', 'OPC UA Settings')
  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await settings.getByRole('button', { name: 'Add Endpoint' }).click()
  await settings.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(settings).toBeHidden()

  await tree.getByRole('button', { name: 'Expand Objects' }).click()
  await tree.getByRole('treeitem', { name: /^Part/u }).click()
  await page.getByTestId('v6-inspector').getByRole('button', { name: 'Open Binding' }).click()
  let binding = page.getByRole('dialog', { name: 'OPC UA Binding' })
  await binding.getByLabel('Namespace URI').fill('urn:demo:plc')
  await binding.getByLabel('Identifier', { exact: true }).fill('Part.Status')
  await binding.getByRole('button', { name: 'Save Binding' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Binding' })).toBeHidden()

  await tree.getByRole('treeitem', { name: /^NED2/u }).click()
  await page.getByTestId('v6-inspector').getByRole('button', { name: 'Open Binding' }).click()
  binding = page.getByRole('dialog', { name: 'OPC UA Binding' })
  await binding.getByLabel('Namespace URI').fill('urn:demo:plc')
  await binding.getByLabel('Identifier', { exact: true }).fill('Robot.TCP')
  await binding.getByRole('button', { name: 'Save Binding' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Binding' })).toBeHidden()

  const jobs = page.getByRole('region', { name: 'Job monitor' })
  await jobs.getByRole('button', { name: 'Start' }).click()
  await expect(jobs.getByText(/SUCCEEDED|FAILED/u)).toBeVisible()
  await jobs.getByRole('button', { name: 'Edit Job' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit Job: Logical I/O Pick and Place' })).toBeVisible()
})
