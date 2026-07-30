import { validateRuntimeGatewayStatusV1 } from '../src/core/runtime-protocol/gateway-status-v1.js'
import { expect, loadV6Demo, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

function browseParent(body: string | null): string | null {
  if (body === null) throw new Error('Address Space browse request did not include a body.')
  const value: unknown = JSON.parse(body)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Address Space browse request was not an object.')
  const parentNodeId = (value as Record<string, unknown>).parentNodeId
  if (parentNodeId === null || typeof parentNodeId === 'string') return parentNodeId
  throw new Error('Address Space browse request had an invalid parent NodeId.')
}

async function mockConnectedBrowseSession(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/runtime/status', async (route) => {
    const response = await route.fetch()
    const status = validateRuntimeGatewayStatusV1(await response.json())
    const connected = validateRuntimeGatewayStatusV1({
      ...status,
      opcUa: {
        ...status.opcUa,
        mode: 'client',
        clientEndpoints: [{
          endpointId: 'endpoint-1', endpointUrl: 'opc.tcp://fixture:4840', phase: 'connected',
          sessionActive: true, subscriptionActive: true, monitoredItemCount: 0, mappingCount: 0,
          lastValueQuality: null, lastNotificationAtMs: null, lastGoodValueAtMs: null,
          reconnectAttempt: 0, nextRetryAtMs: null, lastError: null,
        }],
      },
    })
    await route.fulfill({ response, json: connected })
  })
  await page.route('**/runtime/opcua/browse', async (route) => {
    const parentNodeId = browseParent(route.request().postData())
    const nodes = parentNodeId === null
      ? [{
          sessionNodeId: 'ns=2;s=Machine', browseName: 'Machine', displayName: 'Machine', nodeClass: 'Object',
          referenceTypeId: 'ns=0;i=35', typeDefinitionId: null, hasChildren: true, nodeAddress: null,
        }]
      : parentNodeId === 'ns=2;s=Machine'
        ? [{
            sessionNodeId: 'ns=2;s=Machine.Temperature', browseName: 'Temperature', displayName: 'Temperature', nodeClass: 'Variable',
            referenceTypeId: 'ns=0;i=47', typeDefinitionId: 'ns=0;i=63', hasChildren: false,
            nodeAddress: { namespaceUri: 'urn:fixture:machine', identifierType: 'string', identifier: 'Machine.Temperature' },
          }]
        : []
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'opcua-address-space-browse-response-v1', protocolVersion: 1, endpointId: 'endpoint-1',
        parentNodeId: parentNodeId ?? 'ns=0;i=85', continuationToken: null, nodes,
      }),
    })
  })
  await page.route('**/runtime/opcua/browse/release', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'opcua-address-space-browse-release-response-v1', protocolVersion: 1, released: true }) })
  })
}

async function expandMachine(browser: import('@playwright/test').Locator): Promise<import('@playwright/test').Locator> {
  const machine = browser.getByRole('treeitem', { name: /Machine/u })
  await machine.click()
  await machine.press('ArrowRight')
  const temperature = browser.getByRole('treeitem', { name: /Temperature/u })
  await expect(temperature).toBeVisible()
  return temperature
}

test('V6 opens a real Binding Editor, deterministically browses nested OPC UA addresses, and keeps the monitor modeless', async ({ page }) => {
  await mockConnectedBrowseSession(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await loadV6Demo(page)

  await page.getByRole('button', { name: 'OPC UA Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await settings.getByRole('button', { name: 'Add Endpoint' }).click()
  await settings.getByRole('button', { name: 'Apply & Activate' }).click()
  await expect(settings).toBeHidden()

  await selectV6DemoRobot(page)
  const inspector = page.getByTestId('v6-inspector')
  const bindingTrigger = inspector.getByRole('button', { name: 'Open Binding' })
  await bindingTrigger.click()
  const editor = page.getByRole('dialog', { name: 'OPC UA Binding' })
  const browse = editor.getByRole('button', { name: 'Browse Address Space' })
  await expect(browse).toBeVisible()

  await browse.click()
  const browser = page.getByRole('dialog', { name: 'OPC UA Address Space' })
  const firstTemperature = await expandMachine(browser)
  await firstTemperature.click()
  await browser.getByRole('button', { name: 'Copy NodeId' }).click()
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toBe('ns=2;s=Machine.Temperature')
  await page.keyboard.press('Escape')
  await expect(browser).toBeHidden()
  await expect(browse).toBeFocused()

  await browse.click()
  const selectedTemperature = await expandMachine(browser)
  await selectedTemperature.click()
  await browser.getByRole('button', { name: 'Select Node' }).click()
  await expect(browser).toBeHidden()
  await expect(editor.getByLabel('Namespace URI')).toHaveValue('urn:fixture:machine')
  await expect(editor.getByLabel('Identifier', { exact: true })).toHaveValue('Machine.Temperature')
  await expect(browse).toBeFocused()

  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(bindingTrigger).toBeFocused()
  await page.getByRole('button', { name: 'Connection Monitor' }).click()
  const monitor = page.getByRole('complementary', { name: 'Connection Monitor' })
  await expect(monitor).toBeVisible()
  await page.getByTestId('v6-canvas-host').click({ button: 'right', position: { x: 8, y: 8 } })
  await expect(page.getByRole('menu', { name: 'Scene actions' })).toHaveAttribute('data-surface', 'viewport')
  await expect(monitor).toBeVisible()
})
