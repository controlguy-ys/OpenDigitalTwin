import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type BottomWorkspaceTab = 'timeline' | 'collision'

const STORAGE_KEY = 'robotsim.bottomWorkspaceTab'

function readTab(): BottomWorkspaceTab {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collision' ? 'collision' : 'timeline'
  } catch {
    return 'timeline'
  }
}

export interface BottomWorkspaceProps {
  readonly timeline?: ReactNode
  readonly collision?: ReactNode
  readonly collisionCount?: number
  readonly collisionOpenRequest?: number
}

export function BottomWorkspace({
  timeline = null,
  collision = null,
  collisionCount = 0,
  collisionOpenRequest = 0,
}: BottomWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<BottomWorkspaceTab>(readTab)
  const timelineTabRef = useRef<HTMLButtonElement>(null)
  const collisionTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (collisionOpenRequest <= 0) return
    setActiveTab('collision')
    try {
      localStorage.setItem(STORAGE_KEY, 'collision')
    } catch {
      // Browser preferences are optional and never affect Project content.
    }
  }, [collisionOpenRequest])

  const selectTab = (tab: BottomWorkspaceTab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem(STORAGE_KEY, tab)
    } catch {
      // Browser preferences are optional and never affect Project content.
    }
  }

  const selectAndFocus = (tab: BottomWorkspaceTab) => {
    selectTab(tab)
    const target = tab === 'timeline' ? timelineTabRef.current : collisionTabRef.current
    target?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: BottomWorkspaceTab | null = null
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
