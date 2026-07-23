import { describe, expect, it } from 'vitest'

import { App } from './App.js'
import { AppV5 } from './v5/AppV5.js'

describe('production App', () => {
  it('is the narrow Project V5 export', () => {
    expect(App).toBe(AppV5)
  })
})
