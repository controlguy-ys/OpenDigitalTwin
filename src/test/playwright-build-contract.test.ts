import { expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'

it('builds the test-mode application before every default Playwright server', () => {
  const webServer = playwrightConfig.webServer
  expect(Array.isArray(webServer)).toBe(false)
  expect((webServer as { readonly command?: string } | undefined)?.command)
    .toContain('npm run build:e2e')
})
