export type SmokeCommandRunner = (
  command: string[],
  options?: { env?: Record<string, string> },
) => Promise<void>

export interface SmokeResponse {
  readonly ok: boolean
  readonly status?: number
}

export interface OpcUaServerSmokeProbeOptions {
  readonly endpointUrl: string
  readonly gatewayBaseUrl: string
  readonly webBaseUrl: string
}

export interface SmokeDeploymentOptions {
  run?: SmokeCommandRunner
  fetch?: (url: string) => Promise<SmokeResponse>
  probeOpcUaServer?: (options: OpcUaServerSmokeProbeOptions) => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
  port?: number
  opcUaPort?: number
  projectName?: string
  maxAttempts?: number
}

export function createSmokeProjectName(now?: number, pid?: number): string
export function smokeDeployment(options?: SmokeDeploymentOptions): Promise<void>
