import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import type {
  AppCommandIdV6,
  AppCommandRegistryV6,
} from '../../commands/v6/app-command-v6.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'
import { ConnectivityMenuV6, type ConnectivityMenuV6Props } from '../../connectivity/v6/ConnectivityMenuV6.js'
import {
  isEditableMenuTargetV6,
  MENU_COMMANDS_V6,
  MENU_NAMES_V6,
  MENU_SURFACES_V6,
} from './app-menu-bar-config-v6.js'
import {
  CommandSurfaceControlV6,
  invokeCommandSurfaceV6,
} from './CommandSurfaceControlV6.js'
import { ButtonV6 } from './ButtonV6.js'

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

export function AppMenuBarV6({ registry, transientUi, contextMenu, connectivity }: AppMenuBarV6Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [overflowMenu, setOverflowMenu] = useState<string | null>(null)
  const [activeMenuIndex, setActiveMenuIndex] = useState(0)
  const [narrowSurface, setNarrowSurface] = useState(false)
  const overflowTriggerId = 'v6-menu-overflow-trigger'
  const invoke = async (id: AppCommandIdV6, trigger?: HTMLElement) => {
    await invokeCommandSurfaceV6(registry, id)
    if (trigger !== undefined) {
      setOpenMenu(null)
      requestAnimationFrame(() => trigger.focus())
    }
  }
  const normalizedMenuIndex = (index: number) => (
    (index + MENU_NAMES_V6.length) % MENU_NAMES_V6.length
  )
  const focusMenuTrigger = (index: number, keepMenuOpen: boolean) => {
    if (narrowSurface) {
      setOpenMenu(null)
      setOverflowOpen(keepMenuOpen)
      setOverflowMenu(null)
      requestAnimationFrame(focusOverflowTrigger)
      return
    }
    const nextIndex = normalizedMenuIndex(index)
    const nextMenu = MENU_NAMES_V6[nextIndex]!
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
  const focusOverflowTrigger = () => {
    document.getElementById(overflowTriggerId)?.focus()
  }
  const openOverflowMenu = () => {
    setOverflowOpen(true)
    setOverflowMenu(null)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#v6-menu-overflow [role="menuitem"]')?.focus()
    })
  }
  const openOverflowSubmenu = (menu: string) => {
    setOverflowOpen(true)
    setOverflowMenu(menu)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(
        `#v6-menu-overflow [role="menuitem"]:not([data-overflow-back])`,
      )?.focus()
    })
  }
  const onOverflowTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      if (!overflowOpen) openOverflowMenu()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (overflowOpen) {
        setOverflowOpen(false)
        setOverflowMenu(null)
      }
      else openOverflowMenu()
      return
    }
    if (event.key === 'Escape' && overflowOpen) {
      event.preventDefault()
      setOverflowOpen(false)
      setOverflowMenu(null)
      event.currentTarget.focus()
    }
  }
  const onOverflowItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOverflowOpen(false)
      setOverflowMenu(null)
      focusOverflowTrigger()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]')
      const items = menu === null
        ? []
        : Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      const index = items.indexOf(event.currentTarget)
      if (index >= 0 && items.length > 0) {
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.currentTarget.dataset.overflowMenu !== undefined) {
      event.preventDefault()
      openOverflowSubmenu(event.currentTarget.dataset.overflowMenu)
    }
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
      const menu = MENU_NAMES_V6[index]!
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
    const shell = document.querySelector<HTMLElement>('[data-testid="v6-application-shell"]')
    if (shell === null) return undefined
    const update = () => setNarrowSurface(shell.dataset.workspaceMode === 'narrow')
    update()
    const observer = new MutationObserver(update)
    observer.observe(shell, { attributes: true, attributeFilter: ['data-workspace-mode'] })
    return () => observer.disconnect()
  }, [])

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
      if (isEditableMenuTargetV6(event.target)) return
      if (event.key === 'Escape') {
        if (openMenu !== null) {
          event.preventDefault()
          setOpenMenu(null)
        } else if (overflowOpen) {
          event.preventDefault()
          setOverflowOpen(false)
          setOverflowMenu(null)
          requestAnimationFrame(focusOverflowTrigger)
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
  }, [contextMenu, narrowSurface, openMenu, overflowOpen, registry, transientUi])

  const renderOverflowMenu = () => {
    if (overflowMenu === null) {
      return MENU_NAMES_V6.map((menu) => <ButtonV6
        className="v6-overflow-menu-item"
        data-overflow-menu={menu}
        key={menu}
        onClick={() => openOverflowSubmenu(menu)}
        onKeyDown={onOverflowItemKeyDown}
        role="menuitem"
        size="compact"
        tabIndex={-1}
        variant="ghost"
      >{menu}</ButtonV6>)
    }
    const menu = overflowMenu
    const commandIds = MENU_COMMANDS_V6[menu] ?? []
    const surface = MENU_SURFACES_V6[menu]
    return <>
      <ButtonV6
        aria-label="Back to More menus"
        className="v6-overflow-menu-item"
        data-overflow-back="true"
        onClick={() => {
          setOverflowMenu(null)
          requestAnimationFrame(() => document.querySelector<HTMLElement>('#v6-menu-overflow [role="menuitem"]')?.focus())
        }}
        onKeyDown={onOverflowItemKeyDown}
        role="menuitem"
        size="compact"
        tabIndex={-1}
        variant="ghost"
      >Back to menus</ButtonV6>
      <span aria-hidden="true" className="v6-overflow-menu-heading">{menu}</span>
      {menu === 'Connectivity' && connectivity !== undefined
        ? <ConnectivityMenuV6
            {...connectivity}
            onMenuItemKeyDown={onOverflowItemKeyDown}
            onOpenBindingOverview={(opener) => {
              connectivity.onOpenBindingOverview(stableMenuTrigger(overflowTriggerId, opener))
              setOverflowOpen(false)
              setOverflowMenu(null)
              requestAnimationFrame(focusOverflowTrigger)
            }}
            onOpenConnectionMonitor={(opener) => {
              connectivity.onOpenConnectionMonitor(stableMenuTrigger(overflowTriggerId, opener))
              setOverflowOpen(false)
              setOverflowMenu(null)
              requestAnimationFrame(focusOverflowTrigger)
            }}
            onOpenDockerRunGuide={(opener) => {
              connectivity.onOpenDockerRunGuide(stableMenuTrigger(overflowTriggerId, opener))
              setOverflowOpen(false)
              setOverflowMenu(null)
              requestAnimationFrame(focusOverflowTrigger)
            }}
            onOpenOpcUaSettings={(opener) => {
              connectivity.onOpenOpcUaSettings(stableMenuTrigger(overflowTriggerId, opener))
              setOverflowOpen(false)
              setOverflowMenu(null)
              requestAnimationFrame(focusOverflowTrigger)
            }}
            presentation="menu"
          />
        : commandIds.map((id) => surface === undefined ? null : <CommandSurfaceControlV6
            commandId={id}
            key={id}
            onInvoked={() => {
              setOverflowOpen(false)
              setOverflowMenu(null)
              requestAnimationFrame(focusOverflowTrigger)
            }}
            onKeyDown={onOverflowItemKeyDown}
            registry={registry}
            surface={surface}
            tabIndex={-1}
          />)}
    </>
  }

  return (
    <nav aria-label="Application commands">
      <div aria-label="Application menu" role="menubar">
        {Object.entries(MENU_COMMANDS_V6).map(([menu, commandIds], index) => {
          const open = openMenu === menu
          const triggerId = `v6-menu-trigger-${menu.toLowerCase()}`
          const surface = MENU_SURFACES_V6[menu]
          return <span className="v6-menu-anchor" key={menu}>
            <ButtonV6
              aria-expanded={open}
              aria-hidden={narrowSurface ? true : undefined}
              aria-haspopup="menu"
              className="v6-menu-trigger"
              id={triggerId}
              onClick={() => {
                setActiveMenuIndex(index)
                setOpenMenu(open ? null : menu)
              }}
              onFocus={() => setActiveMenuIndex(index)}
              onKeyDown={(event) => onTopLevelKeyDown(event, menu, index)}
              role="menuitem"
              tabIndex={narrowSurface ? -1 : activeMenuIndex === index ? 0 : -1}
              size="compact"
              variant="ghost"
            >{menu}</ButtonV6>
            {open && <div aria-label={`${menu} menu`} className="v6-menu-surface" id={`v6-menu-${menu.toLowerCase()}`} role="menu">
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
        <span className="v6-menu-anchor v6-menu-overflow-anchor">
          <ButtonV6
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
            aria-label="More menus"
            className="v6-menu-trigger v6-menu-overflow-trigger"
            id={overflowTriggerId}
            onClick={() => overflowOpen ? setOverflowOpen(false) : openOverflowMenu()}
            onKeyDown={onOverflowTriggerKeyDown}
            role="menuitem"
            size="compact"
            tabIndex={narrowSurface ? 0 : -1}
            variant="ghost"
          >More</ButtonV6>
          {overflowOpen && <div
            aria-label="More menus"
            className="v6-menu-surface v6-menu-overflow-surface"
            id="v6-menu-overflow"
            role="menu"
          >{renderOverflowMenu()}</div>}
        </span>
      </div>
    </nav>
  )
}

export { MainViewPaneToolbarCommandV6 } from './MainViewPaneToolbarCommandV6.js'
export type { MainViewPaneToolbarCommandV6Props } from './MainViewPaneToolbarCommandV6.js'
