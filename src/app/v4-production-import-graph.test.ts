/// <reference types="node" />

import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import {
  dirname,
  extname,
  relative,
  resolve,
} from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const projectRoot = realpathSync(process.cwd())
const productionEntry = resolve(projectRoot, 'src/main.tsx')
const sourceExtensions = Object.freeze([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
])

const forbiddenProductionSymbols = Object.freeze([
  'robot:active',
  'linear-axis:active',
  'JointAnglesDeg',
  'JOINT_COUNT',
  'ZERO_JOINT_ANGLES',
  'heldEntityId',
  'GraspController',
  'WorkcellProjectSnapshotV3',
])

const forbiddenProductionSourceFragments = Object.freeze([
  Object.freeze({
    label: 'fixed-six robot collision id',
    pattern: /robot-link:LINK0/u,
  }),
])

const forbiddenProjectModules = new Set([
  'browser-project-runtime.ts',
  'project-archive-worker.ts',
  'project-codec.ts',
  'project-db.ts',
  'project-mutation-service.ts',
  'project-publication-coordinator.ts',
  'project-revision-canonical.ts',
  'project-revision-hydration.ts',
  'project-revision-repository.ts',
  'project-revision-storage.ts',
  'project-source-staging.ts',
  'project-store.ts',
  'project-v3-archive.ts',
])

const forbiddenSceneModules = new Set([
  'LinearAxisInspector.tsx',
  'LinearAxisRuntime.tsx',
  'RobotMountContactEditor.tsx',
  'SceneCanvas.tsx',
  'SceneContextMenu.tsx',
  'SceneEntityInspector.tsx',
  'SceneExplorer.tsx',
  'Workcell.tsx',
  'linear-axis-source.ts',
  'scene-command-service.ts',
  'scene-context-request.ts',
  'scene-editor-store.ts',
  'scene-runtime-selector.ts',
])

const forbiddenViewportModules = new Set([
  'CoordinateStatusBar.tsx',
  'ViewportOverlay.tsx',
  'coordinate-pose-readout.ts',
  'viewport-preference-store.ts',
])

const neutralSharedImportModules = new Set([
  'src/features/import/StepImportClient.ts',
  'src/features/import/detect-step-unit.ts',
  'src/features/import/occt-to-three.ts',
  'src/features/import/step-worker-protocol.ts',
])

interface ImportGraph {
  readonly modules: ReadonlyMap<string, string>
  readonly paths: ReadonlyMap<string, readonly string[]>
  readonly unresolved: readonly string[]
}

function normalizedProjectPath(absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  switch (extname(filePath).toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function staticModuleSpecifiers(filePath: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  )
  const specifiers: string[] = []

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function forbiddenSymbolsInSource(
  filePath: string,
  source: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  )
  const forbidden = new Set<string>(forbiddenProductionSymbols)
  const hits = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      (ts.isIdentifier(node) || ts.isStringLiteralLike(node))
      && forbidden.has(node.text)
    ) {
      hits.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...hits]
}

function sourceCandidates(importerPath: string, rawSpecifier: string): readonly string[] {
  const specifier = rawSpecifier.split(/[?#]/u, 1)[0]!
  if (!specifier.startsWith('.')) return []

  const basePath = resolve(dirname(importerPath), specifier)
  const extension = extname(basePath).toLowerCase()
  if (extension !== '' && !sourceExtensions.includes(extension)) return []

  if (extension === '.js' || extension === '.jsx') {
    const withoutExtension = basePath.slice(0, -extension.length)
    return [
      `${withoutExtension}.ts`,
      `${withoutExtension}.tsx`,
      basePath,
    ]
  }
  if (extension === '.mjs') {
    return [`${basePath.slice(0, -extension.length)}.mts`, basePath]
  }
  if (extension === '.cjs') {
    return [`${basePath.slice(0, -extension.length)}.cts`, basePath]
  }
  if (extension !== '') return [basePath]

  return [
    ...sourceExtensions.map((candidateExtension) => `${basePath}${candidateExtension}`),
    ...sourceExtensions.map((candidateExtension) => resolve(basePath, `index${candidateExtension}`)),
  ]
}

function resolveRelativeSource(importerPath: string, specifier: string): string | null {
  for (const candidate of sourceCandidates(importerPath, specifier)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return realpathSync(candidate)
    }
  }
  return null
}

function buildImportGraph(entryPath: string): ImportGraph {
  const modules = new Map<string, string>()
  const paths = new Map<string, readonly string[]>()
  const unresolved: string[] = []
  const entry = realpathSync(entryPath)
  const pending: Array<Readonly<{
    modulePath: string
    path: readonly string[]
  }>> = [{ modulePath: entry, path: [entry] }]

  while (pending.length > 0) {
    const { modulePath, path } = pending.pop()!
    if (modules.has(modulePath)) continue

    const source = readFileSync(modulePath, 'utf8')
    modules.set(modulePath, source)
    paths.set(modulePath, path)
    for (const specifier of staticModuleSpecifiers(modulePath, source)) {
      if (!specifier.startsWith('.')) continue
      const candidates = sourceCandidates(modulePath, specifier)
      if (candidates.length === 0) continue
      const resolvedModule = resolveRelativeSource(modulePath, specifier)
      if (resolvedModule === null) {
        unresolved.push(`${normalizedProjectPath(modulePath)} -> ${specifier}`)
      } else if (!modules.has(resolvedModule)) {
        pending.push({
          modulePath: resolvedModule,
          path: [...path, resolvedModule],
        })
      }
    }
  }

  return {
    modules,
    paths,
    unresolved: Object.freeze(unresolved.sort()),
  }
}

function isForbiddenProductionLane(modulePath: string): boolean {
  if (
    modulePath.startsWith('src/domain/project/')
    || modulePath.startsWith('src/domain/robot/')
    || modulePath.startsWith('src/domain/scene/')
  ) {
    return true
  }
  if (
    modulePath.startsWith('src/features/equipment/')
    || modulePath.startsWith('src/features/objects/')
  ) {
    return true
  }
  if (modulePath.startsWith('src/features/import/')) {
    return !neutralSharedImportModules.has(modulePath)
  }
  if (
    modulePath.startsWith('src/features/frames/')
    || modulePath.startsWith('src/features/interaction/')
    || modulePath.startsWith('src/features/joints/')
    || modulePath.startsWith('src/features/robot/')
  ) {
    return !modulePath.includes('/v4/')
  }
  if (modulePath === 'src/features/jobs/RobotJobList.tsx') return true
  if (modulePath === 'src/features/jobs/job-command-service.ts') return true
  if (modulePath === 'src/features/ui/Timeline.tsx') return true

  const projectPrefix = 'src/features/project/'
  if (modulePath.startsWith(projectPrefix)) {
    return forbiddenProjectModules.has(modulePath.slice(projectPrefix.length))
  }
  const scenePrefix = 'src/features/scene/'
  if (modulePath.startsWith(scenePrefix)) {
    return forbiddenSceneModules.has(modulePath.slice(scenePrefix.length))
  }
  const viewportPrefix = 'src/features/viewport/'
  if (modulePath.startsWith(viewportPrefix)) {
    return forbiddenViewportModules.has(modulePath.slice(viewportPrefix.length))
  }
  return modulePath === 'src/features/collision/CollisionPanel.tsx'
}

describe('Project V4 production import graph', () => {
  it('reaches only V4 runtime lanes and neutral shared UI from main.tsx', () => {
    const graph = buildImportGraph(productionEntry)
    const forbiddenModules = [...graph.modules.keys()]
      .filter((modulePath) => isForbiddenProductionLane(normalizedProjectPath(modulePath)))
      .map((modulePath) => graph.paths.get(modulePath)!
        .map(normalizedProjectPath)
        .join(' -> '))
      .sort()
    const forbiddenSymbolHits = [...graph.modules.entries()]
      .flatMap(([modulePath, source]) => forbiddenSymbolsInSource(
        modulePath,
        source,
      )
        .map((symbol) => `${normalizedProjectPath(modulePath)}: ${symbol}`))
      .sort()
    const forbiddenSourceFragmentHits = [...graph.modules.entries()]
      .flatMap(([modulePath, source]) => forbiddenProductionSourceFragments
        .filter(({ pattern }) => pattern.test(source))
        .map(({ label }) => `${normalizedProjectPath(modulePath)}: ${label}`))
      .sort()

    expect(graph.unresolved, 'all relative production source edges must resolve').toEqual([])
    expect(forbiddenModules, 'legacy production modules remain reachable').toEqual([])
    expect(forbiddenSymbolHits, 'fixed-lane symbols remain reachable').toEqual([])
    expect(
      forbiddenSourceFragmentHits,
      'fixed-lane regex or template fragments remain reachable',
    ).toEqual([])
  })
})
