import { Play, Save, Square, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'
import { AppMenuBarV4 } from './AppMenuBarV4.js'
import type { AppMenuSectionModelV4 } from './app-menu-model.js'
import type { AppHeaderStatusV4 } from './app-header-status.js'
import { CompactAppMenuV4 } from './CompactAppMenuV4.js'
import { RibbonLiteV4 } from './RibbonLiteV4.js'
import type { RibbonContextV4 } from './ribbon-model-v4.js'
import type { ShellLayoutControllerV4 } from './shell-layout-controller.js'

export interface StudioHeaderPropsV4 {
  readonly status: AppHeaderStatusV4
  readonly menuModel: readonly AppMenuSectionModelV4[]
  readonly commandBindings: AppCommandBindingsV4
  readonly quickActionIds: readonly ['project.save', 'job.start', 'job.cancel']
  readonly ribbonContext: Omit<RibbonContextV4, 'previewSection'>
  readonly shellLayoutController: ShellLayoutControllerV4
  readonly gatewayDetailsOpen: boolean
  readonly onGatewayDetailsOpenChange: (open: boolean) => void
}

const QUICK_ACTION_ICONS_V4: Readonly<Record<StudioHeaderPropsV4['quickActionIds'][number], LucideIcon>> = Object.freeze({
  'project.save': Save,
  'job.start': Play,
  'job.cancel': Square,
})

function idPartV4(id: string): string { return id.replace(/[^a-zA-Z0-9_-]/g, '-') }

function useShellSnapshotV4(controller: ShellLayoutControllerV4) {
  return useSyncExternalStore(
    useCallback((listener) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
    useCallback(() => controller.getState(), [controller]),
  )
}

function QuickActionV4({ commandBindings, commandId }: {
  readonly commandBindings: AppCommandBindingsV4
  readonly commandId: StudioHeaderPropsV4['quickActionIds'][number]
}): ReactNode {
  const { command, pending, error, invoke } = useAppCommandV4(commandBindings, commandId)
  if (command === null || command.visible !== true) return null
  const Icon = QUICK_ACTION_ICONS_V4[commandId]
  const disabled = command.enabled !== true || pending
  const errorId = `studio-header-command-error-${idPartV4(commandId)}`
  return <>
    <button
      aria-busy={pending || undefined}
      aria-describedby={error === null ? undefined : errorId}
      aria-label={command.label}
      className="studio-header-quick-action-v4"
      disabled={disabled}
      onClick={() => { if (!disabled) void invoke() }}
      title={pending ? 'Command in progress.' : command.disabledReason ?? command.label}
      type="button"
    ><Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
    {error === null ? null : <span id={errorId} className="studio-header-command-error-v4" role="alert">{error}</span>}
  </>
}

function RibbonToggleV4({ commandBindings }: { readonly commandBindings: AppCommandBindingsV4 }): ReactNode {
  const { command, pending, error, invoke } = useAppCommandV4(commandBindings, 'view.ribbon')
  if (command === null || command.visible !== true) return null
  const disabled = command.enabled !== true || pending
  const errorId = 'studio-header-command-error-view-ribbon'
  return <>
    <button
      aria-busy={pending || undefined}
      aria-controls="ribbon-lite-v4"
      aria-describedby={error === null ? undefined : errorId}
      aria-label={command.label}
      aria-pressed={command.checked === true}
      className="studio-header-ribbon-toggle-v4"
      data-checked={command.checked === true || undefined}
      disabled={disabled}
      onClick={() => { if (!disabled) void invoke() }}
      title={pending ? 'Command in progress.' : command.disabledReason ?? command.label}
      type="button"
    >Ribbon</button>
    {error === null ? null : <span id={errorId} className="studio-header-command-error-v4" role="alert">{error}</span>}
  </>
}

function statusLabelsV4(status: AppHeaderStatusV4, compact: boolean): {
  readonly simulation: string
  readonly joint: string
  readonly gateway: string
} {
  const joint = status.jointSource.activeRobotName === null
    ? 'No active Robot'
    : compact || status.jointSource.sourceLabel === null
      ? status.jointSource.activeRobotName
      : `${status.jointSource.activeRobotName} · ${status.jointSource.sourceLabel}`
  return Object.freeze({
    simulation: compact ? `Jobs: ${status.simulation.runningJobCount}` : `Running Jobs: ${status.simulation.runningJobCount}`,
    joint,
    gateway: compact
      ? `Gateway: ${status.gateway.statusLabel}`
      : `${status.gateway.modeLabel} · ${status.gateway.statusLabel}`,
  })
}

export function StudioHeaderV4({
  status,
  menuModel,
  commandBindings,
  quickActionIds,
  ribbonContext,
  shellLayoutController,
  gatewayDetailsOpen,
  onGatewayDetailsOpenChange,
}: StudioHeaderPropsV4): ReactNode {
  const snapshot = useShellSnapshotV4(shellLayoutController)
  const [openSection, setOpenSection] = useState<AppCommandSectionV4 | null>(null)
  const [previewSection, setPreviewSection] = useState<AppCommandSectionV4 | null>(null)
  const gatewayTriggerRef = useRef<HTMLButtonElement>(null)
  const gatewayDetailsRef = useRef<HTMLDivElement>(null)
  const gatewayWasOpenRef = useRef(false)
  const compact = snapshot.mode !== 'wide'
  const labels = statusLabelsV4(status, compact)
  const Menu = compact ? CompactAppMenuV4 : AppMenuBarV4
  const context: RibbonContextV4 = { ...ribbonContext, previewSection }
  const gatewayEndpoint = status.gateway.endpoint ?? 'Not configured'

  useLayoutEffect(() => {
    if (gatewayDetailsOpen && !gatewayWasOpenRef.current) {
      gatewayDetailsRef.current?.focus()
    } else if (!gatewayDetailsOpen && gatewayWasOpenRef.current) {
      gatewayTriggerRef.current?.focus()
    }
    gatewayWasOpenRef.current = gatewayDetailsOpen
  }, [gatewayDetailsOpen])

  useEffect(() => {
    if (!gatewayDetailsOpen) return
    const dismiss = (event: PointerEvent): void => {
      if (gatewayTriggerRef.current?.contains(event.target as Node) === true) return
      if (gatewayDetailsRef.current?.contains(event.target as Node) === true) return
      onGatewayDetailsOpenChange(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      onGatewayDetailsOpenChange(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [gatewayDetailsOpen, onGatewayDetailsOpenChange])

  return <header className="studio-header-v4" data-layout-mode={snapshot.mode}>
    <div className="studio-header-main-v4">
      <strong className="studio-header-product-v4">RobotSim</strong>
      <span className="studio-header-project-name-v4" data-testid="project-name" title={status.project.name}>{status.project.name}</span>
      <span className="studio-header-project-phase-v4" data-phase={status.project.phase}>{status.project.saved ? 'Saved' : status.project.phase}</span>
      <Menu
        commandBindings={commandBindings}
        model={menuModel}
        onOpenSectionChange={setOpenSection}
        onPreviewSection={setPreviewSection}
        openSection={openSection}
      />
      <div aria-label="Quick Actions" className="studio-header-quick-actions-v4">
        {quickActionIds.map((commandId) => <QuickActionV4 commandBindings={commandBindings} commandId={commandId} key={commandId} />)}
      </div>
      <div aria-label="Application status" className="studio-header-status-v4">
        <span>{labels.simulation}</span>
        <span>{labels.joint}</span>
        <button
          aria-controls="gateway-details-v4"
          aria-expanded={gatewayDetailsOpen}
          aria-label={`Gateway details: ${labels.gateway}`}
          className="studio-header-gateway-disclosure-v4"
          onClick={() => onGatewayDetailsOpenChange(!gatewayDetailsOpen)}
          ref={gatewayTriggerRef}
          title={gatewayEndpoint}
          type="button"
        >{labels.gateway}</button>
      </div>
      <RibbonToggleV4 commandBindings={commandBindings} />
    </div>
    {gatewayDetailsOpen ? <div
      aria-label="Gateway details"
      className="studio-header-gateway-details-v4"
      id="gateway-details-v4"
      ref={gatewayDetailsRef}
      role="dialog"
      tabIndex={-1}
    >
      <header>
        <strong>Gateway details</strong>
        <button aria-label="Close Gateway details" onClick={() => onGatewayDetailsOpenChange(false)} type="button">Close</button>
      </header>
      <dl>
        <div><dt>Mode</dt><dd>{status.gateway.modeLabel}</dd></div>
        <div><dt>Status</dt><dd>{status.gateway.statusLabel}</dd></div>
        <div><dt>Endpoint</dt><dd>{gatewayEndpoint}</dd></div>
      </dl>
    </div> : null}
    <RibbonLiteV4 commandBindings={commandBindings} context={context} shellLayoutController={shellLayoutController} />
  </header>
}
