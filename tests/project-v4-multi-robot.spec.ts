import { expect, test, type Locator, type Page } from '@playwright/test'

import { createDualRobotSampleV4 } from '../src/features/project/v4/dual-robot-sample-v4.js'

const CRB_NAME = 'ABB CRB15000'
const SLIDE_NAME = 'Logical Linear Slide'

async function ensurePanelVisible(
  page: Page,
  panelLabel: string,
  controlLabel: string,
): Promise<void> {
  const panel = page.getByRole('complementary', { name: panelLabel })
  if (await panel.isVisible()) return
  const control = page.getByRole('button', { name: controlLabel })
  await expect(control).toBeVisible()
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click()
  await expect(control).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeVisible()
}

async function selectRobot(
  sceneTree: Locator,
  robotName: string,
): Promise<void> {
  const row = sceneTree.getByRole('treeitem', { name: robotName, exact: true })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: robotName, exact: true }).click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
}

function jointInput(page: Page, robotName: string, jointId: string): Locator {
  return page
    .getByRole('region', { name: `${robotName} Joint inspector` })
    .getByRole('spinbutton', { name: jointId })
}

async function expectNumericValue(input: Locator, expected: number): Promise<void> {
  await expect(input).toBeVisible()
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(expected, 6)
}

async function startSelectedRobotJob(
  page: Page,
  jobLabel: string,
): Promise<void> {
  const job = page
    .getByRole('tree', { name: 'Robot Jobs' })
    .getByRole('treeitem', { name: jobLabel, exact: true })
  await expect(job).toBeVisible()
  await job.click()
  await expect(job).toHaveAttribute('aria-selected', 'true')

  const start = page.getByRole('button', { name: 'Start Job' })
  const status = page.getByRole('status', { name: 'Robot Job state' })
  await expect(start).toBeEnabled()
  await start.click()
  await expect(status).toContainText(/RUNNING|SUCCEEDED/)
  await expect(status).toContainText('SUCCEEDED', { timeout: 15_000 })
}

test('imports and operates the two-Robot V4 sample independently', async ({ page }) => {
  const project = createDualRobotSampleV4({
    projectId: 'project-e2e-dual-robot-v4',
    revisionId: 'revision-e2e-dual-robot-v4',
    nowIso: '2026-07-17T00:00:00.000Z',
  })

  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' }))
    .toHaveAttribute('aria-busy', 'false')
  await page.getByLabel('Import project').setInputFiles({
    name: 'dual-robot-sample-v4.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project), 'utf8'),
  })

  await expect(page.getByText('Dual Robot Simulation Sample', { exact: true })).toBeVisible()
  await expect(page.getByRole('main', { name: '3D viewport' }))
    .toHaveAttribute('aria-busy', 'false')
  await ensurePanelVisible(page, 'Scene Assets', 'Scene Assets drawer')
  await ensurePanelVisible(page, 'Inspector', 'Inspector drawer')

  const sceneTree = page.getByRole('tree', { name: 'Scene Objects' })
  await expect(sceneTree.getByRole('treeitem', { name: CRB_NAME, exact: true })).toBeVisible()
  await expect(sceneTree.getByRole('treeitem', { name: SLIDE_NAME, exact: true })).toBeVisible()

  await selectRobot(sceneTree, CRB_NAME)
  const crbJ1 = jointInput(page, CRB_NAME, 'J1')
  await expect(crbJ1).toBeVisible()
  const crbJ1Before = Number(await crbJ1.inputValue())

  await selectRobot(sceneTree, SLIDE_NAME)
  const slideJoint = jointInput(page, SLIDE_NAME, 'SLIDE_X')
  await expect(slideJoint).toBeVisible()
  await slideJoint.fill('0.6')
  await slideJoint.press('Enter')
  await expectNumericValue(slideJoint, 0.6)

  await selectRobot(sceneTree, CRB_NAME)
  await expectNumericValue(jointInput(page, CRB_NAME, 'J1'), crbJ1Before)
  await startSelectedRobotJob(page, 'CRB Sweep, 2 steps, 2 Joint Poses')
  await expectNumericValue(jointInput(page, CRB_NAME, 'J1'), 35)

  await selectRobot(sceneTree, SLIDE_NAME)
  await expectNumericValue(jointInput(page, SLIDE_NAME, 'SLIDE_X'), 0.6)
  await startSelectedRobotJob(page, 'Linear Slide Traverse, 2 steps, 2 Joint Poses')
  await expectNumericValue(jointInput(page, SLIDE_NAME, 'SLIDE_X'), 1)
})
