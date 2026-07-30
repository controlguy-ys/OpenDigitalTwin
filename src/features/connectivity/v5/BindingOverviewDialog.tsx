import {
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'

import type {
  OpcUaProjectTargetV5,
  WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { ModalDialogV6 } from '../../ui/v6/ModalDialogV6.js'
import {
  availableBindingTargetsV1,
  bindingTargetKeyV1,
  bindingTargetLabelV1,
} from './binding-editor-model.js'

export interface BindingOverviewDialogPropsV1 {
  readonly activeProject: WorkcellProjectV5
  readonly onClose: () => void
  readonly onEdit: (target: OpcUaProjectTargetV5, mappingId?: string) => void
  readonly triggerRef?: RefObject<HTMLElement | null>
}

function targetOf(project: WorkcellProjectV5, mappingId: string): OpcUaProjectTargetV5 | null {
  return project.opcUa.mappings.find(({ id }) => id === mappingId)?.leaves[0]?.projectTarget ?? null
}

function nodeIdentifier(address: WorkcellProjectV5['opcUa']['mappings'][number]['nodeAddress']): string {
  const prefix = {
    string: 's',
    numeric: 'i',
    guid: 'g',
    byteString: 'b',
  }[address.identifierType]
  return `${prefix}=${address.identifier}`
}

export function BindingOverviewDialogV1({
  activeProject,
  onClose,
  onEdit,
  triggerRef,
}: BindingOverviewDialogPropsV1): ReactNode {
  const closeRef = useRef<HTMLButtonElement>(null)

  const mappedTargetKeys = new Set(activeProject.opcUa.mappings
    .map(({ id }) => targetOf(activeProject, id))
    .filter((target): target is OpcUaProjectTargetV5 => target !== null)
    .map(bindingTargetKeyV1))
  const unmappedTargets = availableBindingTargetsV1(activeProject)
    .filter(({ target }) => !mappedTargetKeys.has(bindingTargetKeyV1(target)))

  return (
    <ModalDialogV6
      className="opcua-settings-dialog binding-overview-dialog"
      footer={<footer className="opcua-settings-footer"><button onClick={onClose} ref={closeRef} type="button">Close</button></footer>}
      header={<header className="opcua-settings-header">
          <div><p>Connectivity / Mapping</p><h2 id="binding-overview-v1-title">Binding Overview</h2></div>
          <p>{activeProject.opcUa.mappings.length} mapping{activeProject.opcUa.mappings.length === 1 ? '' : 's'}</p>
        </header>}
      initialFocusRef={closeRef}
      onClose={onClose}
      overlayClassName="opcua-settings-overlay"
      testId="binding-overview-overlay"
      titleId="binding-overview-v1-title"
      triggerRef={triggerRef}
    >
        <div className="opcua-settings-body">
          {activeProject.opcUa.endpoints.map((endpoint) => {
            const mappings = activeProject.opcUa.mappings.filter((mapping) => mapping.endpointId === endpoint.endpointId)
            return (
              <section aria-labelledby={`binding-endpoint-${endpoint.endpointId}`} key={endpoint.endpointId}>
                <h3 id={`binding-endpoint-${endpoint.endpointId}`}>{endpoint.name} <span>({mappings.length})</span></h3>
                {mappings.length === 0 ? <p>No bindings use this Endpoint.</p> : (
                  <table className="binding-overview-table">
                    <thead><tr><th scope="col">Target</th><th scope="col">Direction</th><th scope="col">Namespace URI</th><th scope="col">Identifier</th><th scope="col">Leaves</th><th scope="col">Action</th></tr></thead>
                    <tbody>
                      {mappings.map((mapping) => {
                        const target = targetOf(activeProject, mapping.id)
                        if (target === null) return null
                        return (
                          <tr key={mapping.id}>
                            <th scope="row">{bindingTargetLabelV1(activeProject, target)}</th>
                            <td>{mapping.direction}</td>
                            <td>{mapping.nodeAddress.namespaceUri}</td>
                            <td>{nodeIdentifier(mapping.nodeAddress)}</td>
                            <td>{mapping.leaves.length}</td>
                            <td><button onClick={() => onEdit(target, mapping.id)} type="button">Edit Binding</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            )
          })}
          <section aria-labelledby="binding-unmapped-targets-title">
            <h3 id="binding-unmapped-targets-title">Available Targets</h3>
            {unmappedTargets.length === 0 ? <p>Every supported Object and Robot target is mapped.</p> : (
              <div className="binding-target-list">
                {unmappedTargets.map(({ target, label }) => (
                  <button key={bindingTargetKeyV1(target)} onClick={() => onEdit(target)} type="button">Create binding: {label}</button>
                ))}
              </div>
            )}
          </section>
        </div>
    </ModalDialogV6>
  )
}
