import { expect, test } from '@playwright/test'

test('V6 Job monitor follows the explicit selected Job after loading the demo', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', { data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true } })
  await page.goto('/')
  await page.getByRole('menuitem', { name: 'Project' }).click()
  await page.getByRole('menuitem', { name: 'Load Demo' }).click()
  await expect(page.getByTestId('v6-bottom')).toContainText('Logical I/O')
  await page.getByTestId('v6-bottom').getByRole('button', { name: 'Edit Job' }).click()
  await expect(page.getByRole('dialog')).toContainText('Edit Job')
})
