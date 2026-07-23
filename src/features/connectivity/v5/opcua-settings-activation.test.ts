import { describe, expect, it, vi } from 'vitest'

import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import type { ProjectV5AtomicMutationPort } from '../../project/v5/project-v5-mutation-service.js'
import type { PublishedProjectV5 } from '../../project/v5/project-v5-publication.js'
import { createOpcUaSettingsDraftV1 } from './opcua-settings-draft.js'
import {
  createOpcUaSettingsActivationServiceV1,
  createOpcUaSettingsControllerV1,
  type OpcUaSettingsActivationServiceV1,
} from './opcua-settings-activation.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function project(revisionId = 'revision-a'): WorkcellProjectV5 {
  return validateWorkcellProjectV5({ ...makeMinimalWorkcellProjectV5(), revisionId })
}

function published(value: WorkcellProjectV5, configRevision = HASH_A): PublishedProjectV5 {
  return Object.freeze({ project: value, revisionId: value.revisionId, configRevision })
}

function harness(options: { readonly failure?: 'prepare' | 'gateway' | 'commit' | 'finalize' } = {}) {
  const active = published(project())
  let current: PublishedProjectV5 | null = active
  let gatewayActive: PublishedProjectV5 | null = active
  const events: string[] = []
  const mutate = vi.fn(async (request: Parameters<ProjectV5AtomicMutationPort['mutate']>[0]) => {
    const candidate = request.recipe(active.project)
    const next = published({ ...candidate, revisionId: 'revision-b' }, HASH_B)
    const rollback = () => { current = active; gatewayActive = active; events.push('rollback:prior-authority') }
    events.push('prepare')
    if (options.failure === 'prepare') throw new Error('TEST_PREPARE')
    gatewayActive = next
    events.push('gateway:activate')
    if (options.failure === 'gateway') {
      rollback()
      throw new Error('TEST_GATEWAY')
    }
    current = next
    events.push('repository:commit')
    if (options.failure === 'commit') {
      rollback()
      throw new Error('TEST_COMMIT')
    }
    events.push('repository:finalize')
    if (options.failure === 'finalize') {
      rollback()
      throw new Error('TEST_FINALIZE')
    }
    current = next
    return next
  })
  const publication: Pick<ProjectV5AtomicMutationPort, 'readPublished' | 'mutate'> = { readPublished: () => current, mutate }
  const service = createOpcUaSettingsActivationServiceV1(publication)
  const controller = createOpcUaSettingsControllerV1(service)
  return { active, current: () => current, gatewayActive: () => gatewayActive, events, mutate, service, controller }
}

describe('OPC UA Settings activation V1', () => {
  it('uses exactly one named atomic mutation with a recipe limited to Draft-owned fields', async () => {
    const subject = harness()
    const draft = { ...createOpcUaSettingsDraftV1(subject.active.project), mode: 'bridge' as const }

    await expect(subject.service.apply(draft)).resolves.toMatchObject({ revisionId: 'revision-b' })

    expect(subject.mutate).toHaveBeenCalledTimes(1)
    expect(subject.mutate).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevisionId: 'revision-a', description: 'Apply OPC UA Settings', recipe: expect.any(Function),
    }))
    const recipe = subject.mutate.mock.calls[0]?.[0].recipe
    expect(recipe!(subject.active.project)).toMatchObject({ opcUa: { mode: 'bridge' } })
    expect(recipe!(subject.active.project).opcUa.mappings).toEqual(subject.active.project.opcUa.mappings)
  })

  it('rejects stale Drafts before mutation', async () => {
    const subject = harness()
    const stale = { ...createOpcUaSettingsDraftV1(subject.active.project), baseProjectRevisionId: 'stale' }

    await expect(subject.service.apply(stale)).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })
    expect(subject.mutate).not.toHaveBeenCalled()
  })

  it.each(['validation', 'prepare', 'gateway', 'commit', 'finalize'] as const)(
    'keeps the prior publication and open Draft when %s fails',
    async (failure) => {
      const subject = harness(failure === 'validation' ? {} : { failure })
      subject.controller.open(subject.active.project)
      subject.controller.update((draft) => failure === 'validation'
        ? { ...draft, endpoints: [] }
        : { ...draft, mode: 'bridge' })

      await expect(subject.controller.applyAndActivate()).rejects.toThrow()

      expect(subject.current()).toEqual(subject.active)
      expect(subject.gatewayActive()).toEqual(subject.active)
      if (failure !== 'validation' && failure !== 'prepare') {
        expect(subject.events).toContain('gateway:activate')
        expect(subject.events).toContain('rollback:prior-authority')
      }
      expect(subject.controller.getState()).toMatchObject({ open: true, phase: 'failed' })
      expect(subject.controller.getState().draft?.mode).toBe(failure === 'validation' ? subject.active.project.opcUa.mode : 'bridge')
    },
  )

  it('cancels an open Draft and closes only after authoritative success', async () => {
    const subject = harness()
    subject.controller.open(subject.active.project)
    subject.controller.update((draft) => ({ ...draft, mode: 'bridge' }))
    subject.controller.cancel()
    expect(subject.controller.getState()).toEqual({ open: false, phase: 'editing', draft: null, issues: [], error: null })

    subject.controller.open(subject.active.project)
    subject.controller.update((draft) => ({ ...draft, mode: 'bridge' }))
    await expect(subject.controller.applyAndActivate()).resolves.toMatchObject({ revisionId: 'revision-b' })
    expect(subject.controller.getState()).toEqual({ open: false, phase: 'editing', draft: null, issues: [], error: null })
  })

  it('does not allow open, update, or cancel to mutate the Draft while Apply is pending', async () => {
    let resolveApply!: (value: PublishedProjectV5) => void
    const pending = new Promise<PublishedProjectV5>((resolve) => { resolveApply = resolve })
    const activation: OpcUaSettingsActivationServiceV1 = {
      validate: () => [],
      apply: vi.fn(() => pending),
    }
    const controller = createOpcUaSettingsControllerV1(activation)
    const firstProject = project('revision-a')
    const nextProject = project('revision-next')

    controller.open(firstProject)
    controller.update((draft) => ({ ...draft, mode: 'bridge' }))
    const unsubscribe = controller.subscribe(() => {
      if (controller.getState().phase !== 'validating') return
      controller.cancel()
      controller.open(nextProject)
      controller.update((draft) => ({ ...draft, mode: 'off' }))
    })
    const applying = controller.applyAndActivate()
    controller.cancel()
    controller.open(nextProject)
    controller.update((draft) => ({ ...draft, mode: 'off' }))
    expect(controller.getState()).toMatchObject({
      open: true,
      phase: 'activating',
      draft: expect.objectContaining({ baseProjectRevisionId: 'revision-a', mode: 'bridge' }),
    })
    resolveApply(published({ ...firstProject, revisionId: 'revision-b' }, HASH_B))

    await expect(applying).resolves.toMatchObject({ revisionId: 'revision-b' })
    unsubscribe()
    expect(controller.getState()).toEqual({ open: false, phase: 'editing', draft: null, issues: [], error: null })
  })

  it('coalesces a second Apply into the first pending mutation', async () => {
    let resolveApply!: (value: PublishedProjectV5) => void
    const pending = new Promise<PublishedProjectV5>((resolve) => { resolveApply = resolve })
    const activation: OpcUaSettingsActivationServiceV1 = {
      validate: () => [],
      apply: vi.fn(() => pending),
    }
    const controller = createOpcUaSettingsControllerV1(activation)
    controller.open(project())
    controller.update((draft) => ({ ...draft, mode: 'bridge' }))
    const first = controller.applyAndActivate()
    const second = controller.applyAndActivate()

    expect(second).toBe(first)
    expect(controller.getState()).toMatchObject({ open: true, phase: 'activating', draft: expect.objectContaining({ mode: 'bridge' }) })
    resolveApply(published({ ...project(), revisionId: 'revision-b' }, HASH_B))
    await expect(first).resolves.toMatchObject({ revisionId: 'revision-b' })
    expect(activation.apply).toHaveBeenCalledOnce()
  })
})
