import { describe, expect, it } from 'vitest'
import { createViewportPreferenceStore, VIEWPORT_PREFERENCE_STORAGE_KEY } from './viewport-preference-store'

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

describe('viewport preference store', () => {
  it('persists display layers, frame choices, and camera state outside Project V3', () => {
    const storage = memoryStorage()
    const store = createViewportPreferenceStore(storage)

    store.getState().setLayer('grid', false)
    store.getState().setLayer('tcpFrame', true)
    store.getState().setPoseFrame('mcp')
    store.getState().setGizmoFrame('parent')
    store.getState().setCameraState({
      position: [3, 4, 5], target: [1, 2, 3], quaternion: [0.5, 0.5, 0.5, 0.5],
      up: [0, 1, 0], zoom: 1.5, fov: 55, near: 0.02, far: 250,
    })

    const restored = createViewportPreferenceStore(storage).getState()
    expect(restored.layers).toEqual({ grid: false, worldFrame: true, baseFrame: true, tcpFrame: true })
    expect(restored.poseFrame).toBe('mcp')
    expect(restored.gizmoFrame).toBe('parent')
    expect(restored.cameraState.position).toEqual([3, 4, 5])
    expect(restored.cameraState).toMatchObject({
      quaternion: [0.5, 0.5, 0.5, 0.5], up: [0, 1, 0], fov: 55, near: 0.02, far: 250,
    })
    expect(storage.getItem(VIEWPORT_PREFERENCE_STORAGE_KEY)).toContain('tcpFrame')
    expect(Array.from({ length: storage.length }, (_, index) => storage.key(index)))
      .not.toContain('robot-sim.active-project')
  })

  it('normalizes invalid local data back to safe defaults', () => {
    const storage = memoryStorage()
    storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY, JSON.stringify({
      layers: { grid: 'yes' }, poseFrame: 'tool', gizmoFrame: 'tcp', cameraState: null,
    }))

    const state = createViewportPreferenceStore(storage).getState()
    expect(state.layers).toEqual({ grid: true, worldFrame: true, baseFrame: true, tcpFrame: true })
    expect(state.poseFrame).toBe('world')
    expect(state.gizmoFrame).toBe('world')
  })

  it('rejects degenerate persisted camera orientation vectors', () => {
    for (const cameraVector of [
      { quaternion: [0, 0, 0, 0], up: [0, 1, 0] },
      { quaternion: [0, 0, 0, 1], up: [1e-14, 0, 0] },
    ]) {
      const storage = memoryStorage()
      storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY, JSON.stringify({
        cameraState: {
          position: [3, 4, 5], target: [1, 2, 3], zoom: 1.5,
          fov: 55, near: 0.02, far: 250, ...cameraVector,
        },
      }))

      const state = createViewportPreferenceStore(storage).getState()
      expect(state.cameraState.position).toEqual([2.2, 1.8, 1.7])
    }
  })

  it('normalizes accepted persisted camera quaternion and up vectors', () => {
    const storage = memoryStorage()
    storage.setItem(VIEWPORT_PREFERENCE_STORAGE_KEY, JSON.stringify({
      cameraState: {
        position: [3, 4, 5], target: [1, 2, 3], quaternion: [0, 0, 0, 2],
        up: [0, 3, 0], zoom: 1.5, fov: 55, near: 0.02, far: 250,
      },
    }))

    const state = createViewportPreferenceStore(storage).getState()
    expect(state.cameraState.quaternion).toEqual([0, 0, 0, 1])
    expect(state.cameraState.up).toEqual([0, 1, 0])
  })
})
