import type { StandardWorldView } from './camera-actions'

export interface ViewCubeProps {
  readonly robotRevision?: number
  setStandardView(view: StandardWorldView): void
}

const FACE_VIEWS = [
  ['Top', 'top', 'T'], ['Front', 'front', 'F'], ['Right', 'right', 'R'],
  ['Back', 'back', 'BK'], ['Left', 'left', 'L'], ['Bottom', 'bottom', 'BTM'],
] as const satisfies readonly (readonly [string, StandardWorldView, string])[]

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
      {FACE_VIEWS.map(([label, view, abbreviation]) => (
        <button
          aria-label={`${label} view`}
          key={view}
          onClick={() => setStandardView(view)}
          title={`${label} view (World)`}
          type="button"
        >{abbreviation}</button>
      ))}
    </div>
  )
}
