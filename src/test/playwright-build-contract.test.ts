import { expect, it } from 'vitest'
import playwrightConfig from '../../playwright.config'
import packageJson from '../../package.json'

it('builds the test-mode application before every default Playwright server', () => {
  const webServer = playwrightConfig.webServer
  expect(Array.isArray(webServer)).toBe(true)
  const commands = (webServer as readonly { readonly command?: string }[])
    .map(({ command }) => command ?? '')
  expect(commands.some((command) => command.includes('npm run build:e2e'))).toBe(true)
  expect(commands.some((command) => command.includes('npm run build:gateway'))).toBe(true)
})

it('discovers both Playwright acceptances through the tests directory', () => {
  expect(playwrightConfig.testDir).toBe('./tests')
  expect(playwrightConfig.testMatch).toBeUndefined()
  expect(playwrightConfig.testIgnore).toBeUndefined()
})

it('runs every approved browser acceptance through the default E2E and verify gates', () => {
  expect(packageJson.scripts['test:e2e:viewport'])
    .toBe('playwright test tests/viewport-context-viewcube.spec.ts')
  expect(packageJson.scripts['test:e2e:layout'])
    .toBe('playwright test tests/docked-ribbon-layout.spec.ts')
  expect(packageJson.scripts['test:e2e:v5'])
    .toBe('playwright test tests/project-v5-browser-cutover.spec.ts tests/opcua-settings-monitor.spec.ts tests/mechanism-tree-viewport-fixtures.spec.ts')
  expect(packageJson.scripts['test:e2e:v6'])
    .toBe('playwright test tests/ui-v6-shell.spec.ts tests/ui-v6-scene.spec.ts tests/ui-v6-jobs.spec.ts tests/ui-v6-connectivity.spec.ts tests/ui-v6-accessibility.spec.ts tests/mechanism-tree-viewport-fixtures.spec.ts')
  expect(packageJson.scripts['test:e2e'])
    .toBe('npm run test:e2e:v6')
  expect(packageJson.scripts.verify)
    .toBe('npm run lint && npm run test:run && npm run cad:validate && npm run deploy:validate && npm run build:gateway && node dist-gateway/middleware/runtime-gateway/main.js --check-config && npm run build && npm run test:e2e')
})
