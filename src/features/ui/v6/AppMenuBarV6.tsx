import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import type {
  AppCommandIdV6,
  AppCommandRegistryV6,
  AppCommandSurfaceV6,
} from '../../commands/v6/app-command-v6.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'
import { ConnectivityMenuV6, type ConnectivityMenuV6Props } from '../../connectivity/v6/ConnectivityMenuV6.js'
import {
  CommandSurfaceControlV6,
  invokeCommandSurfaceV6,
} from './CommandSurfaceControlV6.js'

export interface V6TransientUiPort {
  hasActiveTransient(): boolean
  closeActiveTransient(): void
}

export type V6ContextMenuTargetV6 =
  | { readonly kind: 'explorer-row'; readonly rowKey: string }
  | { readonly kind: 'selection'; readonly selection: V6WorkcellSelection }

export interface V6KeyboardContextMenuPortV6 {
  resolveTarget(): V6ContextMenuTargetV6 | null
  requestOpen(target: V6ContextMenuTargetV6): void
}

export interface AppMenuBarV6Props {
  readonly registry: AppCommandRegistryV6
  readonly transientUi?: V6TransientUiPort
  readonly contextMenu?: V6KeyboardContextMenuPortV6
  readonly connectivity?: ConnectivityMenuV6Props
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
const MENU_NAMES = Object.freeze(Object.keys(MENU_COMMANDS))

const MENU_SURFACES: Readonly<Record<string, AppCommandSurfaceV6 | undefined>> = Object.freeze({
  Project: 'project-menu',
  Home: 'home-menu',
  Model: 'model-menu',
  Job: 'job-menu',
  Simulation: undefined,
  Connectivity: undefined,
  View: 'view-menu',
  Help: 'help-menu',
})

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function AppMenuBarV6({ registry, transientUi, contextMenu, connectivity }: AppMenuBarV6Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [activeMenuIndex, setActiveMenuIndex] = useState(0)
  const invoke = async (id: AppCommandIdV6, trigger?: HTMLElement) => {
    await invokeCommandSurfaceV6(registry, id)
    if (trigger !== undefined) {
      setOpenMenu(null)
      requestAnimationFrame(() => trigger.focus())
    }
  }
  const normalizedMenuIndex = (index: number) => (
    (index + MENU_NAMES.length) % MENU_NAMES.length
  )
  const focusMenuTrigger = (index: number, keepMenuOpen: boolean) => {
    const nextIndex = normalizedMenuIndex(index)
    const nextMenu = MENU_NAMES[nextIndex]!
    setActiveMenuIndex(nextIndex)
    setOpenMenu(keepMenuOpen ? nextMenu : null)
    document.getElementById(`v6-menu-trigger-${nextMenu.toLowerCase()}`)?.focus()
  }
  const openMenuAndFocusFirst = (menu: string) => {
    setOpenMenu(menu)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        `#v6-menu-${menu.toLowerCase()} [role^="menuitem"]`,
      )?.focus()
    })
  }
  const onTopLevelKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    menu: string,
    index: number,
  ) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusMenuTrigger(
        index + (event.key === 'ArrowRight' ? 1 : -1),
        openMenu !== null,
      )
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (openMenu === menu && (event.key === 'Enter' || event.key === ' ')) {
        setOpenMenu(null)
      } else {
        openMenuAndFocusFirst(menu)
      }
      return
    }
    if (event.key === 'Escape' && openMenu !== null) {
      event.preventDefault()
      setOpenMenu(null)
      event.currentTarget.focus()
    }
  }
  const onMenuItemKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpenMenu(null)
      const menu = MENU_NAMES[index]!
      document.getElementById(`v6-menu-trigger-${menu.toLowerCase()}`)?.focus()
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      focusMenuTrigger(index + (event.key === 'ArrowRight' ? 1 : -1), true)
    }
  }
  const stableMenuTrigger = (triggerId: string, fallback: HTMLButtonElement): HTMLButtonElement => {
    const trigger = document.getElementById(triggerId)
    return trigger instanceof HTMLButtonElement ? trigger : fallback
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return
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
      if (isEditableTarget(event.target)) return
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
      if (event.shiftKey && event.key === 'F10' && contextMenu !== undefined) {
        const target = contextMenu.resolveTarget()
        if (target !== null) {
          event.preventDefault()
          contextMenu.requestOpen(target)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, openMenu, registry, transientUi])

  return (
    <nav aria-label="Application commands">
      <div aria-label="Application menu" role="menubar">
        {Object.entries(MENU_COMMANDS).map(([menu, commandIds], index) => {
          const open = openMenu === menu
          const triggerId = `v6-menu-trigger-${menu.toLowerCase()}`
          const surface = MENU_SURFACES[menu]
          return <span key={menu}>
            <button
              aria-expanded={open}
              aria-haspopup="menu"
              id={triggerId}
              onClick={() => {
                setActiveMenuIndex(index)
                setOpenMenu(open ? null : menu)
              }}
              onFocus={() => setActiveMenuIndex(index)}
              onKeyDown={(event) => onTopLevelKeyDown(event, menu, index)}
              role="menuitem"
              tabIndex={activeMenuIndex === index ? 0 : -1}
              type="button"
            >{menu}</button>
            {open && <div aria-label={`${menu} menu`} id={`v6-menu-${menu.toLowerCase()}`} role="menu">
              {menu === 'Connectivity' && connectivity !== undefined
                ? <ConnectivityMenuV6
                    {...connectivity}
                    onMenuItemKeyDown={(event) => onMenuItemKeyDown(event, index)}
                    onOpenBindingOverview={(opener) => {
                      connectivity.onOpenBindingOverview(stableMenuTrigger(triggerId, opener))
                      setOpenMenu(null)
                    }}
                    onOpenConnectionMonitor={(opener) => {
                      connectivity.onOpenConnectionMonitor(stableMenuTrigger(triggerId, opener))
                      setOpenMenu(null)
                    }}
                    onOpenDockerRunGuide={(opener) => {
                      connectivity.onOpenDockerRunGuide(stableMenuTrigger(triggerId, opener))
                      setOpenMenu(null)
                    }}
                    onOpenOpcUaSettings={(opener) => {
                      connectivity.onOpenOpcUaSettings(stableMenuTrigger(triggerId, opener))
                      setOpenMenu(null)
                    }}
                    presentation="menu"
                  />
                : commandIds.map((id) => {
                if (surface === undefined) return null
                return <CommandSurfaceControlV6
                  commandId={id}
                  key={id}
                  onInvoked={() => {
                    const trigger = document.getElementById(triggerId)
                    setOpenMenu(null)
                    requestAnimationFrame(() => trigger?.focus())
                  }}
                  onKeyDown={(event) => onMenuItemKeyDown(event, index)}
                  registry={registry}
                  surface={surface}
                  tabIndex={-1}
                />
              })}
            </div>}
          </span>
        })}
      </div>
    </nav>
  )
}

export { MainViewPaneToolbarCommandV6 } from './MainViewPaneToolbarCommandV6.js'
export type { MainViewPaneToolbarCommandV6Props } from './MainViewPaneToolbarCommandV6.js'
