export type RuntimeGatewayOpcUaClientEndpointPhaseV1 =
  | 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'faulted'

export interface RuntimeGatewayDiagnosticErrorV1 {
  readonly code: string
  readonly message: string
  readonly occurredAtMs: number
}

export interface RuntimeGatewayOpcUaClientEndpointStatusV1 {
  readonly endpointId: string
  readonly endpointUrl: string
  readonly phase: RuntimeGatewayOpcUaClientEndpointPhaseV1
  readonly sessionActive: boolean
  readonly subscriptionActive: boolean
  readonly monitoredItemCount: number
  readonly mappingCount: number
  readonly lastValueQuality: 'GOOD' | 'UNCERTAIN' | 'BAD' | null
  readonly lastNotificationAtMs: number | null
  readonly lastGoodValueAtMs: number | null
  readonly reconnectAttempt: number
  readonly nextRetryAtMs: number | null
  readonly lastError: RuntimeGatewayDiagnosticErrorV1 | null
}
