export type SmokeCommandRunner = (
  command: string[],
  options?: { env?: Record<string, string> },
) => Promise<void>

export interface SmokeResponse {
  readonly ok: boolean
}

export interface SmokeDeploymentOptions {
  includeOpcUa?: boolean
  run?: SmokeCommandRunner
  fetch?: (url: string) => Promise<SmokeResponse>
  probeWebSocket?: (url: string) => Promise<void>
  sleep?: (milliseconds: number) => Promise<void>
  port?: number
  projectName?: string
  maxAttempts?: number
}

export function createSmokeProjectName(now?: number, pid?: number): string
export function smokeDeployment(options?: SmokeDeploymentOptions): Promise<void>
