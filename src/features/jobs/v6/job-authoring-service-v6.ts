import type { StoreApi } from 'zustand/vanilla'

import type { RobotJobInstructionV1, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { JobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'

export interface JobAuthoringMutationPortV6 {
  readPublished(): { readonly project: WorkcellProjectV5; readonly revisionId: string } | null
  mutate(request: { readonly expectedRevisionId: string; readonly description: string; readonly recipe: (active: WorkcellProjectV5) => WorkcellProjectV5 }): Promise<unknown>
}

export interface JobAuthoringServiceV6 {
  reorder(jobId: string, instructionId: string, beforeId: string | null): Promise<void>
  insert(jobId: string, instruction: RobotJobInstructionV1, beforeId: string | null): Promise<void>
  replace(jobId: string, instruction: RobotJobInstructionV1): Promise<void>
  duplicate(jobId: string, instructionId: string): Promise<void>
  remove(jobId: string, instructionId: string): Promise<void>
}

export interface JobAuthoringServiceV6Options {
  readonly mutations: JobAuthoringMutationPortV6
  readonly runtime: StoreApi<JobRuntimeStoreV5>
  readonly createInstructionId?: () => string
}

function fail(message: string): never { throw new Error(message) }
function jobFor(project: WorkcellProjectV5, jobId: string) {
  return project.jobs.find((job) => job.id === jobId) ?? fail(`Job ${jobId} was not found.`)
}
function assertWritable(project: WorkcellProjectV5, jobId: string, runtime: StoreApi<JobRuntimeStoreV5>): void {
  const job = jobFor(project, jobId)
  if (runtime.getState().byRobotId[job.robotId]?.state === 'RUNNING') fail('A running Job cannot be authored.')
}
function replaceJob(project: WorkcellProjectV5, jobId: string, instructions: readonly RobotJobInstructionV1[]): WorkcellProjectV5 {
  return { ...project, jobs: project.jobs.map((job) => job.id === jobId ? { ...job, instructions } : job) }
}
function insertBefore<T extends { readonly id: string }>(items: readonly T[], item: T, beforeId: string | null): readonly T[] {
  if (beforeId === null) return [...items, item]
  const index = items.findIndex((candidate) => candidate.id === beforeId)
  if (index < 0) fail(`Instruction ${beforeId} was not found.`)
  return [...items.slice(0, index), item, ...items.slice(index)]
}

export function createJobAuthoringServiceV6(options: JobAuthoringServiceV6Options): JobAuthoringServiceV6 {
  const mutate = async (jobId: string, description: string, recipe: (project: WorkcellProjectV5) => WorkcellProjectV5): Promise<void> => {
    const published = options.mutations.readPublished()
    if (published === null) fail('No published Project V5 revision is active.')
    assertWritable(published.project, jobId, options.runtime)
    await options.mutations.mutate({ expectedRevisionId: published.revisionId, description, recipe: (active) => {
      assertWritable(active, jobId, options.runtime)
      return recipe(active)
    } })
  }
  const createId = (): string => options.createInstructionId?.() ?? `job-instruction-${crypto.randomUUID()}`
  return Object.freeze({
    async reorder(jobId: string, instructionId: string, beforeId: string | null) {
      await mutate(jobId, 'Reorder Job instruction', (project) => {
        const job = jobFor(project, jobId); const current = job.instructions.find((instruction) => instruction.id === instructionId) ?? fail(`Instruction ${instructionId} was not found.`)
        if (beforeId === instructionId) return project
        const remaining = job.instructions.filter((instruction) => instruction.id !== instructionId)
        return replaceJob(project, jobId, insertBefore(remaining, current, beforeId))
      })
    },
    async insert(jobId: string, instruction: RobotJobInstructionV1, beforeId: string | null) {
      await mutate(jobId, 'Insert Job instruction', (project) => {
        if (project.jobs.some((job) => job.instructions.some((candidate) => candidate.id === instruction.id))) fail(`Instruction id ${instruction.id} is already used.`)
        return replaceJob(project, jobId, insertBefore(jobFor(project, jobId).instructions, instruction, beforeId))
      })
    },
    async replace(jobId: string, instruction: RobotJobInstructionV1) {
      await mutate(jobId, 'Edit Job instruction', (project) => {
        const job = jobFor(project, jobId); const index = job.instructions.findIndex((candidate) => candidate.id === instruction.id)
        if (index < 0) fail(`Instruction ${instruction.id} was not found.`)
        return replaceJob(project, jobId, job.instructions.map((candidate) => candidate.id === instruction.id ? instruction : candidate))
      })
    },
    async duplicate(jobId: string, instructionId: string) {
      await mutate(jobId, 'Duplicate Job instruction', (project) => {
        const job = jobFor(project, jobId); const source = job.instructions.find((instruction) => instruction.id === instructionId) ?? fail(`Instruction ${instructionId} was not found.`)
        const used = new Set(project.jobs.flatMap((candidate) => candidate.instructions.map((instruction) => instruction.id)))
        let id = createId(); while (used.has(id)) id = createId()
        const duplicate = { ...source, id } as RobotJobInstructionV1
        return replaceJob(project, jobId, insertBefore(job.instructions, duplicate, job.instructions[job.instructions.indexOf(source) + 1]?.id ?? null))
      })
    },
    async remove(jobId: string, instructionId: string) {
      await mutate(jobId, 'Delete Job instruction', (project) => {
        const job = jobFor(project, jobId); if (!job.instructions.some((instruction) => instruction.id === instructionId)) fail(`Instruction ${instructionId} was not found.`)
        return replaceJob(project, jobId, job.instructions.filter((instruction) => instruction.id !== instructionId))
      })
    },
  })
}
