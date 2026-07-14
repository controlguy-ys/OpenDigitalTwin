import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Pose3D } from '../../domain/frames/pose3d'
import {
  IDENTITY_POSE,
  pose3DToSerializableTransform,
  serializableTransformToPose3D,
} from '../../domain/frames/pose3d'
import type {
  LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
} from '../../domain/project/project'

export const COORDINATE_FRAME_STORAGE_KEY = 'robot-sim.coordinate-frames.v1'
export type CoordinateFrameId = 'mcp' | 'tcp'
export type CoordinateFrames = CurrentProjectSnapshot['frames']

export interface CoordinateFrameStoreState {
  frames: CoordinateFrames
  setFramePose(id: CoordinateFrameId, pose: Pose3D): void
  replaceFrames(frames: CoordinateFrames): void
  resetFrames(): void
}

function identityFrames(): CoordinateFrames {
  return {
    mcp: pose3DToSerializableTransform(IDENTITY_POSE),
    tcp: pose3DToSerializableTransform(IDENTITY_POSE),
  }
}

function normalizeFrames(frames: CoordinateFrames): CoordinateFrames {
  return {
    mcp: pose3DToSerializableTransform(
      serializableTransformToPose3D(frames.mcp),
    ),
    tcp: pose3DToSerializableTransform(
      serializableTransformToPose3D(frames.tcp),
    ),
  }
}

function readFrames(storage: Storage | null): CoordinateFrames {
  if (storage === null) return identityFrames()
  try {
    const raw = storage.getItem(COORDINATE_FRAME_STORAGE_KEY)
    return raw === null
      ? identityFrames()
      : normalizeFrames(JSON.parse(raw) as CoordinateFrames)
  } catch {
    return identityFrames()
  }
}

function persistFrames(storage: Storage | null, frames: CoordinateFrames): void {
  if (storage === null) return
  try {
    storage.setItem(COORDINATE_FRAME_STORAGE_KEY, JSON.stringify(frames))
  } catch {
    // Frame edits remain active in memory if browser storage is unavailable.
  }
}

function createCoordinateFrameState(storage: Storage | null) {
  return (
    set: (update: Partial<CoordinateFrameStoreState>) => void,
    get: () => CoordinateFrameStoreState,
  ): CoordinateFrameStoreState => ({
    frames: readFrames(storage),
    setFramePose: (id, pose) => {
      const frames = normalizeFrames({
        ...get().frames,
        [id]: pose3DToSerializableTransform(pose),
      })
      persistFrames(storage, frames)
      set({ frames })
    },
    replaceFrames: (candidate) => {
      const frames = normalizeFrames(candidate)
      persistFrames(storage, frames)
      set({ frames })
    },
    resetFrames: () => {
      const frames = identityFrames()
      persistFrames(storage, frames)
      set({ frames })
    },
  })
}

export function createCoordinateFrameStore(storage: Storage | null) {
  return createStore<CoordinateFrameStoreState>()(
    createCoordinateFrameState(storage),
  )
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const useCoordinateFrameStore = create<CoordinateFrameStoreState>()(
  createCoordinateFrameState(browserStorage()),
)
