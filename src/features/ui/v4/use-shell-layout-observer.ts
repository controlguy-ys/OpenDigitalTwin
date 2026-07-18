import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type {
  ShellLayoutControllerSnapshotV4,
  ShellLayoutControllerV4,
} from './shell-layout-controller.js'

export interface ShellLayoutObserverResultV4 {
  readonly workspaceRef: (element: HTMLElement | null) => void
  readonly snapshot: ShellLayoutControllerSnapshotV4
}

export function useShellLayoutObserverV4(
  controller: ShellLayoutControllerV4,
): ShellLayoutObserverResultV4 {
  const [workspace, setWorkspace] = useState<HTMLElement | null>(null)
  const workspaceRef = useCallback((element: HTMLElement | null) => setWorkspace(element), [])
  const snapshot = useSyncExternalStore(
    useCallback((listener) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
    useCallback(() => controller.getState(), [controller]),
  )

  useEffect(() => {
    if (workspace === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === workspace) ?? entries[0]
      if (entry === undefined) return
      controller.setBounds(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [controller, workspace])

  return { workspaceRef, snapshot }
}
