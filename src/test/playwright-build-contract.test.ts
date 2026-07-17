import { expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'

it('builds the test-mode application before every default Playwright server', () => {
  const webServer = playwrightConfig.webServer
  expect(Array.isArray(webServer)).toBe(false)
  expect((webServer as { readonly command?: string } | undefined)?.command)
    .toContain('npm run build:e2e')
})

it('uses the Project V4 multi-Robot acceptance as the only default Playwright spec', () => {
  expect(playwrightConfig.testMatch).toBe('project-v4-multi-robot.spec.ts')
  expect(playwrightConfig.testIgnore).toBeUndefined()
})
