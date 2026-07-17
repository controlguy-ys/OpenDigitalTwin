export interface DualRobotOpcUaSmokeOptions {
  readonly endpointUrl: string
  readonly gatewayBaseUrl: string
  readonly webBaseUrl: string
}

export interface DualRobotOpcUaSmokeResult {
  readonly crbJ1: number
  readonly slideX: number
}

export function probeDualRobotOpcUaServer(
  options: DualRobotOpcUaSmokeOptions,
): Promise<DualRobotOpcUaSmokeResult>
