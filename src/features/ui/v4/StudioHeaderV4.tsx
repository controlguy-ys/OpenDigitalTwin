import { Play, Save, Square, type LucideIcon } from 'lucide-react'
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'

import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import type { AppCommandSectionV4 } from '../../commands/v4/app-command.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'
import { AppMenuBarV4 } from './AppMenuBarV4.js'
import type { AppMenuSectionModelV4 } from './app-menu-model.js'
import { CompactAppMenuV4 } from './CompactAppMenuV4.js'
import type { AppHeaderStatusV4 } from './app-header-status.js'
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
}

const QUICK_ACTION_ICONS_V4: Readonly<Record<StudioHeaderPropsV4['quickActionIds'][number], LucideIcon>> = Object.freeze({
  'project.save': Save,
  'job.start': Play,
  'job.cancel': Square,
})

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
  const { command, pending, invoke } = useAppCommandV4(commandBindings, commandId)
  if (command === null || command.visible !== true) return null
  const Icon = QUICK_ACTION_ICONS_V4[commandId]
  const disabled = command.enabled !== true || pending
  return <button
    aria-busy={pending || undefined}
    aria-label={command.label}
    className="studio-header-quick-action-v4"
    disabled={disabled}
    onClick={() => { if (!disabled) void invoke() }}
    title={pending ? 'Command in progress.' : command.disabledReason ?? command.label}
    type="button"
  ><Icon aria-hidden="true" size={16} strokeWidth={1.75} /></button>
}

function statusLabelsV4(status: AppHeaderStatusV4, compact: boolean): {
  readonly simulation: string
  readonly joint: string
  readonly gateway: string
} {
  const joint = status.jointSource.activeRobotName === null
    ? 'No active Robot'
    : compact
      ? status.jointSource.activeRobotName
      : `${status.jointSource.activeRobotName} · ${status.jointSource.sourceLabel!}`
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
}: StudioHeaderPropsV4): ReactNode {
  const snapshot = useShellSnapshotV4(shellLayoutController)
  const [openSection, setOpenSection] = useState<AppCommandSectionV4 | null>(null)
  const [previewSection, setPreviewSection] = useState<AppCommandSectionV4 | null>(null)
  const compact = snapshot.mode !== 'wide'
  const labels = statusLabelsV4(status, compact)
  const Menu = compact ? CompactAppMenuV4 : AppMenuBarV4
  const context: RibbonContextV4 = { ...ribbonContext, previewSection }

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
        <span title={status.gateway.endpoint ?? undefined}>{labels.gateway}</span>
      </div>
      <button
        aria-controls="ribbon-lite-v4"
        aria-expanded={snapshot.isRibbonExpanded()}
        aria-label="Toggle Ribbon Lite"
        className="studio-header-ribbon-toggle-v4"
        onClick={() => shellLayoutController.setRibbonExpanded(!snapshot.isRibbonExpanded())}
        type="button"
      >Ribbon</button>
    </div>
    <RibbonLiteV4 commandBindings={commandBindings} context={context} shellLayoutController={shellLayoutController} />
  </header>
}
