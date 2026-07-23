import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type {
  ProjectPublicationCoordinatorV5,
  PublishedProjectV5,
} from './project-v5-publication.js'

export interface ProjectV5AtomicMutationPort {
  readPublished(): PublishedProjectV5 | null
  mutate(request: {
    readonly expectedRevisionId: string
    readonly description: string
    readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5
  }): Promise<PublishedProjectV5>
}

export interface ProjectV5MutationService extends ProjectV5AtomicMutationPort {}

export interface ProjectV5MutationServiceOptions {
  readonly publication: Pick<ProjectPublicationCoordinatorV5, 'replace' | 'readPublished' | 'isRecoveryRequired'>
  readonly createRevisionId: () => string
  readonly nowIso: () => string
}

export class ProjectV5MutationServiceError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`)
    this.name = 'ProjectV5MutationServiceError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function failMutation(code: string, message: string, cause?: unknown): never {
  throw new ProjectV5MutationServiceError(code, message, cause)
}

type ProjectV5AtomicMutationRequest = Parameters<ProjectV5AtomicMutationPort['mutate']>[0]

function assertRequest(request: ProjectV5AtomicMutationRequest): void {
  if (typeof request.description !== 'string' || request.description.trim().length === 0) {
    failMutation('PROJECT_MUTATION_DESCRIPTION_INVALID', 'Project V5 mutation description must be non-empty.')
  }
  if (typeof request.expectedRevisionId !== 'string' || request.expectedRevisionId.length === 0) {
    failMutation('PROJECT_ACTIVE_REVISION_CHANGED', 'Project V5 mutation requires a non-empty expected revision.')
  }
  if (typeof request.recipe !== 'function') {
    failMutation('PROJECT_MUTATION_RECIPE_INVALID', 'Project V5 mutation recipe must be a function.')
  }
}

function requireActive(
  publication: ProjectV5MutationServiceOptions['publication'],
  expectedRevisionId: string,
): PublishedProjectV5 {
  const active = publication.readPublished()
  if (active === null) {
    return failMutation('PROJECT_ACTIVE_REVISION_MISSING', 'No published Project V5 revision is active.')
  }
  if (active.revisionId !== expectedRevisionId) {
    return failMutation('PROJECT_ACTIVE_REVISION_CHANGED', 'The active Project V5 revision changed before mutation.')
  }
  return active
}

export function createProjectV5MutationService(
  options: ProjectV5MutationServiceOptions,
): ProjectV5MutationService {
  let tail = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const pending = tail.then(operation, operation)
    tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  const service: ProjectV5MutationService = {
    readPublished() {
      return options.publication.readPublished()
    },

    mutate(request) {
      return enqueue(async () => {
        assertRequest(request)
        if (options.publication.isRecoveryRequired()) {
          return failMutation('PROJECT_RECOVERY_REQUIRED', 'Reload recovery is required before another Project V5 mutation.')
        }
        const active = requireActive(options.publication, request.expectedRevisionId)
        const mutated = request.recipe(validateWorkcellProjectV5(structuredClone(active.project)))
        const revisionId = options.createRevisionId()
        if (revisionId === active.revisionId) {
          return failMutation('PROJECT_REVISION_ID_NOT_FRESH', 'Project V5 mutation must create a fresh revision identity.')
        }
        const candidate = validateWorkcellProjectV5({
          ...mutated,
          projectId: active.project.projectId,
          revisionId,
          metadata: {
            ...mutated.metadata,
            createdAt: active.project.metadata.createdAt,
            updatedAt: options.nowIso(),
          },
        })
        requireActive(options.publication, active.revisionId)
        return options.publication.replace({ candidate, expectedRevisionId: active.revisionId })
      })
    },
  }
  return Object.freeze(service)
}
