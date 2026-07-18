import { expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'
import packageJson from '../../package.json'

it('builds the test-mode application before every default Playwright server', () => {
  const webServer = playwrightConfig.webServer
  expect(Array.isArray(webServer)).toBe(false)
  expect((webServer as { readonly command?: string } | undefined)?.command)
    .toContain('npm run build:e2e')
})

it('discovers both Playwright acceptances through the tests directory', () => {
  expect(playwrightConfig.testDir).toBe('./tests')
  expect(playwrightConfig.testMatch).toBeUndefined()
  expect(playwrightConfig.testIgnore).toBeUndefined()
})

it('runs the viewport acceptance through the default E2E and verify gates', () => {
  expect(packageJson.scripts['test:e2e:viewport'])
    .toBe('playwright test tests/viewport-context-viewcube.spec.ts')
  expect(packageJson.scripts['test:e2e'])
    .toBe('npm run test:e2e:v4 && npm run test:e2e:viewport')
  expect(packageJson.scripts.verify)
    .toBe('npm run lint && npm run test:run && npm run cad:validate && npm run deploy:validate && npm run build:gateway && node dist-gateway/middleware/runtime-gateway/main.js --check-config && npm run build && npm run test:e2e')
})
