import { expect, test, type Locator, type Page } from '@playwright/test'

const HANDOVER_JOB_LABEL = 'NED2 Direct Handover, 8 steps, 8 Joint Poses'

async function openTopLevelMenu(page: Page, section: string): Promise<void> {
  const menubar = page.getByRole('menubar', { name: 'Application menu' })
  if (await menubar.isVisible()) {
    await menubar.getByRole('menuitem', { name: section, exact: true }).click()
    return
  }
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page
    .getByRole('menu', { name: 'Application menu' })
    .getByRole('menuitem', { name: section, exact: true })
    .click()
}

async function activateSubmenuCommand(
  page: Page,
  section: string,
  submenu: string,
  command: string,
): Promise<void> {
  await openTopLevelMenu(page, section)
  await page.getByRole('menuitem', { name: submenu, exact: true }).click()
  await page
    .getByRole('menuitem', { name: command, exact: true })
    .or(page.getByRole('menuitemcheckbox', { name: command, exact: true }))
    .click()
}

async function ensureSceneAssetsVisible(page: Page): Promise<void> {
  const panel = page.getByRole('complementary', { name: 'Scene Assets' })
  if (await panel.isVisible()) return
  const disclosure = page.getByRole('button', { name: 'Scene Assets drawer' })
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click()
  await expect(panel).toBeVisible()
}

async function loadProjectSample(page: Page, sampleName: string): Promise<void> {
  await activateSubmenuCommand(page, 'Project', 'Samples', sampleName)
  await expect(page.getByText('Hackathon NED2 Direct Handover', { exact: true })).toBeVisible()
  await expect(page.getByRole('main', { name: '3D viewport' }))
    .toHaveAttribute('aria-busy', 'false')
}

async function selectHandoverJob(page: Page): Promise<void> {
  await ensureSceneAssetsVisible(page)
  const robotA = page
    .getByRole('tree', { name: 'Scene Objects' })
    .getByRole('treeitem', { name: 'NED2-A', exact: true })
  await robotA.getByRole('button', { name: 'NED2-A', exact: true }).click()
  await expect(robotA).toHaveAttribute('aria-selected', 'true')

  const job = page
    .getByRole('tree', { name: 'Robot Jobs' })
    .getByRole('treeitem', { name: HANDOVER_JOB_LABEL, exact: true })
  await job.click()
  await expect(job).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Open Timeline', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Handover demo status' })).toBeVisible()
}

function handoverStatus(page: Page): Locator {
  return page.getByRole('status', { name: 'Handover demo status' })
}

function startJob(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Robot Jobs' })
    .getByRole('button', { name: 'Start Job' })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' }))
    .toHaveAttribute('aria-busy', 'false')
  await loadProjectSample(page, 'NED2 Direct Handover Demo')
  const sceneTree = page.getByRole('tree', { name: 'Scene Objects' })
  await expect(sceneTree.getByRole('treeitem', { name: 'NED2-A', exact: true })).toBeVisible()
  await expect(sceneTree.getByRole('treeitem', { name: 'NED2-B', exact: true })).toBeVisible()
  await selectHandoverJob(page)
})

test('runs and resets the offline direct-handover demonstration', async ({ page }) => {
  await expect(startJob(page)).toBeEnabled()
  await startJob(page).click()
  await expect(handoverStatus(page)).toContainText(
    'Step COMPLETE | Part OUTPUT_TRAY | Shared Zone NONE',
    { timeout: 30_000 },
  )
  await expect(page.getByRole('button', { name: /Gateway details:.*offline/i }))
    .toBeVisible()

  await page.getByRole('button', { name: 'Reset Handover Demo' }).click()
  await expect(handoverStatus(page)).toContainText(
    'Step READY | Part TABLE | Shared Zone NONE',
  )
  await expect(startJob(page)).toBeEnabled()
})

test('keeps NED2-A ownership on grip-confirm timeout and clears the fault on reset', async ({ page }) => {
  await activateSubmenuCommand(
    page,
    'Simulation',
    'Fault Injection',
    'Grip Confirm Timeout',
  )

  await expect(startJob(page)).toBeEnabled()
  await startJob(page).click()
  await expect(handoverStatus(page)).toContainText(
    /Step HANDOVER_CONFIRM \| Part NED2-A \| Shared Zone NED2-A \| Failure GRIP_CONFIRM_TIMEOUT/,
    { timeout: 30_000 },
  )

  await page.getByRole('button', { name: 'Reset Handover Demo' }).click()
  await expect(handoverStatus(page)).toContainText(
    'Step READY | Part TABLE | Shared Zone NONE',
  )

  await openTopLevelMenu(page, 'Simulation')
  await page.getByRole('menuitem', { name: 'Fault Injection', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', {
    name: 'Grip Confirm Timeout',
    exact: true,
  })).toHaveAttribute('aria-checked', 'false')
})
