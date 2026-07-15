import { expect, test, type Locator } from '@playwright/test'

interface CameraDiagnostic {
  readonly ready: boolean
  readonly state: {
    readonly position: [number, number, number]
    readonly target: [number, number, number]
    readonly quaternion: [number, number, number, number]
    readonly up: [number, number, number]
    readonly zoom: number
    readonly fov: number
    readonly near: number
    readonly far: number
  }
  readonly viewFromDirection: [number, number, number]
}

async function diagnostic(locator: Locator): Promise<CameraDiagnostic> {
  return JSON.parse(await locator.textContent() ?? 'null') as CameraDiagnostic
}

function expectTupleClose(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 8))
}

test('camera, coordinate, preference, and semantic boundaries work end to end', async ({ page }) => {
  await page.goto('/')
  const viewport = page.getByRole('main', { name: '3D viewport' })
  const cameraOutput = page.getByTestId('viewport-camera-diagnostic')
  const projectOutput = page.getByTestId('project-semantic-diagnostic')
  await expect(viewport).toBeVisible()
  await expect.poll(async () => (await diagnostic(cameraOutput)).ready).toBe(true)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 180_000 })
  await expect(projectOutput).not.toHaveText('null')
  await expect(page.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
  await expect(page.getByLabel('World view cube')).toHaveAttribute('data-reference', 'world')

  const j1 = page.getByRole('spinbutton', { name: 'J1' })
  const jointBefore = await j1.inputValue()
  const semanticBefore = await projectOutput.textContent()

  await page.getByRole('button', { name: 'Top view' }).click()
  await expect.poll(async () => (await diagnostic(cameraOutput)).viewFromDirection[2]).toBeCloseTo(1)
  const top = await diagnostic(cameraOutput)
  expect(top.state.up).toEqual([0, 1, 0])
  expect(await projectOutput.textContent()).toBe(semanticBefore)
  expect(await j1.inputValue()).toBe(jointBefore)

  await page.getByRole('button', { name: 'Home View' }).click()
  const home = await diagnostic(cameraOutput)
  expectTupleClose(home.state.position, [2.2, 1.8, 1.7])
  expectTupleClose(home.state.target, [0.15, 0, 1.55])
  expectTupleClose(home.state.up, [0, 0, 1])
  expect(home.state).toMatchObject({ zoom: 1, fov: 42, near: 0.1, far: 100 })
  await page.getByRole('button', { name: 'Fit All' }).click()
  const fitted = await diagnostic(cameraOutput)
  expect(fitted.state.position).not.toEqual(home.state.position)
  expect(await projectOutput.textContent()).toBe(semanticBefore)
  expect(await j1.inputValue()).toBe(jointBefore)

  await page.getByRole('button', { name: 'Select CRB15000-12/1.27' }).click()
  await expect(page.getByRole('button', { name: 'Focus Selection' })).toBeEnabled()
  const semanticWithSelection = await projectOutput.textContent()
  await page.getByRole('button', { name: 'Home View' }).click()
  const beforeFocus = await diagnostic(cameraOutput)
  await page.getByRole('button', { name: 'Focus Selection' }).click()
  const afterFocus = await diagnostic(cameraOutput)
  expect(afterFocus.state.position).not.toEqual(beforeFocus.state.position)
  expect(afterFocus.state.target).not.toEqual(beforeFocus.state.target)
  expect(await projectOutput.textContent()).toBe(semanticWithSelection)

  const pose = page.getByLabel('Actual TCP pose')
  await expect(pose).toContainText('X')
  await expect(pose).toContainText('R')
  await expect(page.getByTestId('frame-marker-diagnostic'))
    .toHaveText('World:X,Y,Z|Robot Base:X,Y,Z|Actual TCP:X,Y,Z')
  for (const frame of ['world', 'mcp', 'base']) {
    await page.getByLabel('Pose Frame').selectOption(frame)
    await expect(pose).not.toContainText('—')
  }

  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Top view' }).click()
  await expect.poll(async () => (await diagnostic(cameraOutput)).viewFromDirection[2]).toBeCloseTo(1)
  const persistedTop = await diagnostic(cameraOutput)
  await page.reload()
  await expect.poll(async () => (await diagnostic(cameraOutput)).ready).toBe(true)
  const restoredTop = await diagnostic(cameraOutput)
  expect(restoredTop.state.quaternion).toEqual(persistedTop.state.quaternion)
  expect(restoredTop.state.up).toEqual(persistedTop.state.up)
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'false')

  await page.getByLabel('Theme').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.setViewportSize({ width: 800, height: 720 })
  await expect(page.getByLabel('World view cube')).toBeHidden()

  expect(semanticBefore).not.toBeNull()
})
