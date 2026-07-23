/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production Runtime Gateway composition', () => {
  it('does not construct the V4 publisher or stream', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app', 'App.tsx'), 'utf8')
    expect(source).toContain("AppV5 as App")
    expect(source).not.toMatch(/runtime-gateway\/v4|RuntimeGatewayStreamFactoryV4/u)
  })
})
