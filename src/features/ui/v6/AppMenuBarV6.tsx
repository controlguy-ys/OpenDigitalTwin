import { useEffect, useState } from 'react'

import type { AppCommandIdV6, AppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'

export interface V6TransientUiPort {
  hasActiveTransient(): boolean
  closeActiveTransient(): void
}

export interface AppMenuBarV6Props {
  readonly registry: AppCommandRegistryV6
  readonly transientUi?: V6TransientUiPort
  readonly onRequestContextMenu?: () => void
}

const MENU_COMMANDS: Readonly<Record<string, readonly AppCommandIdV6[]>> = Object.freeze({
  Project: ['project.new', 'project.loadDemo', 'project.save', 'project.export', 'project.import'],
  Home: ['tool.select', 'tool.translate', 'tool.rotate', 'view.focusSelection', 'view.fitAll'],
  Model: ['model.addBox', 'model.addCylinder'],
  Job: ['job.openEditor', 'job.start', 'job.cancel'],
  Simulation: [],
  Connectivity: [],
  View: ['view.focusSelection', 'view.fitAll', 'view.main.maximize', 'view.layout.reset', 'view.theme.system', 'view.theme.dark', 'view.theme.light'],
  Help: ['help.controls', 'help.about'],
})

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function AppMenuBarV6({ registry, transientUi, onRequestContextMenu }: AppMenuBarV6Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [, refresh] = useState(0)
  const invoke = async (id: AppCommandIdV6, trigger?: HTMLElement) => {
    await registry.invoke(id)
    refresh((value) => value + 1)
    if (trigger !== undefined) {
      setOpenMenu(null)
      requestAnimationFrame(() => trigger.focus())
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || isEditableTarget(event.target)) return
      if (event.key === 'Escape') {
        if (openMenu !== null) {
          event.preventDefault()
          setOpenMenu(null)
        } else if (transientUi?.hasActiveTransient() === true) {
          event.preventDefault()
          transientUi.closeActiveTransient()
        } else if (registry.get('view.main.maximize')?.checked === true) {
          event.preventDefault()
          void invoke('view.main.maximize')
        }
        return
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 's') {
        const save = registry.get('project.save')
        if (save?.enabled === true && save.visible) {
          event.preventDefault()
          void invoke('project.save')
        }
        return
      }
      if (event.key === 'F1') {
        const controls = registry.get('help.controls')
        if (controls?.enabled === true && controls.visible) {
          event.preventDefault()
          void invoke('help.controls')
        }
        return
      }
      if (event.shiftKey && event.key === 'F10' && onRequestContextMenu !== undefined) {
        event.preventDefault()
        onRequestContextMenu()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onRequestContextMenu, openMenu, registry, transientUi])

  return (
    <nav aria-label="Application commands">
      <div aria-label="Application menu" role="menubar">
        {Object.entries(MENU_COMMANDS).map(([menu, commandIds]) => {
          const open = openMenu === menu
          const triggerId = `v6-menu-trigger-${menu.toLowerCase()}`
          return <span key={menu}>
            <button
              aria-expanded={open}
              aria-haspopup="menu"
              id={triggerId}
              onClick={() => setOpenMenu(open ? null : menu)}
              role="menuitem"
              type="button"
            >{menu}</button>
            {open && <div aria-label={`${menu} menu`} role="menu">
              {commandIds.map((id) => {
                const command = registry.get(id)
                if (command === null || !command.visible) return null
                return <button
                  aria-checked={command.checked}
                  data-command-id={command.id}
                  disabled={!command.enabled}
                  key={command.id}
                  onClick={() => {
                    const trigger = document.getElementById(triggerId)
                    void invoke(command.id, trigger ?? undefined)
                  }}
                  role="menuitem"
                  type="button"
                >{command.label}</button>
              })}
            </div>}
          </span>
        })}
      </div>
    </nav>
  )
}
