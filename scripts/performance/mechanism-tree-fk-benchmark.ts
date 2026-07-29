import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cpus, platform } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { makeMechanismTreeFkBenchmarkFixtureV1 } from '../../src/core/mechanism-runtime-v1/test-support.js'
import { createTreeKinematicsSolverV1 } from '../../src/core/mechanism-runtime-v1/tree-kinematics-solver.js'
import { compileTreeMechanismDefinitionV1 } from '../../src/core/mechanism-runtime-v1/validate-tree-definition.js'

export interface MechanismTreeFkBenchmarkOptions {
  readonly warmupCount: number
  readonly batchCount: number
  readonly samplesPerBatch: number
}

export interface MechanismTreeFkBenchmarkReport {
  readonly fixture: {
    readonly bodies: 128
    readonly totalJoints: 127
    readonly movableJoints: 64
    readonly fixedJoints: 63
  }
  readonly solver: {
    readonly solverKey: string
    readonly contractVersion: string
  }
  readonly environment: {
    readonly platform: string
    readonly cpuModel: string
    readonly logicalCores: number
    readonly nodeVersion: string
    readonly gitCommit: string
  }
  readonly batches: readonly {
    readonly p50Ms: number
    readonly p95Ms: number
    readonly maxMs: number
  }[]
  readonly aggregate: {
    readonly p50Ms: number
    readonly p95Ms: number
  }
}

export interface MechanismTreeFkBenchmarkDependencies {
  readonly nowMs: () => number
  readonly readEnvironment: () => MechanismTreeFkBenchmarkReport['environment']
}

const BENCHMARK_CRITICAL_SOURCE_PATHS = [
  'scripts/performance/mechanism-tree-fk-benchmark.ts',
  'src/core/mechanism-runtime-v1/test-support.ts',
  'src/core/mechanism-runtime-v1/tree-kinematics-solver.ts',
  'src/core/mechanism-runtime-v1/validate-tree-definition.ts',
  'src/core/mechanism-runtime-v1/validation-support.ts',
  'src/core/mechanism-runtime-v1/limits.ts',
  'src/core/mechanism-runtime-v1/errors.ts',
  'src/core/mechanism-runtime-v1/types.ts',
  'src/core/project-v5/rigid-transform.ts',
  'package.json',
] as const

function percentile(sortedValues: readonly number[], fraction: number): number {
  return sortedValues[Math.ceil(sortedValues.length * fraction) - 1]!
}

function finiteDuration(startMs: number, endMs: number): number {
  const durationMs = endMs - startMs
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('Benchmark clock must return finite, monotonic values.')
  }
  return durationMs
}

function validateOptions(options: MechanismTreeFkBenchmarkOptions): void {
  for (const [name, value, minimum] of [
    ['warmupCount', options.warmupCount, 0],
    ['batchCount', options.batchCount, 1],
    ['samplesPerBatch', options.samplesPerBatch, 1],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}.`)
    }
  }
}

function gitDirectory(repositoryRoot: string): string {
  const dotGit = resolve(repositoryRoot, '.git')
  try {
    const pointer = readFileSync(dotGit, 'utf8').trim()
    if (!pointer.startsWith('gitdir:')) return dotGit
    return resolve(repositoryRoot, pointer.slice('gitdir:'.length).trim())
  } catch {
    return dotGit
  }
}

function readGitCommit(repositoryRoot = process.cwd()): string {
  try {
    const directory = gitDirectory(repositoryRoot)
    const head = readFileSync(resolve(directory, 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head
    const refName = head.slice('ref: '.length)
    try {
      return readFileSync(resolve(directory, refName), 'utf8').trim()
    } catch {
      const packedRefs = readFileSync(resolve(directory, 'packed-refs'), 'utf8')
      return packedRefs.split(/\r?\n/).find((line) => line.endsWith(` ${refName}`))?.split(' ')[0] ?? 'unavailable'
    }
  } catch {
    return 'unavailable'
  }
}

export function fingerprintBenchmarkSourceContent(
  readSource: (relativePath: string) => string = (relativePath) => readFileSync(resolve(process.cwd(), relativePath), 'utf8'),
): string {
  const hash = createHash('sha256')
  for (const relativePath of BENCHMARK_CRITICAL_SOURCE_PATHS) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readSource(relativePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function formatMeasuredSourceIdentity(gitCommit: string, sourceFingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint)) {
    throw new Error('Benchmark source fingerprint must be a SHA-256 hex digest.')
  }
  return `${gitCommit}+source:${sourceFingerprint}`
}

function defaultEnvironment(): MechanismTreeFkBenchmarkReport['environment'] {
  const logicalCores = cpus()
  return {
    platform: platform(),
    cpuModel: logicalCores[0]?.model ?? 'unknown',
    logicalCores: logicalCores.length,
    nodeVersion: process.version,
    gitCommit: formatMeasuredSourceIdentity(readGitCommit(), fingerprintBenchmarkSourceContent()),
  }
}

function coordinatesForSample(
  coordinateIds: readonly string[],
  sampleIndex: number,
): Readonly<Record<string, number>> {
  return Object.fromEntries(coordinateIds.map((jointId, jointIndex) => [
    jointId,
    ((sampleIndex + jointIndex) % 9 + 1) / 10,
  ]))
}

export function runMechanismTreeFkBenchmark(
  options: MechanismTreeFkBenchmarkOptions,
  dependencies: MechanismTreeFkBenchmarkDependencies = {
    nowMs: () => performance.now(),
    readEnvironment: defaultEnvironment,
  },
): MechanismTreeFkBenchmarkReport {
  validateOptions(options)
  const fixture = makeMechanismTreeFkBenchmarkFixtureV1()
  const compiledDefinition = compileTreeMechanismDefinitionV1(fixture.mechanismDefinition).definition
  const solver = createTreeKinematicsSolverV1()
  const coordinateIds = Object.keys(fixture.coordinatesByStableId).sort()
  let sampleIndex = 0
  const requestForSample = () => ({
    mechanismDefinition: compiledDefinition,
    rootWorldPose: fixture.rootWorldPose,
    coordinatesByStableId: coordinatesForSample(coordinateIds, sampleIndex),
  })
  const evaluateWarmup = (): void => {
    solver.evaluateForward(requestForSample())
    sampleIndex += 1
  }

  for (let warmupIndex = 0; warmupIndex < options.warmupCount; warmupIndex += 1) evaluateWarmup()

  const allSamples: number[] = []
  const batches = Array.from({ length: options.batchCount }, () => {
    const samples = Array.from({ length: options.samplesPerBatch }, () => {
      const request = requestForSample()
      const startMs = dependencies.nowMs()
      solver.evaluateForward(request)
      const endMs = dependencies.nowMs()
      sampleIndex += 1
      return finiteDuration(startMs, endMs)
    }).sort((left, right) => left - right)
    allSamples.push(...samples)
    return {
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: samples[samples.length - 1]!,
    }
  })
  const sortedAllSamples = allSamples.sort((left, right) => left - right)
  if (!batches.every((batch) => Object.values(batch).every(Number.isFinite))
    || !sortedAllSamples.every(Number.isFinite)) {
    throw new Error('Benchmark produced invalid or non-finite output.')
  }
  const environment = dependencies.readEnvironment()
  if (!Number.isSafeInteger(environment.logicalCores) || environment.logicalCores < 1) {
    throw new Error('Benchmark environment reported an invalid logical core count.')
  }

  return {
    fixture: { bodies: 128, totalJoints: 127, movableJoints: 64, fixedJoints: 63 },
    solver: { solverKey: solver.solverKey, contractVersion: solver.contractVersion },
    environment,
    batches,
    aggregate: {
      p50Ms: percentile(sortedAllSamples, 0.5),
      p95Ms: percentile(sortedAllSamples, 0.95),
    },
  }
}

function isMainModule(): boolean {
  const invokedPath = process.argv[1]
  return invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    console.log(JSON.stringify(runMechanismTreeFkBenchmark({
      warmupCount: 2_000,
      batchCount: 5,
      samplesPerBatch: 10_000,
    })))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
