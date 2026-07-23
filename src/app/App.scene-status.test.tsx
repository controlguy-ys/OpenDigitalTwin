/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production Scene composition', () => {
  it('routes through the V5 workcell without a V4 Project cast', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app', 'v5', 'AppV5.tsx'), 'utf8')
    expect(source).toContain('V5WorkcellWorkspace')
    expect(source).not.toMatch(/WorkcellProjectV4|computeSerialRobotPoseV4/u)
  })
})
