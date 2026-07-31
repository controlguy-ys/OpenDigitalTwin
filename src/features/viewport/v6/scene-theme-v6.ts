export type SceneThemePreferenceV6 = 'system' | 'dark' | 'light'

export interface SceneThemeTokensV6 {
  readonly canvas: string
  readonly viewport: string
  readonly border: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly selection: string
  readonly overlay: string
}

export interface SceneThemeV6 {
  readonly preference: SceneThemePreferenceV6
  readonly background: string
  readonly grid: { readonly minor: string; readonly major: string }
  readonly axes: string
  readonly markers: string
  readonly outline: string
  readonly cube: string
  readonly overlay: string
}

export function resolveSceneThemeV6(preference: SceneThemePreferenceV6, tokens: SceneThemeTokensV6): SceneThemeV6 {
  return Object.freeze({
    preference,
    background: tokens.viewport,
    grid: Object.freeze({ minor: tokens.border, major: tokens.accent }),
    axes: tokens.text,
    markers: tokens.muted,
    outline: tokens.selection,
    cube: tokens.accent,
    overlay: tokens.overlay,
  })
}
