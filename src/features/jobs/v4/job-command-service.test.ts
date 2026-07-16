import { describe, expect, it } from 'vitest'
import {
  MAX_JOBS_V4,
  MAX_JOB_STEPS_PER_JOB_V4,
  MAX_TOTAL_JOB_STEPS_V4,
  ProjectV4Error,
  validateWorkcellProjectV4,
  type RobotActionDefinitionV4,
  type RobotJobStepV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import type { ProjectMutationPortV4 } from '../../project/v4/project-mutation-port.js'
import {
  createJobCommandServiceV4,
  type JobCommandServiceV4,
} from './job-command-service.js'
import { createJobRuntimeStoreV4 } from './job-runtime-store.js'

interface PendingMutation {
  readonly recipe: Parameters<ProjectMutationPortV4['replaceFromActive']>[0]
  resolve(value: { readonly project: WorkcellProjectV4 }): void
  reject(reason?: unknown): void
}

class QueuedMutationPortV4 implements ProjectMutationPortV4 {
  active: WorkcellProjectV4
  readonly pending: PendingMutation[] = []
  submitted = 0

  constructor(active: WorkcellProjectV4) {
    this.active = validateWorkcellProjectV4(active)
  }

  replaceFromActive(
    recipe: Parameters<ProjectMutationPortV4['replaceFromActive']>[0],
  ): Promise<{ readonly project: WorkcellProjectV4 }> {
    this.submitted += 1
    return new Promise((resolve, reject) => {
      this.pending.push({ recipe, resolve, reject })
    })
  }

  runNext(current: WorkcellProjectV4 = this.active): void {
    const pending = this.pending.shift()
    if (pending === undefined) throw new Error('No queued mutation recipe.')
    try {
      const project = validateWorkcellProjectV4(pending.recipe.mutate(current))
      this.active = project
      pending.resolve({ project })
    } catch (error) {
      pending.reject(error)
    }
  }
}

function twoRobotProject(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const robot1 = source.robots[0]!
  return {
    ...source,
    robots: [
      robot1,
      { ...robot1, id: 'robot-2', name: 'Robot 2' },
    ],
  }
}

function pose(
  jointValues: Readonly<Record<string, number>> = { J1: 0 },
  speedPercentToNext = 100,
): RobotJobStepV4 {
  return { kind: 'joint-pose', jointValues, speedPercentToNext }
}

function action(actionId: string): RobotJobStepV4 {
  return { kind: 'action-reference', actionId }
}

function robotAction(id: string, robotId = 'robot-1'): RobotActionDefinitionV4 {
  return { id, kind: 'set-gripper-state', robotId, state: 'OPEN' }
}

function withJobs(
  project: WorkcellProjectV4,
  jobs: WorkcellProjectV4['jobs'],
  actions: WorkcellProjectV4['actions'] = project.actions,
): WorkcellProjectV4 {
  return { ...project, jobs, actions }
}

function projectWithJointIds(jointIds: readonly string[]): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definition = source.robotDefinitions[0]!
  const templateJoint = definition.joints[0]!
  const links = Array.from({ length: jointIds.length + 1 }, (_, index) => ({
    ...definition.links[Math.min(index, definition.links.length - 1)]!,
    id: `link.${index}`,
    name: `Link ${index}`,
    geometryOccurrences: index === 0 ? definition.links[0]!.geometryOccurrences : [],
  }))
  const joints = jointIds.map((id, index) => ({
    ...templateJoint,
    id,
    parentLinkId: links[index]!.id,
    childLinkId: links[index + 1]!.id,
    min: -100,
    max: 100,
  }))
  const frames = definition.frames.map((frame) => {
    if (frame.role === 'base') return { ...frame, parentFrameId: links[0]!.id }
    if (frame.role === 'tool') return { ...frame, parentFrameId: links.at(-1)!.id }
    return frame
  })
  return {
    ...source,
    robotDefinitions: [{ ...definition, links, joints, frames }],
    robots: [{
      ...source.robots[0]!,
      initialJointValues: Object.fromEntries(jointIds.map((id) => [id, 0])),
    }],
  }
}

function makeJobs(
  counts: readonly number[],
  stepFactory: (index: number, stepIndex: number) => RobotJobStepV4 = () => pose(),
): WorkcellProjectV4['jobs'] {
  return counts.map((count, index) => ({
    id: `job-${index + 1}`,
    name: `Job ${index + 1}`,
    robotId: 'robot-1',
    steps: Array.from({ length: count }, (_, stepIndex) => stepFactory(index, stepIndex)),
  }))
}

interface CommandHarness {
  readonly mutations: QueuedMutationPortV4
  readonly jobs: ReturnType<typeof createJobRuntimeStoreV4>
  readonly service: JobCommandServiceV4
}

function commandHarness(
  project: WorkcellProjectV4,
  ids: readonly string[] = ['generated-1', 'generated-2', 'generated-3'],
): CommandHarness {
  const mutations = new QueuedMutationPortV4(project)
  const jobs = createJobRuntimeStoreV4()
  jobs.getState().replaceProject(project)
  let index = 0
  const service = createJobCommandServiceV4({
    mutations,
    readProject: () => project,
    jobs,
    createId: () => ids[index++] ?? `generated-${index}`,
  })
  return { mutations, jobs, service }
}

async function runOne<T>(
  harness: CommandHarness,
  command: () => Promise<T>,
  current?: WorkcellProjectV4,
): Promise<T> {
  const before = harness.mutations.submitted
  const result = command()
  expect(harness.mutations.submitted).toBe(before + 1)
  expect(harness.mutations.pending).toHaveLength(1)
  harness.mutations.runNext(current)
  return result
}

async function rejectOne(
  harness: CommandHarness,
  command: () => Promise<unknown>,
  code: string,
  current?: WorkcellProjectV4,
): Promise<void> {
  const before = harness.mutations.submitted
  const result = command()
  const assertion = expect(result).rejects.toMatchObject({ code })
  expect(harness.mutations.submitted).toBe(before + 1)
  expect(harness.mutations.pending).toHaveLength(1)
  harness.mutations.runNext(current)
  await assertion
}

function setRunning(harness: CommandHarness, robotId: string, jobId: string): void {
  harness.jobs.getState().setRobotState({
    robotId,
    jobId,
    runId: `run-${robotId}`,
    state: 'RUNNING',
    stepIndex: 0,
    startedAtSimulationMs: 0,
    completedAtSimulationMs: null,
    failureCode: null,
    message: '',
  })
}

describe('JobCommandServiceV4', () => {
  it('creates, renames, duplicates, and deletes Robot-owned Jobs with one recipe each', async () => {
    const initial = withJobs(twoRobotProject(), [{
      id: 'source-job',
      name: 'Source',
      robotId: 'robot-1',
      steps: [pose({ J1: 10 }, 25), action('action-1')],
    }], [robotAction('action-1')])
    const harness = commandHarness(initial, ['created-job', 'duplicated-job'])

    await expect(runOne(harness, () => harness.service.createJob('robot-2', 'Robot 2 Job')))
      .resolves.toBe('created-job')
    expect(harness.mutations.active.jobs.at(-1)).toEqual({
      id: 'created-job', name: 'Robot 2 Job', robotId: 'robot-2', steps: [],
    })

    await runOne(harness, () => harness.service.renameJob('created-job', 'Renamed'))
    expect(harness.mutations.active.jobs.at(-1)?.name).toBe('Renamed')

    await expect(runOne(harness, () => harness.service.duplicateJob('source-job')))
      .resolves.toBe('duplicated-job')
    const source = harness.mutations.active.jobs.find(({ id }) => id === 'source-job')!
    const duplicate = harness.mutations.active.jobs.find(({ id }) => id === 'duplicated-job')!
    expect(duplicate).toEqual({ ...source, id: 'duplicated-job' })
    expect(duplicate.steps).not.toBe(source.steps)
    expect((duplicate.steps[0] as Extract<RobotJobStepV4, { kind: 'joint-pose' }>).jointValues)
      .not.toBe((source.steps[0] as Extract<RobotJobStepV4, { kind: 'joint-pose' }>).jointValues)

    await runOne(harness, () => harness.service.deleteJob('created-job'))
    expect(harness.mutations.active.jobs.some(({ id }) => id === 'created-job')).toBe(false)
    expect(harness.mutations.submitted).toBe(4)
  })

  it('saves, reorders, and deletes literal 1-Joint and 16-Joint Poses', async () => {
    for (const count of [1, 16]) {
      const ids = Array.from({ length: count }, (_, index) => `axis.${index + 1}`)
      const project = withJobs(projectWithJointIds(ids), [{
        id: 'joint-job', name: 'Joint Job', robotId: 'robot-1', steps: [],
      }])
      const harness = commandHarness(project)
      const values = Object.fromEntries(ids.map((id, index) => [id, index + 1]))

      await runOne(harness, () => harness.service.saveJointPose('joint-job', values, 1))
      await runOne(harness, () => harness.service.saveJointPose('joint-job', values, 100))
      await runOne(harness, () => harness.service.moveStep('joint-job', 1, -1))
      expect(harness.mutations.active.jobs[0]?.steps).toHaveLength(2)
      await runOne(harness, () => harness.service.deleteStep('joint-job', 1))
      expect(harness.mutations.active.jobs[0]?.steps).toEqual([pose(values, 100)])
    }
  })

  it('accepts compatible Robot and ownerless detach Actions and rejects another Robot Action', async () => {
    const source = projectAtLimit('spatialEntities', 1)
    const robot1 = source.robots[0]!
    const project = withJobs({
      ...source,
      robots: [robot1, { ...robot1, id: 'robot-2', name: 'Robot 2' }],
    }, [{ id: 'job-a', name: 'A', robotId: 'robot-1', steps: [] }], [
      robotAction('compatible', 'robot-1'),
      robotAction('other', 'robot-2'),
      { id: 'detach', kind: 'detach-object', objectId: 'entity-1' },
    ])
    const harness = commandHarness(project)

    await runOne(harness, () => harness.service.addActionReference('job-a', 'compatible'))
    await runOne(harness, () => harness.service.addActionReference('job-a', 'detach'))
    expect(harness.mutations.active.jobs[0]?.steps).toEqual([
      action('compatible'), action('detach'),
    ])
    await rejectOne(
      harness,
      () => harness.service.addActionReference('job-a', 'other'),
      'ACTION_ROBOT_MISMATCH',
    )
  })

  it.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid Pose speed %s inside the queued recipe',
    async (speed) => {
      const project = withJobs(makeMinimalWorkcellProjectV4(), [{
        id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
      }])
      const harness = commandHarness(project)
      await rejectOne(
        harness,
        () => harness.service.saveJointPose('job-a', { J1: 0 }, speed),
        'PROJECT_VALUE_INVALID',
      )
    },
  )

  it.each([
    [{}, 'ROBOT_JOINT_KEY_SET_MISMATCH'],
    [{ J1: 0, extra: 0 }, 'ROBOT_JOINT_KEY_SET_MISMATCH'],
    [{ J1: Number.NaN }, 'PROJECT_VALUE_INVALID'],
    [{ J1: 181 }, 'ROBOT_JOINT_VALUE_OUT_OF_RANGE'],
  ] as const)('rejects invalid Joint values %# inside the recipe', async (values, code) => {
    const project = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }])
    const harness = commandHarness(project)
    await rejectOne(
      harness,
      () => harness.service.saveJointPose('job-a', values, 100),
      code,
    )
  })

  it('accepts exactly 32 Jobs and rejects a 33rd Job', async () => {
    const at31 = withJobs(
      makeMinimalWorkcellProjectV4(),
      makeJobs(Array.from({ length: MAX_JOBS_V4 - 1 }, () => 0)),
    )
    const passing = commandHarness(at31, ['job-32'])
    await runOne(passing, () => passing.service.createJob('robot-1', 'Job 32'))
    expect(passing.mutations.active.jobs).toHaveLength(MAX_JOBS_V4)

    const failing = commandHarness(passing.mutations.active, ['job-33'])
    await rejectOne(
      failing,
      () => failing.service.createJob('robot-1', 'Job 33'),
      'JOB_LIMIT_EXCEEDED',
    )
  })

  it('accepts exactly 256 mixed steps and rejects a 257th step', async () => {
    const steps = Array.from(
      { length: MAX_JOB_STEPS_PER_JOB_V4 - 1 },
      (_, index) => index % 2 === 0 ? pose() : action('action-1'),
    )
    const project = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps,
    }], [robotAction('action-1')])
    const passing = commandHarness(project)
    await runOne(passing, () => passing.service.addActionReference('job-a', 'action-1'))
    expect(passing.mutations.active.jobs[0]?.steps).toHaveLength(MAX_JOB_STEPS_PER_JOB_V4)

    const failing = commandHarness(passing.mutations.active)
    await rejectOne(
      failing,
      () => failing.service.saveJointPose('job-a', { J1: 0 }, 100),
      'JOB_STEP_LIMIT_EXCEEDED',
    )
  })

  it('accepts exactly 2,048 total steps', async () => {
    const counts = [
      ...Array.from({ length: 7 }, () => MAX_JOB_STEPS_PER_JOB_V4),
      MAX_JOB_STEPS_PER_JOB_V4 - 1,
    ]
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(MAX_TOTAL_JOB_STEPS_V4 - 1)
    const project = withJobs(makeMinimalWorkcellProjectV4(), makeJobs(counts))
    const harness = commandHarness(project)

    await runOne(harness, () => harness.service.saveJointPose('job-8', { J1: 0 }, 100))

    expect(harness.mutations.active.jobs.reduce((sum, job) => sum + job.steps.length, 0))
      .toBe(MAX_TOTAL_JOB_STEPS_V4)
  })

  it('rejects 2,049 total steps through a Job still below its own cap', async () => {
    const counts = [...Array.from({ length: 8 }, () => 255), 8]
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(MAX_TOTAL_JOB_STEPS_V4)
    expect(counts.at(-1)).toBeLessThan(MAX_JOB_STEPS_PER_JOB_V4)
    const project = withJobs(makeMinimalWorkcellProjectV4(), makeJobs(counts))
    const harness = commandHarness(project)

    await rejectOne(
      harness,
      () => harness.service.saveJointPose('job-9', { J1: 0 }, 100),
      'TOTAL_JOB_STEP_LIMIT_EXCEEDED',
    )
  })

  it('rechecks the current Robot owner after invocation instead of trusting readProject', async () => {
    const initial = twoRobotProject()
    const harness = commandHarness(initial, ['new-job'])
    const current = validateWorkcellProjectV4({
      ...initial,
      robots: initial.robots.filter(({ id }) => id !== 'robot-1'),
    })

    await rejectOne(
      harness,
      () => harness.service.createJob('robot-1', 'Removed Robot Job'),
      'ROBOT_INSTANCE_NOT_FOUND',
      current,
    )
  })

  it('rechecks the current Definition Joint set after invocation', async () => {
    const initial = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }])
    const harness = commandHarness(initial)
    const changed = withJobs(projectWithJointIds(['joint.new', 'joint.extra']), initial.jobs)

    await rejectOne(
      harness,
      () => harness.service.saveJointPose('job-a', { J1: 10 }, 100),
      'ROBOT_JOINT_KEY_SET_MISMATCH',
      changed,
    )
  })

  it('rechecks current Action ownership after invocation', async () => {
    const initial = withJobs(twoRobotProject(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }], [robotAction('action-current', 'robot-1')])
    const harness = commandHarness(initial)
    const changed = { ...initial, actions: [robotAction('action-current', 'robot-2')] }

    await rejectOne(
      harness,
      () => harness.service.addActionReference('job-a', 'action-current'),
      'ACTION_ROBOT_MISMATCH',
      changed,
    )
  })

  it('rechecks current runtime ownership after invocation', async () => {
    const project = withJobs(twoRobotProject(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }])
    const harness = commandHarness(project)
    const command = harness.service.renameJob('job-a', 'Queued Rename')
    const assertion = expect(command).rejects.toMatchObject({ code: 'ROBOT_JOB_EDIT_WHILE_RUNNING' })
    setRunning(harness, 'robot-1', 'job-a')

    harness.mutations.runNext()
    await assertion
    expect(harness.mutations.active.jobs[0]?.name).toBe('A')
  })

  const runningCommands = [
    ['create', (service: JobCommandServiceV4) => service.createJob('robot-1', 'Blocked')],
    ['rename', (service: JobCommandServiceV4) => service.renameJob('job-a', 'Blocked')],
    ['duplicate', (service: JobCommandServiceV4) => service.duplicateJob('job-a')],
    ['delete job', (service: JobCommandServiceV4) => service.deleteJob('job-a')],
    ['save pose', (service: JobCommandServiceV4) => service.saveJointPose('job-a', { J1: 0 }, 100)],
    ['add action', (service: JobCommandServiceV4) => service.addActionReference('job-a', 'action-1')],
    ['move step', (service: JobCommandServiceV4) => service.moveStep('job-a', 0, 1)],
    ['delete step', (service: JobCommandServiceV4) => service.deleteStep('job-a', 0)],
  ] as const

  it.each(runningCommands)('rejects %s for a running Robot', async (_name, invoke) => {
    const project = withJobs(twoRobotProject(), [
      { id: 'job-a', name: 'A', robotId: 'robot-1', steps: [pose(), pose({ J1: 10 })] },
      { id: 'job-b', name: 'B', robotId: 'robot-2', steps: [] },
    ], [robotAction('action-1')])
    const harness = commandHarness(project, ['new-job'])
    setRunning(harness, 'robot-1', 'job-a')

    await rejectOne(
      harness,
      () => invoke(harness.service),
      'ROBOT_JOB_EDIT_WHILE_RUNNING',
    )
  })

  it('allows editing an idle Robot while another Robot runs', async () => {
    const project = withJobs(twoRobotProject(), [
      { id: 'job-a', name: 'A', robotId: 'robot-1', steps: [] },
      { id: 'job-b', name: 'B', robotId: 'robot-2', steps: [] },
    ])
    const harness = commandHarness(project)
    setRunning(harness, 'robot-1', 'job-a')

    await runOne(harness, () => harness.service.renameJob('job-b', 'B edited'))

    expect(harness.mutations.active.jobs.find(({ id }) => id === 'job-b')?.name).toBe('B edited')
  })

  it('rejects an injected Job ID colliding with a global Project ID inside the recipe', async () => {
    const project = makeMinimalWorkcellProjectV4()
    const harness = commandHarness(project, ['world'])

    await rejectOne(
      harness,
      () => harness.service.createJob('robot-1', 'Collision'),
      'PROJECT_ID_DUPLICATE',
    )
  })

  it('snapshots caller Joint values before a deferred recipe and never aliases them', async () => {
    const project = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }])
    const harness = commandHarness(project)
    const callerValues = { J1: 10 }
    const command = harness.service.saveJointPose('job-a', callerValues, 100)
    callerValues.J1 = 180

    harness.mutations.runNext()
    await command

    const saved = harness.mutations.active.jobs[0]!.steps[0] as Extract<
      RobotJobStepV4,
      { kind: 'joint-pose' }
    >
    expect(saved.jointValues).toEqual({ J1: 10 })
    expect(saved.jointValues).not.toBe(callerValues)
    expect(callerValues).toEqual({ J1: 180 })
  })

  it('validates move direction and step indices inside the recipe', async () => {
    const project = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [pose(), pose({ J1: 10 })],
    }])
    for (const invoke of [
      (service: JobCommandServiceV4) => service.moveStep('job-a', 0, 2 as 1),
      (service: JobCommandServiceV4) => service.moveStep('job-a', 0.5, 1),
      (service: JobCommandServiceV4) => service.moveStep('job-a', 1, 1),
      (service: JobCommandServiceV4) => service.deleteStep('job-a', -1),
    ]) {
      const harness = commandHarness(project)
      await rejectOne(harness, () => invoke(harness.service), 'JOB_STEP_INDEX_INVALID')
    }
  })

  it('reports Project errors rather than mutating active state on rejection', async () => {
    const project = withJobs(makeMinimalWorkcellProjectV4(), [{
      id: 'job-a', name: 'A', robotId: 'robot-1', steps: [],
    }])
    const harness = commandHarness(project)
    const before = harness.mutations.active
    const command = harness.service.deleteJob('missing-job')
    const assertion = expect(command).rejects.toBeInstanceOf(ProjectV4Error)
    harness.mutations.runNext()
    await assertion
    expect(harness.mutations.active).toBe(before)
  })
})
