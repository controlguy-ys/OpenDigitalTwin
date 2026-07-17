import { describe, expect, it } from 'vitest'
import {
  createViewportPreferenceStoreV4,
  DEFAULT_VIEWPORT_CAMERA_STATE_V4,
  VIEWPORT_PREFERENCE_STORAGE_KEY_V4,
} from './viewport-preference-store'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('viewport preference store V4', () => {
  it('starts from generic camera, layer, and gizmo defaults without Project identity', () => {
    const state = createViewportPreferenceStoreV4(null).getState()

    expect(state.layers).toEqual({
      grid: true,
      worldFrame: true,
      mcpFrame: true,
      baseFrame: true,
      tcpFrame: true,
    })
    expect(state.gizmoFrame).toBe('world')
    expect(state.cameraState).toEqual(DEFAULT_VIEWPORT_CAMERA_STATE_V4)
    expect(Object.isFrozen(state.layers)).toBe(true)
    expect(Object.isFrozen(state.cameraState)).toBe(true)
  })

  it('persists only normalized generic view preferences under the V4 key', () => {
    const storage = memoryStorage()
    const store = createViewportPreferenceStoreV4(storage)

    store.getState().setLayer('mcpFrame', false)
    store.getState().setLayer('tcpFrame', false)
    store.getState().setGizmoFrame('parent')
    store.getState().setCameraState({
      position: [3, 4, 5],
      target: [1, 2, 3],
      quaternion: [0, 0, 0, 2],
      up: [0, 3, 0],
      zoom: 1.5,
      fov: 55,
      near: 0.02,
      far: 250,
    })

    const raw = storage.getItem(VIEWPORT_PREFERENCE_STORAGE_KEY_V4)
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw ?? '{}') as Record<string, unknown>
    expect(Object.keys(persisted).sort()).toEqual(['cameraState', 'gizmoFrame', 'layers'])
    expect(raw).not.toMatch(/project|revision|robot|frameId|selection|isolate|poseFrame/i)

    const restored = createViewportPreferenceStoreV4(storage).getState()
    expect(restored.layers).toEqual({
      grid: true,
      worldFrame: true,
      mcpFrame: false,
      baseFrame: true,
      tcpFrame: false,
    })
    expect(restored.gizmoFrame).toBe('parent')
    expect(restored.cameraState).toMatchObject({
      position: [3, 4, 5],
      target: [1, 2, 3],
      quaternion: [0, 0, 0, 1],
      up: [0, 1, 0],
      zoom: 1.5,
      fov: 55,
      near: 0.02,
      far: 250,
    })
  })

  it('normalizes partial or malformed persisted preferences independently', () => {
    const storage = memoryStorage()
    storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY_V4, JSON.stringify({
      layers: {
        grid: false,
        worldFrame: 'no',
        mcpFrame: false,
        baseFrame: 0,
        tcpFrame: true,
        arbitrary: false,
      },
      gizmoFrame: 'tcp',
      poseFrame: { kind: 'robot-frame', robotId: 'robot-a', frameId: 'tcp' },
      projectRevisionId: 'revision-secret',
      selection: { kind: 'robot', robotId: 'robot-a' },
      cameraState: null,
    }))

    const state = createViewportPreferenceStoreV4(storage).getState()
    expect(state.layers).toEqual({
      grid: false,
      worldFrame: true,
      mcpFrame: false,
      baseFrame: true,
      tcpFrame: true,
    })
    expect(state.gizmoFrame).toBe('world')
    expect(state.cameraState).toEqual(DEFAULT_VIEWPORT_CAMERA_STATE_V4)
    expect(state).not.toHaveProperty('poseFrame')
    expect(state).not.toHaveProperty('projectRevisionId')
    expect(state).not.toHaveProperty('selection')
  })

  it('rejects invalid camera scalars, tuples, and degenerate orientation vectors', () => {
    const invalidCameras = [
      { quaternion: [0, 0, 0, 0], up: [0, 1, 0] },
      { quaternion: [0, 0, 0, 1], up: [1e-14, 0, 0] },
      { quaternion: [0, 0, 0, 1], up: [0, 1, 0], near: 2, far: 1 },
      { quaternion: [0, 0, 0, 1], up: [0, 1, 0], fov: 180 },
    ]

    for (const camera of invalidCameras) {
      const storage = memoryStorage()
      storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY_V4, JSON.stringify({
        cameraState: {
          position: [3, 4, 5],
          target: [1, 2, 3],
          zoom: 1.5,
          fov: 55,
          near: 0.02,
          far: 250,
          ...camera,
        },
      }))

      expect(createViewportPreferenceStoreV4(storage).getState().cameraState)
        .toEqual(DEFAULT_VIEWPORT_CAMERA_STATE_V4)
    }
  })

  it('normalizes invalid setter input without making the in-memory store unusable', () => {
    const store = createViewportPreferenceStoreV4(null)
    store.getState().setCameraState({
      ...DEFAULT_VIEWPORT_CAMERA_STATE_V4,
      quaternion: [0, 0, 0, 0],
    })

    expect(store.getState().cameraState).toEqual(DEFAULT_VIEWPORT_CAMERA_STATE_V4)
    store.getState().setLayer('grid', false)
    expect(store.getState().layers.grid).toBe(false)
  })

  it('falls back when storage reads or writes fail', () => {
    const storage: Storage = {
      get length(): number { throw new Error('blocked') },
      clear: () => { throw new Error('blocked') },
      getItem: () => { throw new Error('blocked') },
      key: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    const store = createViewportPreferenceStoreV4(storage)

    expect(store.getState().cameraState).toEqual(DEFAULT_VIEWPORT_CAMERA_STATE_V4)
    expect(() => store.getState().setLayer('worldFrame', false)).not.toThrow()
    expect(store.getState().layers.worldFrame).toBe(false)
  })
})
