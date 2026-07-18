import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  applyThemePreference,
  isThemePreference,
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

it('recognizes only the Theme values shared with workspace preferences', () => {
  expect(isThemePreference('light')).toBe(true)
  expect(isThemePreference('dark')).toBe(true)
  expect(isThemePreference('system')).toBe(true)
  expect(isThemePreference('high-contrast')).toBe(false)
})
