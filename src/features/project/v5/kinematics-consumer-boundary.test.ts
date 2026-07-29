import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = process.cwd()
const CONSUMER_ROOTS = [
  'src/features/project/v5',
  'src/features/scene/v5',
  'src/features/jobs/v5',
  'src/features/actions/v5',
] as const
const FACTORY_CONSUMER_ROOTS = [...CONSUMER_ROOTS, 'src/features/robot/v5'] as const
const PRODUCTION_SOURCE = /(?<!\.test)\.(?:ts|tsx)$/u
const FORBIDDEN_KINEMATICS = [
  /tree-kinematics-solver/u,
  /computeSerialRobotPoseV4/u,
  /computeSerialRobotPoseV5/u,
  /jointMotionTransformV5/u,
  /(?:from\s+|import\s*\()[^'"`]*(?:'|")[^'"`]*core\/robot-runtime\/serial-kinematics(?:\.js)?(?:'|")/u,
  /(?:from\s+|import\s*\()[^'"`]*(?:'|")[^'"`]*(?:robot|collision)\/v4\/[^'"`]*(?:'|")/u,
] as const
const FACTORY_IMPORT = /project-v5-robot-kinematics/u
const ALLOWED_FACTORY_CONSUMERS = [
  'src/features/project/v5/browser-project-runtime-v5.ts',
  'src/features/robot/v5/robot-joint-runtime-store.ts',
] as const

async function productionSources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    return entry.isFile() && PRODUCTION_SOURCE.test(entry.name) ? [path] : []
  }))
  return nested.flat()
}

function inspectConsumerSource(path: string, source: string): {
  readonly forbidden: readonly string[]
  readonly importsFactory: boolean
} {
  return Object.freeze({
    forbidden: Object.freeze(FORBIDDEN_KINEMATICS.flatMap((forbidden) => (
      forbidden.test(source) ? [`${path}: ${forbidden}`] : []
    ))),
    importsFactory: FACTORY_IMPORT.test(source),
  })
}

function factoryConsumerViolation(path: string, importsFactory: boolean): string | null {
  return importsFactory && !ALLOWED_FACTORY_CONSUMERS.includes(path as typeof ALLOWED_FACTORY_CONSUMERS[number])
    ? `${path}: unapproved Project Robot kinematics factory consumer`
    : null
}

describe('V5 shared kinematics consumer boundary', () => {
  it('keeps scene, Job, and attachment consumers behind WorldResolverV5 or injected World pose callbacks; V5 collision is deferred until it can consume a completed FK snapshot rather than a Solver', async () => {
    const files = (await Promise.all(FACTORY_CONSUMER_ROOTS.map((root) => productionSources(join(REPOSITORY_ROOT, root))))).flat()
    const violations: string[] = []
    const factoryConsumers: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const path = relative(REPOSITORY_ROOT, file).replaceAll('\\', '/')
      const inspected = inspectConsumerSource(path, source)
      violations.push(...inspected.forbidden)
      const factoryViolation = factoryConsumerViolation(path, inspected.importsFactory)
      if (factoryViolation !== null) violations.push(factoryViolation)
      if (inspected.importsFactory) factoryConsumers.push(path)
    }

    expect(violations).toEqual([])
    expect(factoryConsumers.sort()).toEqual([...ALLOWED_FACTORY_CONSUMERS].sort())
  })

  it.each([
    ['the V4 serial pose symbol', 'import { computeSerialRobotPoseV4 } from \'../../../core/robot-runtime/serial-kinematics.js\''],
    ['the V4 serial module path', 'import { someLegacyHelper } from \'../../../core/robot-runtime/serial-kinematics.js\''],
    ['a V4 collision adapter', 'import { robotLinkCollisionProxiesV4 } from \'../../collision/v4/scene-entity-adapter-v4.js\''],
  ])('rejects a representative direct bypass through %s', (_name, source) => {
    expect(inspectConsumerSource('src/features/scene/v5/representative-bypass.ts', source).forbidden)
      .not.toEqual([])
  })

  it('rejects an unapproved factory consumer while excluding test files from production scanning', async () => {
    const path = 'src/features/scene/v5/private-solver-consumer.ts'
    const inspected = inspectConsumerSource(
      path,
      'import { createProjectRobotKinematicsFactoryV5 } from \'../../robot/v5/project-v5-robot-kinematics.js\'',
    )
    expect(factoryConsumerViolation(path, inspected.importsFactory)).not.toBeNull()
    const productionFiles = await productionSources(join(REPOSITORY_ROOT, 'src/features/robot/v5'))
    expect(productionFiles.some((file) => file.endsWith('.test.ts'))).toBe(false)
    expect(productionFiles.some((file) => file.endsWith('.test.tsx'))).toBe(false)
  })
})
