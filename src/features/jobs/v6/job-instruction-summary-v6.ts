import type { RobotJobInstructionV1, WorkcellProjectV5 } from '../../../core/project-v5/index.js'

function nameFor(project: WorkcellProjectV5 | undefined, id: string, fallback: string): string {
  return project?.logicalSignals.find((signal) => signal.id === id)?.name
    ?? project?.spatialEntities.find((entity) => entity.id === id)?.name
    ?? project?.scene.frames.find((frame) => frame.id === id)?.name
    ?? fallback
}

export function jobInstructionSummaryV6(instruction: RobotJobInstructionV1, project?: WorkcellProjectV5): string {
  switch (instruction.kind) {
    case 'move-joint': return `Move joints · ${Object.keys(instruction.jointValues).length} axes · ${instruction.speedPercentToNext}%`
    case 'set-do': return `Set ${nameFor(project, instruction.signalId, instruction.signalId)} = ${String(instruction.value)}`
    case 'wait-di': return `Wait ${nameFor(project, instruction.signalId, instruction.signalId)} = ${String(instruction.expected)} · timeout ${instruction.timeoutMs / 1_000} s`
    case 'delay': return `Delay ${instruction.durationMs} ms`
    case 'attach': return `Attach ${nameFor(project, instruction.objectId, instruction.objectId)} → ${nameFor(project, instruction.toolFrameId, instruction.toolFrameId)}`
    case 'detach': return `Detach ${nameFor(project, instruction.objectId, instruction.objectId)} → ${instruction.targetParentFrameId === null ? 'World' : nameFor(project, instruction.targetParentFrameId, instruction.targetParentFrameId)}`
  }
}

export const summarizeJobInstructionV6 = jobInstructionSummaryV6
