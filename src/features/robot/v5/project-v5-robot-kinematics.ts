import {
  createDefaultApplicationKinematicsServiceV1,
  type ApplicationKinematicsServiceV1,
  type CompiledMechanismEvaluatorV1,
} from '../../../core/mechanism-runtime-v1/application-kinematics-service.js'
import { failProjectV5 } from '../../../core/project-v5/errors.js'
import { normalizeRigidTransformV5, type RigidTransformV5 } from '../../../core/project-v5/rigid-transform.js'
import type { RobotDefinitionV5, WorkcellProjectV5 } from '../../../core/project-v5/types.js'
import { validateWorkcellProjectV5 } from '../../../core/project-v5/validate.js'
import {
  canonicalCoordinatesFromRobotV5,
  projectRobotCapabilityV5,
  projectRobotDefinitionV5ToMechanismV1,
  projectRobotInstanceV5ToMechanismInstanceV1,
  rethrowSerialRobotCompatibilityErrorV5,
  serialRobotPoseFromMechanismV1,
} from '../../../core/robot-runtime-v5/robot-mechanism-adapter.js'
import type { SerialRobotPoseV5 } from '../../../core/robot-runtime-v5/serial-kinematics.js'

const CONFIG_REVISION_PATTERN = /^[0-9a-f]{64}$/u

export interface RobotPoseEvaluationRequestV5 {
  readonly robotId: string
  readonly coordinateRevision: number
  readonly jointValues: Readonly<Record<string, number>>
  readonly rootWorldPose: RigidTransformV5
}

export interface RobotPoseEvaluationIdentityV5 {
  readonly projectId: string
  readonly projectRevisionId: string
  readonly configRevision: string
  readonly adapterKey: 'open-digital-twin/project-v5-robot'
  readonly adapterVersion: '1'
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedSolverParametersHash: string
}

export interface EvaluatedSerialRobotPoseV5 {
  readonly identity: RobotPoseEvaluationIdentityV5
  readonly pose: SerialRobotPoseV5
}

export interface CompiledProjectRobotKinematicsV5 {
  evaluateRobot(request: RobotPoseEvaluationRequestV5): EvaluatedSerialRobotPoseV5
}

export interface ProjectRobotKinematicsFactoryV5 {
  compileProject(project: WorkcellProjectV5, configRevision: string): CompiledProjectRobotKinematicsV5
}

interface CompiledDefinition {
  readonly definition: RobotDefinitionV5
  readonly compiled: CompiledMechanismEvaluatorV1
  readonly coordinateIds: readonly string[]
  readonly authoredCoordinateIds: readonly string[]
  readonly identity: RobotPoseEvaluationIdentityV5
}

interface PoseCacheEntry {
  readonly robotId: string
  readonly identity: RobotPoseEvaluationIdentityV5
  readonly coordinateRevision: number
  readonly canonicalCoordinates: readonly number[]
  readonly authoredCoordinates: readonly number[]
  readonly root: readonly [number, number, number, number, number, number, number]
  readonly evaluated: EvaluatedSerialRobotPoseV5
}

function requireConfigRevision(value: string): string {
  if (!CONFIG_REVISION_PATTERN.test(value)) throw new TypeError('Config revision must be a lowercase 64-character hexadecimal digest.')
  return value
}

function requireCoordinateRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Coordinate revision must be a non-negative safe integer.')
  return value
}

function identity(
  project: WorkcellProjectV5,
  configRevision: string,
  projected: ReturnType<typeof projectRobotDefinitionV5ToMechanismV1>,
  compiled: CompiledMechanismEvaluatorV1,
): RobotPoseEvaluationIdentityV5 {
  return Object.freeze({
    projectId: project.projectId,
    projectRevisionId: project.revisionId,
    configRevision,
    adapterKey: projected.adapterKey,
    adapterVersion: projected.adapterVersion,
    solverKey: compiled.solverKey,
    solverContractVersion: compiled.solverContractVersion,
    normalizedSolverParametersHash: compiled.normalizedSolverParametersHash,
  })
}

function rootTuple(value: RigidTransformV5): readonly [number, number, number, number, number, number, number] {
  const normalized = normalizeRigidTransformV5(value, '$.rootWorldPose')
  return Object.freeze([
    normalized.positionM[0], normalized.positionM[1], normalized.positionM[2],
    normalized.quaternion[0], normalized.quaternion[1], normalized.quaternion[2], normalized.quaternion[3],
  ]) as unknown as readonly [number, number, number, number, number, number, number]
}

function rootPose([x, y, z, qx, qy, qz, qw]: readonly [number, number, number, number, number, number, number]): RigidTransformV5 {
  return Object.freeze({ positionM: Object.freeze([x, y, z]) as [number, number, number], quaternion: Object.freeze([qx, qy, qz, qw]) as [number, number, number, number] })
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

function sameIdentity(left: RobotPoseEvaluationIdentityV5, right: RobotPoseEvaluationIdentityV5): boolean {
  return left.projectId === right.projectId
    && left.projectRevisionId === right.projectRevisionId
    && left.configRevision === right.configRevision
    && left.adapterKey === right.adapterKey
    && left.adapterVersion === right.adapterVersion
    && left.solverKey === right.solverKey
    && left.solverContractVersion === right.solverContractVersion
    && left.normalizedSolverParametersHash === right.normalizedSolverParametersHash
}

function cached(
  entry: PoseCacheEntry | undefined,
  robotId: string,
  compiledDefinition: CompiledDefinition,
  coordinateRevision: number,
  canonicalCoordinates: readonly number[],
  authoredCoordinates: readonly number[],
  root: readonly [number, number, number, number, number, number, number],
): EvaluatedSerialRobotPoseV5 | null {
  if (entry === undefined || entry.robotId !== robotId || entry.coordinateRevision !== coordinateRevision) return null
  if (!sameIdentity(entry.identity, compiledDefinition.identity)
    || !sameNumbers(entry.canonicalCoordinates, canonicalCoordinates)
    || !sameNumbers(entry.authoredCoordinates, authoredCoordinates)
    || !sameNumbers(entry.root, root)) return null
  return entry.evaluated
}

function frozenLookup<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  const lookup = Object.create(null) as Record<string, T>
  for (const [id, value] of entries) Object.defineProperty(lookup, id, { configurable: false, enumerable: true, value, writable: false })
  return Object.freeze(lookup)
}

function unknownRobot(robotId: string): never {
  failProjectV5('ROBOT_INSTANCE_NOT_FOUND', `$.robots.${robotId}`, `Robot Instance ${robotId} does not exist.`, 'Use a Robot Instance from the compiled Project.')
}

function compileProject(
  projectInput: WorkcellProjectV5,
  configInput: string,
  applicationService: ApplicationKinematicsServiceV1,
): CompiledProjectRobotKinematicsV5 {
  const project = validateWorkcellProjectV5(projectInput)
  const configRevision = requireConfigRevision(configInput)
  try {
    const definitions = frozenLookup(project.robotDefinitions.map((definition) => {
      const projected = projectRobotDefinitionV5ToMechanismV1(definition)
      const compiled = applicationService.compile(projected.mechanismDefinition)
      return [definition.id, Object.freeze({
        definition,
        compiled,
        coordinateIds: Object.freeze(projected.mechanismDefinition.joints.filter((joint) => joint.jointType !== 'fixed').map((joint) => joint.jointId)),
        authoredCoordinateIds: Object.freeze(definition.joints.map((joint) => joint.id).sort()),
        identity: identity(project, configRevision, projected, compiled),
      })] as const
    }))

    const robotsById = frozenLookup(project.robots.map((robot) => {
      const definition = definitions[robot.definitionId]
      if (definition === undefined) unknownRobot(robot.id)
      // Compile-time validation deliberately does not seed the runtime cache.
      // It proves each authored coordinate/root pair before the evaluator is published.
      canonicalCoordinatesFromRobotV5(definition.definition, robot.initialJointValues)
      normalizeRigidTransformV5(robot.localBasePose, `$.robots.${robot.id}.localBasePose`)
      const capability = projectRobotCapabilityV5(definition.definition, robot)
      projectRobotInstanceV5ToMechanismInstanceV1(robot)
      return [robot.id, Object.freeze({ robot, definition, capability })] as const
    }))

    // The private cache is the only mutable structure. It is never exposed and
    // is indexed only by Robot IDs from the frozen compiled Project lookup.
    const poseCache = new Map<string, PoseCacheEntry>()
    return Object.freeze({
      evaluateRobot(request: RobotPoseEvaluationRequestV5): EvaluatedSerialRobotPoseV5 {
        const robot = robotsById[request.robotId] ?? unknownRobot(request.robotId)
        const coordinateRevision = requireCoordinateRevision(request.coordinateRevision)
        try {
          const coordinatesById = canonicalCoordinatesFromRobotV5(robot.definition.definition, request.jointValues)
          const canonicalCoordinates = Object.freeze(robot.definition.coordinateIds.map((id) => coordinatesById[id]!))
          const authoredCoordinates = Object.freeze(robot.definition.authoredCoordinateIds.map((id) => request.jointValues[id]!))
          const root = rootTuple(request.rootWorldPose)
          const prior = cached(poseCache.get(request.robotId), request.robotId, robot.definition, coordinateRevision, canonicalCoordinates, authoredCoordinates, root)
          if (prior !== null) return prior

          const result = robot.definition.compiled.evaluateForward({
            rootWorldPose: rootPose(root), coordinatesByStableId: coordinatesById,
          })
          const evaluated = Object.freeze({
            identity: robot.definition.identity,
            pose: serialRobotPoseFromMechanismV1(robot.definition.definition, request.jointValues, result),
          })
          poseCache.set(request.robotId, Object.freeze({
            robotId: request.robotId, identity: robot.definition.identity, coordinateRevision, canonicalCoordinates, authoredCoordinates, root, evaluated,
          }))
          return evaluated
        } catch (error) {
          return rethrowSerialRobotCompatibilityErrorV5(error)
        }
      },
    })
  } catch (error) {
    return rethrowSerialRobotCompatibilityErrorV5(error)
  }
}

export function createProjectRobotKinematicsFactoryV5(
  applicationService: ApplicationKinematicsServiceV1 = createDefaultApplicationKinematicsServiceV1(),
): ProjectRobotKinematicsFactoryV5 {
  return Object.freeze({
    compileProject: (project: WorkcellProjectV5, configRevision: string) => compileProject(project, configRevision, applicationService),
  })
}
