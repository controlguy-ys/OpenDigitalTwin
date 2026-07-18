export interface ProjectFileCommandPortV4 {
  pickProject(): Promise<File | null>
  downloadProject(blob: Blob, fileName: string): void
}

export interface CreateBrowserProjectFileCommandPortOptionsV4 {
  readonly document?: Document
  readonly url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

function sanitizeProjectFileNameV4(fileName: string): string {
  const withoutControlCharacters = Array.from(fileName, (character) => (
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character
  )).join('')
  const normalized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/[ .]+$/g, '')
  return normalized.length === 0 ? 'workcell.json' : normalized
}

export function createBrowserProjectFileCommandPortV4(
  options: CreateBrowserProjectFileCommandPortOptionsV4 = {},
): ProjectFileCommandPortV4 {
  const document = options.document ?? globalThis.document
  const url = options.url ?? URL

  return Object.freeze({
    pickProject: () => new Promise<File | null>((resolve, reject) => {
      const input = document.createElement('input')
      input.accept = '.json,application/json'
      input.hidden = true
      input.type = 'file'
      document.body.append(input)

      let settled = false
      const cleanup = (): void => {
        input.removeEventListener('change', onChange)
        input.removeEventListener('cancel', onCancel)
        input.remove()
      }
      const settle = (value: File | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onChange = (): void => settle(input.files?.item(0) ?? null)
      const onCancel = (): void => settle(null)

      input.addEventListener('change', onChange)
      input.addEventListener('cancel', onCancel)
      try {
        input.click()
      } catch (error) {
        fail(error)
      }
    }),

    downloadProject: (blob: Blob, fileName: string) => {
      const objectUrl = url.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.download = sanitizeProjectFileNameV4(fileName)
      anchor.hidden = true
      anchor.href = objectUrl
      document.body.append(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        url.revokeObjectURL(objectUrl)
      }
    },
  })
}
