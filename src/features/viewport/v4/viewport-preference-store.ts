import { createStore, type StoreApi } from 'zustand/vanilla'

export const VIEWPORT_PREFERENCE_STORAGE_KEY_V4 = 'robotsim.viewport-preferences.v4'

export type ViewportLayerV4 =
  | 'grid'
  | 'worldFrame'
  | 'mcpFrame'
  | 'baseFrame'
  | 'tcpFrame'

export type GizmoFramePreferenceV4 = 'world' | 'parent'

export interface ViewportCameraStateV4 {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly up: readonly [number, number, number]
  readonly zoom: number
  readonly fov: number
  readonly near: number
  readonly far: number
}

export interface ViewportPreferenceStateV4 {
  readonly layers: Readonly<Record<ViewportLayerV4, boolean>>
  readonly gizmoFrame: GizmoFramePreferenceV4
  readonly cameraState: ViewportCameraStateV4
  setLayer(layer: ViewportLayerV4, visible: boolean): void
  setGizmoFrame(frame: GizmoFramePreferenceV4): void
  setCameraState(cameraState: ViewportCameraStateV4): void
}

export type ViewportPreferenceStoreV4 = StoreApi<ViewportPreferenceStateV4>

const VIEWPORT_LAYERS_V4 = Object.freeze([
  'grid',
  'worldFrame',
  'mcpFrame',
  'baseFrame',
  'tcpFrame',
] as const)

const DEFAULT_LAYERS_V4: Readonly<Record<ViewportLayerV4, boolean>> = Object.freeze({
  grid: true,
  worldFrame: true,
  mcpFrame: true,
  baseFrame: true,
  tcpFrame: true,
})

function frozenTuple3V4(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  return Object.freeze([...value]) as unknown as readonly [number, number, number]
}

function frozenTuple4V4(
  value: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return Object.freeze([...value]) as unknown as readonly [number, number, number, number]
}

function freezeCameraStateV4(camera: ViewportCameraStateV4): ViewportCameraStateV4 {
  return Object.freeze({
    position: frozenTuple3V4(camera.position),
    target: frozenTuple3V4(camera.target),
    quaternion: frozenTuple4V4(camera.quaternion),
    up: frozenTuple3V4(camera.up),
    zoom: camera.zoom,
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
  })
}

export const DEFAULT_VIEWPORT_CAMERA_STATE_V4: ViewportCameraStateV4 = freezeCameraStateV4({
  position: [2.2, 1.8, 1.7],
  target: [0.15, 0, 1.55],
  quaternion: [
    0.28351443473132715,
    0.6262342308848727,
    0.6616126318893704,
    0.29953126496482535,
  ],
  up: [0, 0, 1],
  zoom: 1,
  fov: 42,
  near: 0.1,
  far: 100,
})

interface StoredViewportPreferencesV4 {
  readonly layers: Readonly<Record<ViewportLayerV4, boolean>>
  readonly gizmoFrame: GizmoFramePreferenceV4
  readonly cameraState: ViewportCameraStateV4
}

function ownValueV4(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function finiteTupleV4(value: unknown, length: 3 | 4): readonly number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null
  const tuple: number[] = []
  for (let index = 0; index < length; index += 1) {
    const component = value[index]
    if (typeof component !== 'number' || !Number.isFinite(component)) return null
    tuple.push(component)
  }
  return tuple
}

function normalizedVectorV4(value: unknown, length: 3 | 4): readonly number[] | null {
  const tuple = finiteTupleV4(value, length)
  if (tuple === null) return null
  const magnitude = Math.hypot(...tuple)
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return null
  return tuple.map((component) => component / magnitude)
}

function normalizedCameraStateV4(candidate: unknown): ViewportCameraStateV4 | null {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null
  }
  try {
    const camera = candidate as Record<string, unknown>
    const position = finiteTupleV4(ownValueV4(camera, 'position'), 3)
    const target = finiteTupleV4(ownValueV4(camera, 'target'), 3)
    const quaternion = normalizedVectorV4(ownValueV4(camera, 'quaternion'), 4)
    const up = normalizedVectorV4(ownValueV4(camera, 'up'), 3)
    const zoom = ownValueV4(camera, 'zoom')
    const fov = ownValueV4(camera, 'fov')
    const near = ownValueV4(camera, 'near')
    const far = ownValueV4(camera, 'far')
    if (
      position === null
      || target === null
      || quaternion === null
      || up === null
      || typeof zoom !== 'number'
      || !Number.isFinite(zoom)
      || zoom <= 0
      || typeof fov !== 'number'
      || !Number.isFinite(fov)
      || fov <= 0
      || fov >= 180
      || typeof near !== 'number'
      || !Number.isFinite(near)
      || near <= 0
      || typeof far !== 'number'
      || !Number.isFinite(far)
      || far <= near
    ) return null
    return freezeCameraStateV4({
      position: position as readonly [number, number, number],
      target: target as readonly [number, number, number],
      quaternion: quaternion as readonly [number, number, number, number],
      up: up as readonly [number, number, number],
      zoom,
      fov,
      near,
      far,
    })
  } catch {
    return null
  }
}

function normalizePreferencesV4(candidate: unknown): StoredViewportPreferencesV4 {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {
      layers: DEFAULT_LAYERS_V4,
      gizmoFrame: 'world',
      cameraState: DEFAULT_VIEWPORT_CAMERA_STATE_V4,
    }
  }
  try {
    const raw = candidate as Record<string, unknown>
    const candidateLayers = ownValueV4(raw, 'layers')
    const layersRecord = candidateLayers !== null
      && typeof candidateLayers === 'object'
      && !Array.isArray(candidateLayers)
      ? candidateLayers as Record<string, unknown>
      : null
    const layers = Object.freeze(Object.fromEntries(VIEWPORT_LAYERS_V4.map((layer) => [
      layer,
      layersRecord !== null && typeof ownValueV4(layersRecord, layer) === 'boolean'
        ? ownValueV4(layersRecord, layer) as boolean
        : true,
    ]))) as Readonly<Record<ViewportLayerV4, boolean>>
    return {
      layers,
      gizmoFrame: ownValueV4(raw, 'gizmoFrame') === 'parent' ? 'parent' : 'world',
      cameraState: normalizedCameraStateV4(ownValueV4(raw, 'cameraState'))
        ?? DEFAULT_VIEWPORT_CAMERA_STATE_V4,
    }
  } catch {
    return {
      layers: DEFAULT_LAYERS_V4,
      gizmoFrame: 'world',
      cameraState: DEFAULT_VIEWPORT_CAMERA_STATE_V4,
    }
  }
}

function readPreferencesV4(storage: Storage | null): StoredViewportPreferencesV4 {
  if (storage === null) return normalizePreferencesV4(null)
  try {
    const raw = storage.getItem(VIEWPORT_PREFERENCE_STORAGE_KEY_V4)
    return normalizePreferencesV4(raw === null ? null : JSON.parse(raw))
  } catch {
    return normalizePreferencesV4(null)
  }
}

function persistPreferencesV4(
  storage: Storage | null,
  state: StoredViewportPreferencesV4,
): void {
  if (storage === null) return
  try {
    storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY_V4, JSON.stringify({
      layers: state.layers,
      gizmoFrame: state.gizmoFrame,
      cameraState: state.cameraState,
    }))
  } catch {
    // Generic view preferences remain available in memory when storage is unavailable.
  }
}

export function createViewportPreferenceStoreV4(
  storage: Storage | null,
): ViewportPreferenceStoreV4 {
  const initial = readPreferencesV4(storage)
  return createStore<ViewportPreferenceStateV4>()((set, get) => ({
    ...initial,
    setLayer: (layer, visible) => {
      if (!VIEWPORT_LAYERS_V4.includes(layer) || typeof visible !== 'boolean') return
      const layers = Object.freeze({ ...get().layers, [layer]: visible })
      set({ layers })
      persistPreferencesV4(storage, { ...get(), layers })
    },
    setGizmoFrame: (gizmoFrame) => {
      const normalized = gizmoFrame === 'parent' ? 'parent' : 'world'
      set({ gizmoFrame: normalized })
      persistPreferencesV4(storage, { ...get(), gizmoFrame: normalized })
    },
    setCameraState: (cameraState) => {
      const normalized = normalizedCameraStateV4(cameraState)
        ?? DEFAULT_VIEWPORT_CAMERA_STATE_V4
      set({ cameraState: normalized })
      persistPreferencesV4(storage, { ...get(), cameraState: normalized })
    },
  }))
}
