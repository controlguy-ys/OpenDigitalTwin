import { describe, expect, it } from 'vitest'

import { App } from './App.js'
import { AppV6 } from './v6/AppV6.js'

describe('production App', () => {
  it('is the narrow V6 production export', () => {
    expect(App).toBe(AppV6)
  })
})
