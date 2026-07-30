import type { ReactNode } from 'react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'
import { ObjectInspectorV6, type InspectorMutationPortV6 } from './ObjectInspectorV6.js'
import { RobotInspectorV6, type RobotInspectorV6Props } from './RobotInspectorV6.js'

export interface SelectionInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly selection: V6WorkcellSelection | null
  readonly mutations?: InspectorMutationPortV6
  readonly runtime?: RobotInspectorV6Props['runtime']
  readonly onOpenBinding?: Parameters<typeof ObjectInspectorV6>[0]['onOpenBinding']
}

export function SelectionInspectorV6({ project, selection, mutations, runtime, onOpenBinding }: SelectionInspectorV6Props): ReactNode {
  if (selection === null || selection.kind === 'frame' || selection.kind === 'group') return <section className="v6-selection-inspector" aria-live="polite"><p>Select a Robot or Object to inspect.</p></section>
  if (selection.kind === 'entity') return <ObjectInspectorV6
    entityId={selection.id}
    project={project}
    {...(mutations === undefined ? {} : { mutations })}
    {...(onOpenBinding === undefined ? {} : { onOpenBinding })}
  />
  return <RobotInspectorV6
    project={project}
    robotId={selection.id}
    {...(mutations === undefined ? {} : { mutations })}
    {...(runtime === undefined ? {} : { runtime })}
    {...(onOpenBinding === undefined ? {} : { onOpenBinding })}
  />
}
