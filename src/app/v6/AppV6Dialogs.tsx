import type { ReactNode, RefObject } from 'react'

import type { OpcUaProjectTargetV5, WorkcellProjectV5 } from '../../core/project-v5/index.js'
import { BindingEditorDialogV1 } from '../../features/connectivity/v5/BindingEditorDialog.js'
import { BindingOverviewDialogV1 } from '../../features/connectivity/v5/BindingOverviewDialog.js'
import { ConnectionMonitorPanel, type ConnectionMonitorPanelControlV1 } from '../../features/connectivity/v5/ConnectionMonitorPanel.js'
import { DockerRunGuideDialogV1 } from '../../features/connectivity/v5/DockerRunGuideDialog.js'
import { OpcUaSettingsDialog } from '../../features/connectivity/v5/OpcUaSettingsDialog.js'
import type { JobAuthoringServiceV6 } from '../../features/jobs/v6/job-authoring-service-v6.js'
import { RobotJobEditorDialogV6 } from '../../features/jobs/v6/RobotJobEditorDialogV6.js'
import type { BrowserProjectApplicationResourcesV5 } from '../../features/project/v5/browser-project-resources-v5.js'
import { HelpOverlayV6 } from '../../features/ui/v6/HelpOverlayV6.js'
import type { DialogParentV6, DialogRequestV6 } from '../../features/ui/v6/dialog-request-v6.js'
import type { WorkspaceLayoutStoreV6 } from '../../features/ui/v6/workspace-layout-store-v6.js'

type RuntimeBundleV6 = ReturnType<BrowserProjectApplicationResourcesV5['runtime']['bundle']['readActiveState']>
type SettingsStateV6 = ReturnType<BrowserProjectApplicationResourcesV5['settings']['getState']>
type SettingsParentV6 = Extract<DialogParentV6, { readonly kind: 'opcua-settings' }>
type BindingOverviewRequestV6 = Extract<DialogRequestV6, { readonly kind: 'binding-overview' }>

export interface AppV6DialogsProps {
  readonly resources: BrowserProjectApplicationResourcesV5
  readonly workspaceProject: WorkcellProjectV5 | null
  readonly bundle: RuntimeBundleV6
  readonly dialog: DialogRequestV6 | null
  readonly settingsState: SettingsStateV6
  readonly layout: WorkspaceLayoutStoreV6
  readonly monitorRef: RefObject<ConnectionMonitorPanelControlV1 | null>
  readonly settingsTriggerRef: RefObject<HTMLElement | null>
  readonly bindingOverviewTriggerRef: RefObject<HTMLElement | null>
  readonly bindingEditorTriggerRef: RefObject<HTMLElement | null>
  readonly dockerGuideTriggerRef: RefObject<HTMLElement | null>
  readonly jobEditorTriggerRef: RefObject<HTMLElement | null>
  readonly jobAuthoring: JobAuthoringServiceV6 | null
  readonly openBinding: (target: OpcUaProjectTargetV5, mappingId?: string, parent?: DialogParentV6) => void
  readonly browseSessionAvailable: (endpointId: string) => boolean
}

function bindingOverviewRequest(dialog: DialogRequestV6 | null): BindingOverviewRequestV6 | null {
  if (dialog?.kind === 'binding-overview') return dialog
  if (dialog?.kind === 'binding-editor' && dialog.parent?.kind === 'binding-overview') return dialog.parent
  return null
}

function settingsParent(dialog: DialogRequestV6 | null): SettingsParentV6 | null {
  if (dialog?.kind === 'opcua-settings') return { kind: 'opcua-settings' }
  if (dialog?.kind === 'binding-overview' || dialog?.kind === 'docker-guide') return dialog.parent?.kind === 'opcua-settings' ? dialog.parent : null
  if (dialog?.kind === 'binding-editor') {
    if (dialog.parent?.kind === 'opcua-settings') return dialog.parent
    return dialog.parent?.kind === 'binding-overview' && dialog.parent.parent?.kind === 'opcua-settings'
      ? dialog.parent.parent
      : null
  }
  return null
}

function closeToParent(layout: WorkspaceLayoutStoreV6, parent: DialogParentV6 | undefined): void {
  if (parent === undefined) layout.getState().closeDialog()
  else layout.getState().requestDialog(parent)
}

export function AppV6Dialogs({
  resources,
  workspaceProject,
  bundle,
  dialog,
  settingsState,
  layout,
  monitorRef,
  settingsTriggerRef,
  bindingOverviewTriggerRef,
  bindingEditorTriggerRef,
  dockerGuideTriggerRef,
  jobEditorTriggerRef,
  jobAuthoring,
  openBinding,
  browseSessionAvailable,
}: AppV6DialogsProps): ReactNode {
  const settings = settingsParent(dialog)
  const overview = bindingOverviewRequest(dialog)
  return <>
    <ConnectionMonitorPanel controlRef={monitorRef} showTrigger={false} store={resources.connectivity} />
    {workspaceProject !== null && settings !== null && settingsState.open && <OpcUaSettingsDialog
      activeProject={workspaceProject}
      connectionTest={resources.connectionTest}
      controller={resources.settings}
      onOpenBindingOverview={() => {
        if (document.activeElement instanceof HTMLElement) bindingOverviewTriggerRef.current = document.activeElement
        layout.getState().requestDialog({ kind: 'binding-overview', parent: { kind: 'opcua-settings' } })
      }}
      onOpenDockerRunGuide={() => {
        if (document.activeElement instanceof HTMLElement) dockerGuideTriggerRef.current = document.activeElement
        layout.getState().requestDialog({ kind: 'docker-guide', parent: { kind: 'opcua-settings' } })
      }}
      presentation={resources.connectivity.getState()}
      triggerRef={settingsTriggerRef}
    />}
    {workspaceProject !== null && overview !== null && <BindingOverviewDialogV1
      activeProject={workspaceProject}
      onClose={() => closeToParent(layout, overview.parent)}
      onEdit={(target, mappingId) => openBinding(target, mappingId, { kind: 'binding-overview', ...(overview.parent === undefined ? {} : { parent: overview.parent }) })}
      triggerRef={bindingOverviewTriggerRef}
    />}
    {workspaceProject !== null && dialog?.kind === 'binding-editor' && <BindingEditorDialogV1
      activeProject={workspaceProject}
      addressSpaceBrowsePort={resources.gateway}
      browseSessionAvailable={browseSessionAvailable}
      {...(dialog.mappingId === undefined ? {} : { mappingId: dialog.mappingId })}
      mutations={resources.mutations}
      nodeAddressResolver={resources.nodeAddressResolver}
      onClose={() => closeToParent(layout, dialog.parent)}
      onSaved={() => closeToParent(layout, dialog.parent)}
      target={dialog.target}
      triggerRef={bindingEditorTriggerRef}
    />}
    {dialog?.kind === 'docker-guide' && <DockerRunGuideDialogV1 onClose={() => closeToParent(layout, dialog.parent)} status={resources.connectivity.getState().status} triggerRef={dockerGuideTriggerRef} />}
    {workspaceProject !== null && dialog?.kind === 'job-editor' && jobAuthoring !== null && bundle !== null && <RobotJobEditorDialogV6 authoring={jobAuthoring} jobId={dialog.jobId} onClose={() => layout.getState().closeDialog()} project={workspaceProject} runtime={bundle.runtimeGraph.jobs} triggerRef={jobEditorTriggerRef} />}
    <HelpOverlayV6 onClose={() => layout.getState().closeDialog()} request={dialog?.kind === 'help' ? dialog : null} />
  </>
}
