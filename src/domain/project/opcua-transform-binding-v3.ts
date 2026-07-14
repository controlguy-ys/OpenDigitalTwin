import type { ExternalEntityId } from './external-entity-v3'

export interface FixedTwoCycleSmoothingPolicyV1 {
  readonly mode: 'two-cycle'
  readonly cycles: 2
}

export interface ProjectOpcUaEquipmentTransformBindingV3 {
  readonly entityId: ExternalEntityId
  readonly gatewayId: string
  readonly gatewayProfileId: string
  readonly gatewayProfileRevision: string
  readonly mode: 'absolute'
  readonly referenceFrameId: 'world' | 'mcp'
  readonly smoothing: FixedTwoCycleSmoothingPolicyV1
}
