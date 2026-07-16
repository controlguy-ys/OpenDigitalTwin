import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'

export interface ProjectMutationPortV4 {
  replaceFromActive(
    recipe: {
      readonly description: string
      mutate(active: WorkcellProjectV4): WorkcellProjectV4
    },
  ): Promise<{ readonly project: WorkcellProjectV4 }>
}
