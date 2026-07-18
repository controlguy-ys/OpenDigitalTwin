import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'

import type { BottomWorkspaceTabV4 } from './v4/bottom-workspace-tab.js'
import type { ShellLayoutStoreV4 } from './v4/shell-layout-store.js'

export type BottomWorkspaceTab = BottomWorkspaceTabV4

export interface BottomWorkspaceProps {
  readonly shellLayoutStore: ShellLayoutStoreV4
  readonly timeline?: ReactNode
  readonly collision?: ReactNode
  readonly collisionCount?: number
  readonly collisionOpenRequest?: number
}

export function BottomWorkspace({
  shellLayoutStore,
  timeline = null,
  collision = null,
  collisionCount = 0,
  collisionOpenRequest = 0,
}: BottomWorkspaceProps) {
  const activeTab = useStore(
    shellLayoutStore,
    (state) => state.preferences.bottom.activeTab,
  )
  const timelineTabRef = useRef<HTMLButtonElement>(null)
  const collisionTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (collisionOpenRequest <= 0) return
    shellLayoutStore.getState().setBottomTab('collision')
  }, [collisionOpenRequest, shellLayoutStore])

  const selectTab = (tab: BottomWorkspaceTabV4) => {
    shellLayoutStore.getState().setBottomTab(tab)
  }

  const selectAndFocus = (tab: BottomWorkspaceTab) => {
    selectTab(tab)
    const target = tab === 'timeline' ? timelineTabRef.current : collisionTabRef.current
    target?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: BottomWorkspaceTabV4 | null = null
    if (event.key === 'Home') next = 'timeline'
    else if (event.key === 'End') next = 'collision'
    else if (event.key === 'ArrowRight') {
      next = activeTab === 'timeline' ? 'collision' : 'timeline'
    } else if (event.key === 'ArrowLeft') {
      next = activeTab === 'timeline' ? 'collision' : 'timeline'
    }
    if (next === null) return
    event.preventDefault()
    selectAndFocus(next)
  }

  return (
    <div className="bottom-workspace">
      <div aria-label="Bottom workspace" className="bottom-workspace-tabs" role="tablist">
        <button
          aria-controls="timeline-workspace-panel"
          aria-selected={activeTab === 'timeline'}
          id="timeline-workspace-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => selectTab('timeline')}
          ref={timelineTabRef}
          role="tab"
          tabIndex={activeTab === 'timeline' ? 0 : -1}
          type="button"
        >
          Timeline
        </button>
        <button
          aria-controls="collision-workspace-panel"
          aria-selected={activeTab === 'collision'}
          id="collision-workspace-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => selectTab('collision')}
          ref={collisionTabRef}
          role="tab"
          tabIndex={activeTab === 'collision' ? 0 : -1}
          type="button"
        >
          Collision <span className="bottom-workspace-badge">{collisionCount}</span>
        </button>
      </div>
      {activeTab === 'timeline' ? (
        <section
          aria-label="Timeline"
          className="bottom-workspace-panel"
          id="timeline-workspace-panel"
          role="tabpanel"
        >
          {timeline}
        </section>
      ) : (
        <section
          aria-label="Collision"
          className="bottom-workspace-panel"
          id="collision-workspace-panel"
          role="tabpanel"
        >
          {collision}
        </section>
      )}
    </div>
  )
}
