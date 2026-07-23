import { expect, test, type APIRequestContext } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function resetGateway(request: APIRequestContext): Promise<void> {
  await request.delete('http://127.0.0.1:8081/runtime/project', {
    data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true },
  })
}

async function exportProjectBytes(page: import('@playwright/test').Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const path = await (await downloadPromise).path()
  if (path === null) throw new Error('Expected the exported Project V5 download.')
  return readFile(path)
}

test('boots, persists, and rejects a V4 Project without leaving Project V5', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await expect(page.getByText('Project V5', { exact: true })).toBeVisible()
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('button', { name: 'OPC UA Settings…' })).toBeEnabled()
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import' }).click()
  await (await chooser).setFiles({
    name: 'legacy-v4.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 4, projectId: 'legacy' }), 'utf8'),
  })
  await expect(page.getByRole('alert')).toContainText('PROJECT_SCHEMA_UNSUPPORTED')
  await expect(page.getByText('Project V5', { exact: true })).toBeVisible()
})

test('applies eight Endpoint profiles atomically and preserves the canonical V5 export across reload', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()

  await page.getByRole('button', { name: 'Add Endpoint' }).click()
  await expect(page.getByLabel('Endpoint profile').locator('option')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await expect(page.getByLabel('Endpoint profile').locator('option')).toHaveCount(0)

  const addEndpoint = page.getByRole('button', { name: 'Add Endpoint' })
  for (let index = 1; index <= 8; index += 1) {
    await addEndpoint.click()
    await page.getByLabel('Endpoint profile').selectOption(`endpoint-${index}`)
    await page.getByLabel('Endpoint name').fill(`PLC ${index}`)
  }
  await expect(page.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await expect(addEndpoint).toBeDisabled()

  await page.getByLabel('Endpoint profile').selectOption('endpoint-1')
  await page.getByLabel('Endpoint name').fill('')
  await page.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(page.getByRole('alert')).toContainText('UTF-8 length')
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeVisible()

  await page.getByLabel('Endpoint name').fill('PLC 1')
  await page.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeHidden()

  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await expect(page.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await expect(page.getByLabel('Listener port')).toHaveValue('4841')
  await expect(page.getByLabel('Listener port')).toHaveAttribute('readonly')
  await page.getByRole('button', { name: 'Cancel' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  const download = await downloadPromise
  const exportedPath = await download.path()
  expect(exportedPath).not.toBeNull()
  const exportedBytes = await readFile(exportedPath!)

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import' }).click()
  await (await chooser).setFiles(exportedPath!)
  await page.reload()
  await expect(page.getByText('Project V5', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await expect(page.getByLabel('Endpoint profile').locator('option')).toHaveCount(8)
  await page.getByRole('button', { name: 'Cancel' }).click()
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

  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await page.getByRole('button', { name: 'Add Endpoint' }).click()
  await page.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Injected Gateway activation rejection')
  await page.getByRole('button', { name: 'Cancel' }).click()

  expect(await exportProjectBytes(page)).toEqual(before)
  await expect.poll(async () => {
    const status = await request.get('http://127.0.0.1:8081/runtime/status')
    return (await status.json()).project.revisionId
  }).not.toBeNull()
})

test('binds Object and Robot targets by Namespace URI and starts the active V5 Job runtime', async ({ page, request }) => {
  await resetGateway(request)
  await page.goto('/')
  await page.getByRole('button', { name: 'Load Demo' }).click()
  await expect(page.getByText('Logical I/O Robot', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await page.getByRole('button', { name: 'Add Endpoint' }).click()
  await page.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeHidden()

  await page.getByRole('button', { name: /^Part/u }).click()
  await page.getByRole('button', { name: 'Open Binding…' }).first().click()
  await page.getByLabel('Namespace URI').fill('urn:demo:plc')
  await page.getByLabel('Identifier', { exact: true }).fill('Part.Status')
  await page.getByRole('button', { name: 'Save Binding' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Binding' })).toBeHidden()

  await page.getByRole('button', { name: /^Logical I\/O Robot/u }).click()
  await page.getByRole('button', { name: 'Open Binding…' }).first().click()
  await page.getByLabel('Namespace URI').fill('urn:demo:plc')
  await page.getByLabel('Identifier', { exact: true }).fill('Robot.TCP')
  await page.getByRole('button', { name: 'Save Binding' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Binding' })).toBeHidden()

  const jobs = page.getByRole('region', { name: 'Robot Jobs' })
  await jobs.getByRole('button', { name: 'Start' }).click()
  await expect(jobs.getByText(/SUCCEEDED|FAILED/u)).toBeVisible()
  await expect(jobs).toContainText('Instructions')
})
