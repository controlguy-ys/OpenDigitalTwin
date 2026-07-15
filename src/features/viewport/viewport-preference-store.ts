import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'

export const VIEWPORT_PREFERENCE_STORAGE_KEY = 'robotsim.viewport-preferences.v1'

export type PoseFramePreference = 'world' | 'mcp' | 'base'
export type GizmoFramePreference = 'world' | 'parent'
export type ViewportLayer = 'grid' | 'worldFrame' | 'baseFrame' | 'tcpFrame'

export interface ViewportCameraState {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly zoom: number
}

export interface ViewportPreferenceState {
  readonly layers: Readonly<Record<ViewportLayer, boolean>>
  readonly poseFrame: PoseFramePreference
  readonly gizmoFrame: GizmoFramePreference
  readonly cameraState: ViewportCameraState
  setLayer(layer: ViewportLayer, visible: boolean): void
  setPoseFrame(frame: PoseFramePreference): void
  setGizmoFrame(frame: GizmoFramePreference): void
  setCameraState(cameraState: ViewportCameraState): void
}

export type ViewportPreferenceStore = StoreApi<ViewportPreferenceState>

const DEFAULT_LAYERS = Object.freeze({
  grid: true,
  worldFrame: true,
  baseFrame: true,
  tcpFrame: true,
})

export const DEFAULT_VIEWPORT_CAMERA_STATE: ViewportCameraState = Object.freeze({
  position: [2.2, 1.8, 1.7] as const,
  target: [0.15, 0, 1.55] as const,
  quaternion: [0, 0, 0, 1] as const,
  zoom: 1,
})

interface StoredViewportPreferences {
  readonly layers: Readonly<Record<ViewportLayer, boolean>>
  readonly poseFrame: PoseFramePreference
  readonly gizmoFrame: GizmoFramePreference
  readonly cameraState: ViewportCameraState
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
}

function normalize(candidate: unknown): StoredViewportPreferences {
  if (candidate === null || typeof candidate !== 'object') {
    return {
      layers: DEFAULT_LAYERS,
      poseFrame: 'world',
      gizmoFrame: 'world',
      cameraState: DEFAULT_VIEWPORT_CAMERA_STATE,
    }
  }
  const raw = candidate as Record<string, unknown>
  const layers = raw.layers !== null && typeof raw.layers === 'object'
    ? raw.layers as Record<string, unknown>
    : {}
  const camera = raw.cameraState !== null && typeof raw.cameraState === 'object'
    ? raw.cameraState as Record<string, unknown>
    : {}
  const validCamera = isFiniteTuple(camera.position, 3) &&
    isFiniteTuple(camera.target, 3) && isFiniteTuple(camera.quaternion, 4) &&
    Number.isFinite(camera.zoom) && Number(camera.zoom) > 0
  return {
    layers: {
      grid: typeof layers.grid === 'boolean' ? layers.grid : true,
      worldFrame: typeof layers.worldFrame === 'boolean' ? layers.worldFrame : true,
      baseFrame: typeof layers.baseFrame === 'boolean' ? layers.baseFrame : true,
      tcpFrame: typeof layers.tcpFrame === 'boolean' ? layers.tcpFrame : true,
    },
    poseFrame: raw.poseFrame === 'mcp' || raw.poseFrame === 'base' ? raw.poseFrame : 'world',
    gizmoFrame: raw.gizmoFrame === 'parent' ? 'parent' : 'world',
    cameraState: validCamera ? {
      position: camera.position as unknown as [number, number, number],
      target: camera.target as unknown as [number, number, number],
      quaternion: camera.quaternion as unknown as [number, number, number, number],
      zoom: Number(camera.zoom),
    } : DEFAULT_VIEWPORT_CAMERA_STATE,
  }
}

function read(storage: Storage | null): StoredViewportPreferences {
  if (storage === null) return normalize(null)
  try {
    const raw = storage.getItem(VIEWPORT_PREFERENCE_STORAGE_KEY)
    return normalize(raw === null ? null : JSON.parse(raw))
  } catch {
    return normalize(null)
  }
}

function persist(storage: Storage | null, state: StoredViewportPreferences): void {
  if (storage === null) return
  try {
    storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // View preferences remain usable in-memory when localStorage is unavailable.
  }
}

export function createViewportPreferenceStore(storage: Storage | null): ViewportPreferenceStore {
  const initial = read(storage)
  return createStore<ViewportPreferenceState>()((set, get) => ({
    ...initial,
    setLayer: (layer, visible) => {
      const layers = { ...get().layers, [layer]: visible }
      set({ layers })
      persist(storage, { ...get(), layers })
    },
    setPoseFrame: (poseFrame) => {
      set({ poseFrame })
      persist(storage, { ...get(), poseFrame })
    },
    setGizmoFrame: (gizmoFrame) => {
      set({ gizmoFrame })
      persist(storage, { ...get(), gizmoFrame })
    },
    setCameraState: (cameraState) => {
      const normalized = normalize({ ...get(), cameraState }).cameraState
      set({ cameraState: normalized })
      persist(storage, { ...get(), cameraState: normalized })
    },
  }))
}

function browserStorage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

export const viewportPreferenceStore = createViewportPreferenceStore(browserStorage())

export function useViewportPreferenceStore<T>(
  selector: (state: ViewportPreferenceState) => T,
  store: ViewportPreferenceStore = viewportPreferenceStore,
): T {
  return useStore(store, selector)
}
