import { useEffect, useState } from 'react'

import type { OpcUaProjectTargetV5, WorkcellProjectV5 } from '../../core/project-v5/index.js'
import type { V6WorkcellSelection } from '../../features/interaction/v6/workcell-selection-v6.js'

export interface ViewportBoundsV6 {
  readonly width: number
  readonly height: number
}

export function errorMessageV6(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useViewportBoundsV6(): ViewportBoundsV6 {
  const [bounds, setBounds] = useState<ViewportBoundsV6>(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const update = () => setBounds({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return bounds
}

export function selectedTargetV6(project: WorkcellProjectV5, selection: V6WorkcellSelection | null): OpcUaProjectTargetV5 | null {
  if (selection === null) return null
  if (selection.kind === 'entity') {
    const entity = project.spatialEntities.find((candidate) => candidate.id === selection.id)
    if (entity === undefined) return null
    const frame = entity.movingFrames[0]
    return frame === undefined ? { type: 'entity-status', entityId: entity.id } : { type: 'entity-frame', entityId: entity.id, frameId: frame.frameId }
  }
  if (selection.kind !== 'robot') return null
  const robot = project.robots.find((candidate) => candidate.id === selection.id)
  return robot === undefined ? null : { type: 'robot-frame', robotId: robot.id, frameId: robot.selectedTcpFrameId }
}

export function initialJobIdV6(project: WorkcellProjectV5 | null): string | null {
  return project?.jobs[0]?.id ?? null
}
