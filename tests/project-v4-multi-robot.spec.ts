import { expect, test, type Locator, type Page } from '@playwright/test'

import { createDualRobotSampleV4 } from '../src/features/project/v4/dual-robot-sample-v4.js'

const PRIMARY_ROBOT_NAME = 'NED2'
const SLIDE_NAME = 'Logical Linear Slide'

async function importProject(
  page: Page,
  project: object,
  fileName: string,
): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Import Project', exact: true }).click()
  await (await chooser).setFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project), 'utf8'),
  })
}

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

  const start = page
    .getByRole('region', { name: 'Robot Jobs' })
    .getByRole('button', { name: 'Start Job' })
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
  await importProject(page, project, 'dual-robot-sample-v4.json')

  await expect(page.getByText('Dual Robot Technical Demo', { exact: true })).toBeVisible()
  await expect(page.getByRole('main', { name: '3D viewport' }))
    .toHaveAttribute('aria-busy', 'false')
  await ensurePanelVisible(page, 'Scene Assets', 'Scene Assets drawer')
  await ensurePanelVisible(page, 'Inspector', 'Inspector drawer')

  const sceneTree = page.getByRole('tree', { name: 'Scene Objects' })
  await expect(
    sceneTree.getByRole('treeitem', { name: PRIMARY_ROBOT_NAME, exact: true }),
  ).toBeVisible()
  await expect(sceneTree.getByRole('treeitem', { name: SLIDE_NAME, exact: true })).toBeVisible()

  await selectRobot(sceneTree, PRIMARY_ROBOT_NAME)
  const primaryRobotJ1 = jointInput(page, PRIMARY_ROBOT_NAME, 'J1')
  await expect(primaryRobotJ1).toBeVisible()
  const primaryRobotJ1Before = Number(await primaryRobotJ1.inputValue())

  await selectRobot(sceneTree, SLIDE_NAME)
  const slideJoint = jointInput(page, SLIDE_NAME, 'SLIDE_X')
  await expect(slideJoint).toBeVisible()
  await slideJoint.fill('0.6')
  await slideJoint.press('Enter')
  await expectNumericValue(slideJoint, 0.6)

  await selectRobot(sceneTree, PRIMARY_ROBOT_NAME)
  await expectNumericValue(
    jointInput(page, PRIMARY_ROBOT_NAME, 'J1'),
    primaryRobotJ1Before,
  )
  const technicalDemo = page
    .getByRole('tree', { name: 'Robot Jobs' })
    .getByRole('treeitem', {
      name: 'NED2 12-Pose Technical Demo, 12 steps, 12 Joint Poses',
      exact: true,
    })
  await expect(technicalDemo).toBeVisible()
  await technicalDemo.click()
  await expect(technicalDemo).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Open Timeline', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Bottom Workspace' })).toBeVisible()
  await expect(page.locator('.timeline-track ol[aria-label="Job steps"] > li')).toHaveCount(12)

  const primaryRobotStatus = page.getByRole('status', { name: 'Robot Job state' })
  const primaryRobotStart = page
    .getByRole('region', { name: 'Robot Jobs' })
    .getByRole('button', { name: 'Start Job' })
  await expect(primaryRobotStart).toBeEnabled()
  await primaryRobotStart.click()
  await expect(primaryRobotStatus).toContainText('RUNNING')
  await expect.poll(async () => Number(await primaryRobotJ1.inputValue()), {
    intervals: [50],
    timeout: 5_000,
  }).toBeGreaterThan(50)
  await expect.poll(async () => Number(await primaryRobotJ1.inputValue()), {
    intervals: [50],
    timeout: 8_000,
  }).toBeLessThan(-50)
  await expect(primaryRobotStatus).toContainText('SUCCEEDED', { timeout: 20_000 })
  await expect(page.getByRole('status', { name: 'Timeline runtime' }))
    .toContainText('SUCCEEDED · Step 12 of 12')
  for (const jointId of ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']) {
    await expectNumericValue(jointInput(page, PRIMARY_ROBOT_NAME, jointId), 0)
  }

  await selectRobot(sceneTree, SLIDE_NAME)
  await expectNumericValue(jointInput(page, SLIDE_NAME, 'SLIDE_X'), 0.6)
  await startSelectedRobotJob(page, 'Linear Slide Traverse, 2 steps, 2 Joint Poses')
  await expectNumericValue(jointInput(page, SLIDE_NAME, 'SLIDE_X'), 1)
})

test('keeps a full-width viewport when narrow overlays are initially closed', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  await page.goto('/')

  const viewport = page.getByRole('main', { name: '3D viewport' })
  await expect(viewport).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: 'Inspector drawer' })).toBeVisible()
  await expect.poll(async () => (await viewport.boundingBox())?.x).toBeCloseTo(0, 0)
  await expect.poll(async () => (await viewport.boundingBox())?.width).toBeCloseTo(800, 0)
})
