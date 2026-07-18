import { useRef, type KeyboardEvent, type ReactNode } from 'react'

import type { BottomWorkspaceTabV4 } from './v4/bottom-workspace-tab.js'

export type BottomWorkspaceTab = BottomWorkspaceTabV4

export interface BottomWorkspaceProps {
  readonly activeTab: BottomWorkspaceTabV4
  readonly onActiveTabChange: (tab: BottomWorkspaceTabV4) => void
  readonly timeline?: ReactNode
  readonly collision?: ReactNode
  readonly collisionCount?: number
}

export function BottomWorkspace({
  activeTab,
  onActiveTabChange,
  timeline = null,
  collision = null,
  collisionCount = 0,
}: BottomWorkspaceProps) {
  const timelineTabRef = useRef<HTMLButtonElement>(null)
  const collisionTabRef = useRef<HTMLButtonElement>(null)

  const selectTab = (tab: BottomWorkspaceTabV4) => {
    onActiveTabChange(tab)
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
