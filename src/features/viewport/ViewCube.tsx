import type { StandardWorldView } from './camera-actions'

export interface ViewCubeProps {
  readonly robotRevision?: number
  setStandardView(view: StandardWorldView): void
}

const FACE_VIEWS = [
  ['Top', 'top'], ['Front', 'front'], ['Right', 'right'],
  ['Back', 'back'], ['Left', 'left'], ['Bottom', 'bottom'],
] as const satisfies readonly (readonly [string, StandardWorldView])[]

export function ViewCube({ setStandardView }: ViewCubeProps) {
  return (
    <div aria-label="World view cube" className="view-cube" data-reference="world">
      <button
        aria-label="Isometric view"
        className="view-cube-corner"
        onClick={() => setStandardView('isometric')}
        title="Isometric view (World)"
        type="button"
      >ISO</button>
      {FACE_VIEWS.map(([label, view]) => (
        <button
          aria-label={`${label} view`}
          key={view}
          onClick={() => setStandardView(view)}
          title={`${label} view (World)`}
          type="button"
        >{label.slice(0, 1)}</button>
      ))}
    </div>
  )
}
