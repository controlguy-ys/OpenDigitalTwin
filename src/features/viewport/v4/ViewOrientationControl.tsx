import type { ReactNode } from 'react'
import type { StandardWorldView } from '../camera-actions.js'

export interface ViewOrientationControlPropsV4 {
  readonly onSelect: (view: StandardWorldView) => void
}

const VIEW_ORIENTATION_OPTIONS_V4 = Object.freeze([
  ['isometric', 'Isometric'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['bottom', 'Bottom'],
] as const satisfies readonly (readonly [StandardWorldView, string])[])

export function ViewOrientationControlV4({ onSelect }: ViewOrientationControlPropsV4): ReactNode {
  return (
    <select
      aria-label="View orientation"
      onChange={(event) => {
        if (event.currentTarget.value !== '') {
          onSelect(event.currentTarget.value as StandardWorldView)
        }
      }}
      value=""
    >
      <option value="">View orientation</option>
      {VIEW_ORIENTATION_OPTIONS_V4.map(([view, label]) => (
        <option key={view} value={view}>{label}</option>
      ))}
    </select>
  )
}
