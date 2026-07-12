export interface DeploymentFiles {
  dockerfile: string
  connectorDockerfile: string
  nginx: string
  compose: string
  dockerignore: string
}

export function validateDeploymentContract(files: DeploymentFiles): string[]
export function validateDeploymentFiles(root: string): Promise<string[]>
