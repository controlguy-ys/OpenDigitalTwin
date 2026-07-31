import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()
const stylesRoot = resolve(projectRoot, 'src/styles/v6')
const semanticColorNames = [
  'canvas', 'panel', 'viewport', 'border', 'text', 'muted', 'accent',
  'success', 'warning', 'fault', 'selection', 'focus', 'overlay',
] as const

function readStyle(fileName: string): string {
  return readFileSync(resolve(stylesRoot, fileName), 'utf8')
}

describe('V6 style contract', () => {
  it('loads the packaged Pretendard variable font through the V6 stylesheet entry', () => {
    const index = readStyle('index.css')
    const base = readStyle('base.css')

    expect(index).toContain("@import './base.css'")
    expect(base).toContain('@import "pretendard/dist/web/variable/pretendardvariable.css"')
    expect(base).toContain('font-family: "Pretendard Variable", Pretendard, system-ui, sans-serif')
  })

  it.each([':root', '[data-theme="dark"]', '[data-theme="light"]'])(
    'defines every semantic color token for %s',
    (selector) => {
      const tokens = readStyle('tokens.css')
      const escapedSelector = selector.replaceAll('[', '\\[').replaceAll(']', '\\]')
      const declaration = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'u')
      const match = tokens.match(declaration)

      expect(match?.[1]).toBeDefined()
      for (const name of semanticColorNames) {
        expect(match?.[1]).toMatch(new RegExp(`--v6-color-${name}:\\s*[^;]+;`, 'u'))
      }
    },
  )

  it('removes animation while reduced motion is requested', () => {
    expect(readStyle('base.css')).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none/iu)
  })

  it('keeps fixed panel and text colors inside semantic token definitions', () => {
    for (const fileName of ['base.css', 'components.css', 'index.css']) {
      expect(readStyle(fileName)).not.toMatch(/(?:color|background(?:-color)?|border(?:-color)?):\s*(?:#[0-9a-f]{3,8}|rgb\(|hsl\()/iu)
    }
  })
})
