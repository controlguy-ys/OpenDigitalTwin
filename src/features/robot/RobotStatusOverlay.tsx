import { useProgress } from '@react-three/drei/core/Progress.js'

interface RobotStatusOverlayProps {
  visible: boolean
}

export function RobotStatusOverlay({ visible }: RobotStatusOverlayProps) {
  const progress = useProgress((state) => state.progress)
  const boundedProgress = Math.min(
    100,
    Math.max(0, Number.isFinite(progress) ? progress : 0),
  )

  if (!visible) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="scene-status scene-loading"
      role="status"
    >
      <div aria-hidden="true" className="scene-progress-track">
        <span
          className="scene-progress-value"
          style={{ transform: `scaleX(${boundedProgress / 100})` }}
        />
      </div>
      <span className="visually-hidden">
        Preparing 3D workcell… {Math.round(boundedProgress)}%
      </span>
    </div>
  )
}
