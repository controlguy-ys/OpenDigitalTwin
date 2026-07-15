import { useEffect, useState, type ReactNode } from 'react'

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

  return (
    <div className="bottom-workspace">
      <div aria-label="Bottom workspace" className="bottom-workspace-tabs" role="tablist">
        <button
          aria-controls="timeline-workspace-panel"
          aria-selected={activeTab === 'timeline'}
          id="timeline-workspace-tab"
          onClick={() => selectTab('timeline')}
          role="tab"
          type="button"
        >
          Timeline
        </button>
        <button
          aria-controls="collision-workspace-panel"
          aria-selected={activeTab === 'collision'}
          id="collision-workspace-tab"
          onClick={() => selectTab('collision')}
          role="tab"
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
