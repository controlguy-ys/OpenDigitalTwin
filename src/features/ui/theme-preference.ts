export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export const THEME_PREFERENCE_KEY = 'robotsim.theme'
export const DARK_THEME_QUERY = '(prefers-color-scheme: dark)'

export function readThemePreference(storage: Pick<Storage, 'getItem'> = localStorage): ThemePreference {
  try {
    const value = storage.getItem(THEME_PREFERENCE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemDark = globalThis.matchMedia?.(DARK_THEME_QUERY).matches ?? false,
): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const resolved = resolveThemePreference(preference)
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  return resolved
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(THEME_PREFERENCE_KEY, preference)
  } catch {
    // Browser preferences are optional and never affect Project content.
  }
}
