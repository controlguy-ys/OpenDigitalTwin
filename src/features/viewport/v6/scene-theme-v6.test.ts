import { describe, expect, it } from 'vitest'

import { resolveSceneThemeV6 } from './scene-theme-v6.js'

describe('resolveSceneThemeV6', () => {
  it('resolves all WebGL and overlay colors from one semantic theme', () => {
    const theme = resolveSceneThemeV6('dark', {
      canvas: '#10151d', viewport: '#0b1017', border: '#3b4b5e', text: '#f1f5f9', muted: '#a8b4c2', accent: '#60a5fa', selection: '#38bdf8', overlay: '#020617cc',
    })
    expect(theme).toMatchObject({ background: '#0b1017', grid: { minor: '#3b4b5e', major: '#60a5fa' }, axes: '#f1f5f9', markers: '#a8b4c2', outline: '#38bdf8', cube: '#60a5fa', overlay: '#020617cc' })
  })
})
