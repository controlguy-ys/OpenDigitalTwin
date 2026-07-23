import { describe, expect, it, vi } from 'vitest'

import { ProjectDatabaseV5 } from './project-v5-db.js'
import {
  createBrowserProjectApplicationResourcesV5,
  type BrowserProjectApplicationResourcesV5,
} from './browser-project-resources-v5.js'

function injectedDependencies() {
  const stopGatewayStream = vi.fn()
  const runtimeDispose = vi.fn(async () => undefined)
  const connectivityDispose = vi.fn()
  const setPublicationPhase = vi.fn()
  const runtime = {
    bundle: {},
    stopGatewayStream,
    dispose: runtimeDispose,
  }
  const gateway = {}
  const connectivity = {
    dispose: connectivityDispose,
    setPublicationPhase,
  }
  const files = {}
  return { connectivity, connectivityDispose, files, gateway, runtime, runtimeDispose, setPublicationPhase, stopGatewayStream }
}

describe('browser Project V5 application resources', () => {
  it('composes one shared mutation authority for Project store and Settings', async () => {
    const database = new ProjectDatabaseV5(`browser-resources-${crypto.randomUUID()}`)
    const injected = injectedDependencies()
    const resources = createBrowserProjectApplicationResourcesV5({
      database,
      runtime: injected.runtime as unknown as BrowserProjectApplicationResourcesV5['runtime'],
      gateway: injected.gateway as unknown as BrowserProjectApplicationResourcesV5['gateway'],
      connectivity: injected.connectivity as unknown as BrowserProjectApplicationResourcesV5['connectivity'],
      files: injected.files as unknown as BrowserProjectApplicationResourcesV5['files'],
    })
    expect(resources.store.getState().activeProject).toBeNull()
    expect(resources.mutations).toBeDefined()
    expect(resources.settings.open).toBeTypeOf('function')
    await resources.dispose()
    expect(injected.connectivityDispose).toHaveBeenCalledOnce()
    expect(injected.stopGatewayStream).toHaveBeenCalledOnce()
    expect(injected.runtimeDispose).toHaveBeenCalledOnce()
  })
})
