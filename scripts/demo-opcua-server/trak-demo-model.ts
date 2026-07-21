export const BUTTON_START = 1
export const BUTTON_STOP = 2

export const ROBOT_STATE_IDLE = 0
export const ROBOT_STATE_MOVING = 20
export const ROBOT_STATE_HOLDING = 30
export const ROBOT_STATE_DONE = 40
export const ROBOT_STATE_ERROR = 255

const DEFAULT_SAMPLE_TIME_SECONDS = 0.1
const TRACK_RADIUS_MM = 350
const STRAIGHT_LENGTH_MM = 1_200
const OBJECT_VELOCITY_MM_PER_SECOND = 280
const OBJECT_COUNT = 20
const JOB_COUNT = 20

export interface TrakDemoObjectPose {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly roll: number
  readonly pitch: number
  readonly yaw: number
}

export interface TrakDemoRobotState {
  readonly q1: number
  readonly q2: number
  readonly q3: number
  readonly q4: number
  readonly q5: number
  readonly q6: number
  readonly status: number
}

export interface TrakDemoSnapshot {
  readonly button: number
  readonly jobId: number
  readonly jobStatus: readonly number[]
  readonly robot: TrakDemoRobotState
  readonly objectPos: readonly TrakDemoObjectPose[]
  readonly objectPosCli: TrakDemoObjectPose
}

interface RobotPose {
  readonly q: readonly [number, number, number, number, number, number]
  readonly moveTimeSeconds: number
  readonly holdTimeSeconds: number
}

interface RobotJob {
  readonly poses: readonly RobotPose[]
}

const BASE_POSES: readonly RobotPose[] = [
  { q: [-60, -20, 55, 0, 15, 0], moveTimeSeconds: 1.2, holdTimeSeconds: 0.25 },
  { q: [-30, -50, 80, 20, -10, 30], moveTimeSeconds: 1.5, holdTimeSeconds: 0.35 },
  { q: [10, -25, 45, -15, 25, -30], moveTimeSeconds: 1.4, holdTimeSeconds: 0.3 },
  { q: [-45, -35, 65, 5, 10, 0], moveTimeSeconds: 1.1, holdTimeSeconds: 0.2 },
  { q: [-15, -60, 70, 25, 0, 45], moveTimeSeconds: 1.3, holdTimeSeconds: 0.25 },
  { q: [-55, -15, 50, -10, 20, -10], moveTimeSeconds: 1.2, holdTimeSeconds: 0.3 },
]

const TRACK_LENGTH_MM = 2 * STRAIGHT_LENGTH_MM + 2 * Math.PI * TRACK_RADIUS_MM

function normalizeTrackDistance(distanceMm: number): number {
  return ((distanceMm % TRACK_LENGTH_MM) + TRACK_LENGTH_MM) % TRACK_LENGTH_MM
}

function objectPoseAt(distanceInputMm: number): TrakDemoObjectPose {
  const distanceMm = normalizeTrackDistance(distanceInputMm)
  let x: number
  let y: number

  if (distanceMm < STRAIGHT_LENGTH_MM) {
    x = -STRAIGHT_LENGTH_MM / 2 + distanceMm
    y = TRACK_RADIUS_MM
  } else if (distanceMm < STRAIGHT_LENGTH_MM + Math.PI * TRACK_RADIUS_MM) {
    const arcAngle = Math.PI / 2 - (distanceMm - STRAIGHT_LENGTH_MM) / TRACK_RADIUS_MM
    x = STRAIGHT_LENGTH_MM / 2 + TRACK_RADIUS_MM * Math.cos(arcAngle)
    y = TRACK_RADIUS_MM * Math.sin(arcAngle)
  } else if (distanceMm < 2 * STRAIGHT_LENGTH_MM + Math.PI * TRACK_RADIUS_MM) {
    x = STRAIGHT_LENGTH_MM / 2 - (distanceMm - STRAIGHT_LENGTH_MM - Math.PI * TRACK_RADIUS_MM)
    y = -TRACK_RADIUS_MM
  } else {
    const arcAngle = -Math.PI / 2
      - (distanceMm - 2 * STRAIGHT_LENGTH_MM - Math.PI * TRACK_RADIUS_MM) / TRACK_RADIUS_MM
    x = -STRAIGHT_LENGTH_MM / 2 + TRACK_RADIUS_MM * Math.cos(arcAngle)
    y = TRACK_RADIUS_MM * Math.sin(arcAngle)
  }

  const waveAngle = 2 * Math.PI * distanceMm / TRACK_LENGTH_MM
  return Object.freeze({
    x,
    y,
    z: 180 + 45 * Math.sin(waveAngle),
    roll: 18 * Math.sin(waveAngle + 0.45),
    pitch: 14 * Math.sin(waveAngle + 1.2),
    yaw: 25 * Math.sin(waveAngle + 2.1),
  })
}

function createJobs(): readonly RobotJob[] {
  return Object.freeze(Array.from({ length: JOB_COUNT }, (_, index) => {
    const q1Offset = index * 12
    return Object.freeze({
      poses: Object.freeze(BASE_POSES.map((pose) => Object.freeze({
        ...pose,
        q: Object.freeze([
          pose.q[0] + q1Offset,
          pose.q[1],
          pose.q[2],
          pose.q[3],
          pose.q[4],
          pose.q[5],
        ]) as unknown as RobotPose['q'],
      }))),
    })
  }))
}

function smoothstepQuintic(progress: number): number {
  const bounded = Math.max(0, Math.min(1, progress))
  return 10 * bounded ** 3 - 15 * bounded ** 4 + 6 * bounded ** 5
}

export interface TrakDemoModel {
  writeButton(command: number): void
  step(sampleTimeSeconds?: number): void
  snapshot(): TrakDemoSnapshot
}

export function createTrakDemoModel(): TrakDemoModel {
  const jobs = createJobs()
  const robotQ = [0, 0, 0, 0, 0, 0]
  const startQ = [0, 0, 0, 0, 0, 0]
  const targetQ = [0, 0, 0, 0, 0, 0]
  const jobStatus = Array.from({ length: JOB_COUNT }, () => 0)
  let button = 0
  let jobId = 0
  let robotState = ROBOT_STATE_IDLE
  let selectedJobIndex = -1
  let activePoseIndex = 0
  let startNextPose = false
  let moveElapsedSeconds = 0
  let holdElapsedSeconds = 0
  let objectTravelMm = 0
  let objectPos = Array.from(
    { length: OBJECT_COUNT },
    (_, index) => objectPoseAt(index * TRACK_LENGTH_MM / OBJECT_COUNT),
  )

  function processButton(): void {
    if (button === 0) return
    if (button === BUTTON_START) {
      jobStatus.fill(0)
      selectedJobIndex = 0
      activePoseIndex = 0
      jobId = 1
      jobStatus[0] = 1
      startNextPose = true
    } else if (button === BUTTON_STOP) {
      jobStatus.fill(0)
      selectedJobIndex = -1
      jobId = 0
      startNextPose = false
      robotState = ROBOT_STATE_IDLE
    } else {
      robotState = ROBOT_STATE_ERROR
    }
    button = 0
  }

  function prepareNextPose(): void {
    if (!startNextPose || selectedJobIndex < 0) return
    const pose = jobs[selectedJobIndex]?.poses[activePoseIndex]
    if (pose === undefined) {
      robotState = ROBOT_STATE_ERROR
      startNextPose = false
      return
    }
    for (let index = 0; index < robotQ.length; index += 1) {
      startQ[index] = robotQ[index]!
      targetQ[index] = pose.q[index]!
    }
    moveElapsedSeconds = 0
    holdElapsedSeconds = 0
    robotState = ROBOT_STATE_MOVING
    startNextPose = false
  }

  function finishPose(): boolean {
    activePoseIndex += 1
    const poseCount = selectedJobIndex < 0 ? 0 : jobs[selectedJobIndex]!.poses.length
    if (activePoseIndex >= poseCount) return true
    startNextPose = true
    return false
  }

  function finishJob(): void {
    if (selectedJobIndex < 0) return
    jobStatus[selectedJobIndex] = 2
    if (selectedJobIndex < JOB_COUNT - 1) {
      selectedJobIndex += 1
      activePoseIndex = 0
      jobId = selectedJobIndex + 1
      jobStatus[selectedJobIndex] = 1
      startNextPose = true
    } else {
      selectedJobIndex = -1
      jobId = 0
      robotState = ROBOT_STATE_DONE
    }
  }

  function advanceRobot(sampleTimeSeconds: number): void {
    prepareNextPose()
    let activeJobFinished = false

    if (robotState === ROBOT_STATE_MOVING && selectedJobIndex >= 0) {
      const pose = jobs[selectedJobIndex]!.poses[activePoseIndex]!
      moveElapsedSeconds += sampleTimeSeconds
      const progress = Math.min(1, moveElapsedSeconds / pose.moveTimeSeconds)
      const smoothProgress = smoothstepQuintic(progress)
      for (let index = 0; index < robotQ.length; index += 1) {
        robotQ[index] = startQ[index]! + (targetQ[index]! - startQ[index]!) * smoothProgress
      }
      if (progress >= 1) {
        if (pose.holdTimeSeconds > 0) {
          robotState = ROBOT_STATE_HOLDING
        } else {
          activeJobFinished = finishPose()
        }
      }
    } else if (robotState === ROBOT_STATE_HOLDING && selectedJobIndex >= 0) {
      const pose = jobs[selectedJobIndex]!.poses[activePoseIndex]!
      holdElapsedSeconds += sampleTimeSeconds
      if (holdElapsedSeconds >= pose.holdTimeSeconds) activeJobFinished = finishPose()
    }

    if (activeJobFinished) finishJob()
  }

  function advanceObjects(sampleTimeSeconds: number): void {
    objectTravelMm = normalizeTrackDistance(
      objectTravelMm + OBJECT_VELOCITY_MM_PER_SECOND * sampleTimeSeconds,
    )
    objectPos = Array.from(
      { length: OBJECT_COUNT },
      (_, index) => objectPoseAt(objectTravelMm + index * TRACK_LENGTH_MM / OBJECT_COUNT),
    )
  }

  return Object.freeze({
    writeButton(command: number): void {
      button = Number.isFinite(command) ? Math.trunc(command) : -1
    },
    step(sampleTimeSeconds = DEFAULT_SAMPLE_TIME_SECONDS): void {
      if (!Number.isFinite(sampleTimeSeconds) || sampleTimeSeconds <= 0) {
        throw new Error('sampleTimeSeconds must be a finite positive number.')
      }
      processButton()
      advanceRobot(sampleTimeSeconds)
      advanceObjects(sampleTimeSeconds)
    },
    snapshot(): TrakDemoSnapshot {
      const frozenObjects = Object.freeze(objectPos.map((pose) => Object.freeze({ ...pose })))
      return Object.freeze({
        button,
        jobId,
        jobStatus: Object.freeze([...jobStatus]),
        robot: Object.freeze({
          q1: robotQ[0]!, q2: robotQ[1]!, q3: robotQ[2]!,
          q4: robotQ[3]!, q5: robotQ[4]!, q6: robotQ[5]!,
          status: robotState,
        }),
        objectPos: frozenObjects,
        objectPosCli: frozenObjects[0]!,
      })
    },
  })
}
