export interface ViewportSafeAreaInsetsV4 {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export const ZERO_VIEWPORT_SAFE_AREA_INSETS_V4: ViewportSafeAreaInsetsV4 =
  Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
