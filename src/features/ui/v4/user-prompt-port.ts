export interface UserPromptPortV4 {
  requestText(request: {
    readonly title: string
    readonly initialValue: string
    readonly required: boolean
  }): Promise<string | null>
}

export interface CreateBrowserUserPromptPortOptionsV4 {
  readonly prompt?: (message: string, defaultValue?: string) => string | null
}

export function createBrowserUserPromptPortV4(
  options: CreateBrowserUserPromptPortOptionsV4 = {},
): UserPromptPortV4 {
  const prompt = options.prompt ?? globalThis.window.prompt.bind(globalThis.window)
  return Object.freeze({
    async requestText(request: {
      readonly title: string
      readonly initialValue: string
      readonly required: boolean
    }) {
      const response = prompt(request.title, request.initialValue)
      if (response === null) return null
      if (request.required && response.trim().length === 0) {
        throw new Error(`${request.title} is required.`)
      }
      return response
    },
  })
}
