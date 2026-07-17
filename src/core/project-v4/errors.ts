export class ProjectV4Error extends Error {
  readonly code: string
  readonly path: string
  readonly recovery?: string

  constructor(
    code: string,
    path: string,
    message: string,
    recovery?: string,
  ) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'ProjectV4Error'
    this.code = code
    this.path = path
    if (recovery !== undefined) this.recovery = recovery
  }
}

export function failProjectV4(
  code: string,
  path: string,
  message: string,
  recovery?: string,
): never {
  throw new ProjectV4Error(code, path, message, recovery)
}
