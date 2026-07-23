export interface ProjectV5FileNameMetadata {
  readonly name: string
  readonly projectId: string
}

export interface ProjectFileCommandPortV5 {
  pickProject(): Promise<File | null>
  downloadProject(blob: Blob, metadata: ProjectV5FileNameMetadata): void
}

export interface CreateBrowserProjectFileCommandPortV5Options {
  readonly document?: Document
  readonly url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

function safeFilePart(value: string): string {
  const withoutControls = Array.from(value, (character) => (
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character
  )).join('')
  const normalized = withoutControls.replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[ .]+$/g, '')
  return normalized.length === 0 ? 'workcell' : normalized
}

export function projectV5DownloadFileName(metadata: ProjectV5FileNameMetadata): string {
  return `${safeFilePart(metadata.name)}-${safeFilePart(metadata.projectId)}.json`
}

export function createBrowserProjectFileCommandPortV5(
  options: CreateBrowserProjectFileCommandPortV5Options = {},
): ProjectFileCommandPortV5 {
  const document = options.document ?? globalThis.document
  const url = options.url ?? URL
  return Object.freeze({
    pickProject: () => new Promise<File | null>((resolve, reject) => {
      const input = document.createElement('input')
      input.accept = '.json,application/json'
      input.hidden = true
      input.type = 'file'
      let settled = false
      let changeAttached = false
      let cancelAttached = false
      const cleanup = () => {
        if (changeAttached) input.removeEventListener('change', onChange)
        if (cancelAttached) input.removeEventListener('cancel', onCancel)
        input.remove()
      }
      const settle = (value: File | null) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onChange = () => settle(input.files?.item(0) ?? null)
      const onCancel = () => settle(null)
      try {
        document.body.append(input)
        changeAttached = true
        input.addEventListener('change', onChange)
        cancelAttached = true
        input.addEventListener('cancel', onCancel)
        input.click()
      } catch (error) {
        fail(error)
      }
    }),
    downloadProject: (blob: Blob, metadata: ProjectV5FileNameMetadata) => {
      const objectUrl = url.createObjectURL(blob)
      let anchor: HTMLAnchorElement | null = null
      try {
        anchor = document.createElement('a')
        anchor.download = projectV5DownloadFileName(metadata)
        anchor.hidden = true
        anchor.href = objectUrl
        document.body.append(anchor)
        anchor.click()
      } finally {
        try {
          anchor?.remove()
        } finally {
          url.revokeObjectURL(objectUrl)
        }
      }
    },
  })
}
