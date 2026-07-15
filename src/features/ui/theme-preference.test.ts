import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  applyThemePreference,
  readThemePreference,
  writeThemePreference,
} from './theme-preference'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => vi.unstubAllGlobals())

it('defaults to the operating-system theme without writing Project content', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

  expect(readThemePreference()).toBe('system')
  expect(applyThemePreference('system')).toBe('dark')
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  expect(localStorage.getItem('robotsim.theme')).toBeNull()
})

it('persists and applies a manual light or dark browser preference', () => {
  writeThemePreference('light')

  expect(readThemePreference()).toBe('light')
  expect(applyThemePreference(readThemePreference())).toBe('light')
  expect(localStorage.getItem('robotsim.theme')).toBe('light')
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')
})
