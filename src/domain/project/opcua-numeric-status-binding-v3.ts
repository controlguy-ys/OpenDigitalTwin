import type { ExternalEntityId } from './external-entity-v3'

export interface ProjectOpcUaNumericStatusBindingV3 {
  readonly entityId: ExternalEntityId
  readonly nodeId: string
  readonly scale: number
  readonly offset: number
}
