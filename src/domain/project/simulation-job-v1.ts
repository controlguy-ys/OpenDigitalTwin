import type { ProjectPoseRecordV1 } from './project'

export const MAX_JOBS = 32
export const MAX_POSES_PER_JOB = 256
export const MAX_PROJECT_POSES = 2_048

export type ProjectPoseStepV3 = Readonly<
  Omit<ProjectPoseRecordV1, 'anglesDeg' | 'speedPercentToNext'> & {
    readonly anglesDeg: readonly [number, number, number, number, number, number]
    readonly speedPercentToNext: number
  }
>

export interface SimulationJobV1 {
  readonly id: string
  readonly name: string
  readonly revision: number
  readonly poses: readonly ProjectPoseStepV3[]
}

export interface ProjectSimulationStateV3 {
  readonly activeJobId: string | null
  readonly jobs: readonly SimulationJobV1[]
}
