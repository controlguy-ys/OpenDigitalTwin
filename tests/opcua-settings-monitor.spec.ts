import { expect, test } from '@playwright/test'

test('opens the active V5 Settings, modeless Monitor, Binding, and Docker surfaces', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', {
    data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true },
  })
  await page.route('**/runtime/status', async (route) => {
    const response = await route.fetch()
    const status = await response.json()
    status.gateway.runtimeKind = 'docker'
    await route.fulfill({ response, json: status })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'OPC UA Settings…' })).toBeEnabled()

  await page.getByRole('button', { name: 'OPC UA Settings…' }).click()
  await expect(page.getByRole('dialog')).toContainText('OPC UA Settings')
  await page.getByRole('button', { name: 'Add Endpoint' }).click()
  await expect(page.getByRole('button', { name: 'Use host.docker.internal' })).toBeVisible()
  await page.getByRole('button', { name: 'Use host.docker.internal' }).click()
  await expect(page.getByLabel('Endpoint URL')).toHaveValue('opc.tcp://host.docker.internal:4840')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Connection Monitor…' }).click()
  await expect(page.getByRole('heading', { name: 'Connection Monitor' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Binding Overview…' })).toBeEnabled()

  await page.getByRole('button', { name: 'Docker Run Guide…' }).click()
  await expect(page.getByRole('dialog')).toContainText('Docker')
})
