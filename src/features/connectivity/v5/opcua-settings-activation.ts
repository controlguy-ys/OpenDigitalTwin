import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { ProjectV5AtomicMutationPort } from '../../project/v5/project-v5-mutation-service.js'
import type { PublishedProjectV5 } from '../../project/v5/project-v5-publication.js'
import {
  createOpcUaSettingsCandidateRecipeV1,
  createOpcUaSettingsDraftV1,
  validateOpcUaSettingsDraftV1,
  type OpcUaSettingsDraftV1,
  type OpcUaSettingsValidationIssueV1,
} from './opcua-settings-draft.js'

export type OpcUaSettingsDraftPhaseV1 = 'editing' | 'validating' | 'activating' | 'failed'

export interface OpcUaSettingsActivationServiceV1 {
  validate(draft: OpcUaSettingsDraftV1): readonly OpcUaSettingsValidationIssueV1[]
  apply(draft: OpcUaSettingsDraftV1): Promise<PublishedProjectV5>
}

export interface OpcUaSettingsControllerV1 {
  getState(): {
    readonly open: boolean
    readonly phase: OpcUaSettingsDraftPhaseV1
    readonly draft: OpcUaSettingsDraftV1 | null
    readonly issues: readonly OpcUaSettingsValidationIssueV1[]
    readonly error: string | null
  }
  subscribe(listener: () => void): () => void
  open(project: WorkcellProjectV5): void
  update(recipe: (draft: OpcUaSettingsDraftV1) => OpcUaSettingsDraftV1): void
  cancel(): void
  applyAndActivate(): Promise<PublishedProjectV5>
}

export class OpcUaSettingsActivationErrorV1 extends Error {
  readonly code: string
  readonly issues: readonly OpcUaSettingsValidationIssueV1[]

  constructor(code: string, message: string, issues: readonly OpcUaSettingsValidationIssueV1[] = []) {
    super(`${code}: ${message}`)
    this.name = 'OpcUaSettingsActivationErrorV1'
    this.code = code
    this.issues = issues
  }
}

function failActivation(
  code: string,
  message: string,
  issues: readonly OpcUaSettingsValidationIssueV1[] = [],
): never {
  throw new OpcUaSettingsActivationErrorV1(code, message, issues)
}

function samePublishedRevision(publication: PublishedProjectV5 | null, draft: OpcUaSettingsDraftV1): WorkcellProjectV5 {
  if (publication === null) {
    return failActivation('PROJECT_ACTIVE_REVISION_MISSING', 'No published Project V5 revision is active.')
  }
  if (publication.revisionId !== draft.baseProjectRevisionId) {
    return failActivation('PROJECT_ACTIVE_REVISION_CHANGED', 'The active Project V5 revision changed before Settings activation.')
  }
  return publication.project
}

export function createOpcUaSettingsActivationServiceV1(
  mutations: Pick<ProjectV5AtomicMutationPort, 'readPublished' | 'mutate'>,
): OpcUaSettingsActivationServiceV1 {
  const validate = (draft: OpcUaSettingsDraftV1): readonly OpcUaSettingsValidationIssueV1[] => {
    const active = samePublishedRevision(mutations.readPublished(), draft)
    return validateOpcUaSettingsDraftV1(draft, active)
  }

  const service: OpcUaSettingsActivationServiceV1 = {
    validate,
    async apply(draft) {
      const active = samePublishedRevision(mutations.readPublished(), draft)
      const issues = validateOpcUaSettingsDraftV1(draft, active)
      if (issues.length > 0) {
        return failActivation('OPC_UA_SETTINGS_VALIDATION_FAILED', 'OPC UA Settings Draft is invalid.', issues)
      }
      return mutations.mutate({
        expectedRevisionId: draft.baseProjectRevisionId,
        description: 'Apply OPC UA Settings',
        recipe: createOpcUaSettingsCandidateRecipeV1(draft),
      })
    },
  }
  return Object.freeze(service)
}

interface SettingsControllerStateV1 {
  open: boolean
  phase: OpcUaSettingsDraftPhaseV1
  draft: OpcUaSettingsDraftV1 | null
  issues: readonly OpcUaSettingsValidationIssueV1[]
  error: string | null
}

function inactiveState(): SettingsControllerStateV1 {
  return { open: false, phase: 'editing', draft: null, issues: [], error: null }
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function issuesFor(error: unknown): readonly OpcUaSettingsValidationIssueV1[] {
  return error instanceof OpcUaSettingsActivationErrorV1 ? error.issues : []
}

export function createOpcUaSettingsControllerV1(
  activation: OpcUaSettingsActivationServiceV1,
): OpcUaSettingsControllerV1 {
  let state = inactiveState()
  let generation = 0
  let inFlight: Promise<PublishedProjectV5> | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of Array.from(listeners)) listener() }
  const setState = (next: SettingsControllerStateV1): void => { state = next; notify() }

  const controller: OpcUaSettingsControllerV1 = {
    getState() {
      return Object.freeze({ ...state, issues: [...state.issues] })
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    open(project) {
      if (inFlight !== null) return
      generation += 1
      setState({ open: true, phase: 'editing', draft: createOpcUaSettingsDraftV1(project), issues: [], error: null })
    },

    update(recipe) {
      if (inFlight !== null) return
      if (!state.open || state.draft === null) return
      generation += 1
      setState({ open: true, phase: 'editing', draft: recipe(state.draft), issues: [], error: null })
    },

    cancel() {
      if (inFlight !== null) return
      generation += 1
      setState(inactiveState())
    },

    applyAndActivate() {
      if (inFlight !== null) return inFlight
      if (!state.open || state.draft === null) {
        try {
          return failActivation('OPC_UA_SETTINGS_NOT_OPEN', 'Open OPC UA Settings before applying a Draft.')
        } catch (error) {
          return Promise.reject(error)
        }
      }
      const draft = state.draft
      const operationGeneration = generation
      let resolve!: (published: PublishedProjectV5) => void
      let reject!: (error: unknown) => void
      const operation = new Promise<PublishedProjectV5>((resolveOperation, rejectOperation) => {
        resolve = resolveOperation
        reject = rejectOperation
      })
      inFlight = operation
      void (async () => {
        setState({ ...state, phase: 'validating', issues: [], error: null })
        try {
          const issues = activation.validate(draft)
          if (issues.length > 0) {
            return failActivation('OPC_UA_SETTINGS_VALIDATION_FAILED', 'OPC UA Settings Draft is invalid.', issues)
          }
          setState({ ...state, phase: 'activating', issues: [], error: null })
          const published = await activation.apply(draft)
          if (generation === operationGeneration) setState(inactiveState())
          resolve(published)
        } catch (error) {
          if (generation === operationGeneration) {
            setState({ open: true, phase: 'failed', draft, issues: issuesFor(error), error: messageFor(error) })
          }
          reject(error)
        } finally {
          if (inFlight === operation) inFlight = null
        }
      })()
      return operation
    },
  }
  return Object.freeze(controller)
}
