import { expect, test } from '@playwright/test'

test('V6 opens Settings and keeps Connection Monitor modeless', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', { data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true } })
  await page.goto('/')
  await page.getByRole('button', { name: 'OPC UA Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'OPC UA Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Connection Monitor' }).click()
  await expect(page.getByRole('heading', { name: 'Connection Monitor' })).toBeVisible()
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()
})
