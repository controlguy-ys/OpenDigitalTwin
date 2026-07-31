export type V6WorkcellSelection =
  | { readonly kind: 'robot'; readonly id: string }
  | { readonly kind: 'entity'; readonly id: string }
  | { readonly kind: 'frame'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string }
