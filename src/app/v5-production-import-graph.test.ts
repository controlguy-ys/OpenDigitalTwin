/// <reference types="node" />

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const projectRoot = realpathSync(process.cwd())
const productionEntry = resolve(projectRoot, 'src/main.tsx')
const sourceExtensions = Object.freeze([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
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
  'computeSerialRobotPoseV4',
  'WorkcellProjectV4',
])
const forbiddenProductionSourceFragments = Object.freeze([
  Object.freeze({ label: 'fixed-six robot collision id', pattern: /robot-link:LINK0/u }),
  Object.freeze({ label: 'Project V4 assertion', pattern: /as\s+WorkcellProjectV4/u }),
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
    case '.tsx': return ts.ScriptKind.TSX
    case '.jsx': return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs': return ts.ScriptKind.JS
    default: return ts.ScriptKind.TS
  }
}

function sourceFileFor(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKindFor(filePath))
}

function staticModuleSpecifiers(filePath: string, source: string): readonly string[] {
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
  visit(sourceFileFor(filePath, source))
  return specifiers
}

function forbiddenSymbolsInSource(filePath: string, source: string): readonly string[] {
  const forbidden = new Set<string>(forbiddenProductionSymbols)
  const hits = new Set<string>()
  const visit = (node: ts.Node): void => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && forbidden.has(node.text)) {
      hits.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFileFor(filePath, source))
  return [...hits]
}

function sourceCandidates(importerPath: string, rawSpecifier: string): readonly string[] {
  const specifier = rawSpecifier.split(/[?#]/u, 1)[0]!
  if (!specifier.startsWith('.')) return []
  const basePath = resolve(dirname(importerPath), specifier)
  const extension = extname(basePath).toLowerCase()
  if (extension !== '' && !sourceExtensions.includes(extension)) return []
  if (extension === '.js' || extension === '.jsx') {
    const base = basePath.slice(0, -extension.length)
    return [`${base}.ts`, `${base}.tsx`, basePath]
  }
  if (extension === '.mjs') return [`${basePath.slice(0, -extension.length)}.mts`, basePath]
  if (extension === '.cjs') return [`${basePath.slice(0, -extension.length)}.cts`, basePath]
  if (extension !== '') return [basePath]
  return [
    ...sourceExtensions.map((candidateExtension) => `${basePath}${candidateExtension}`),
    ...sourceExtensions.map((candidateExtension) => resolve(basePath, `index${candidateExtension}`)),
  ]
}

function resolveRelativeSource(importerPath: string, specifier: string): string | null {
  for (const candidate of sourceCandidates(importerPath, specifier)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate)
  }
  return null
}

function buildImportGraph(entryPath: string): ImportGraph {
  const modules = new Map<string, string>()
  const paths = new Map<string, readonly string[]>()
  const unresolved: string[] = []
  const entry = realpathSync(entryPath)
  const pending: Array<{ readonly modulePath: string; readonly path: readonly string[] }> = [{
    modulePath: entry,
    path: [entry],
  }]
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
        pending.push({ modulePath: resolvedModule, path: [...path, resolvedModule] })
      }
    }
  }
  return { modules, paths, unresolved: Object.freeze(unresolved.sort()) }
}

function isForbiddenProductionLane(modulePath: string): boolean {
  return [
    'src/core/project-v4/',
    'src/features/project/v4/',
    'src/features/jobs/v4/',
    'src/features/runtime-gateway/v4/',
  ].some((prefix) => modulePath.startsWith(prefix))
}

describe('Project V5 production import graph', () => {
  it('reaches only Project V5 authorities and project-neutral shared surfaces from main.tsx', () => {
    const graph = buildImportGraph(productionEntry)
    const forbiddenModules = [...graph.modules.keys()]
      .filter((modulePath) => isForbiddenProductionLane(normalizedProjectPath(modulePath)))
      .map((modulePath) => graph.paths.get(modulePath)!.map(normalizedProjectPath).join(' -> '))
      .sort()
    const forbiddenSymbolHits = [...graph.modules.entries()]
      .flatMap(([modulePath, source]) => forbiddenSymbolsInSource(modulePath, source)
        .map((symbol) => `${normalizedProjectPath(modulePath)}: ${symbol}`))
      .sort()
    const forbiddenSourceFragmentHits = [...graph.modules.entries()]
      .flatMap(([modulePath, source]) => forbiddenProductionSourceFragments
        .filter(({ pattern }) => pattern.test(source))
        .map(({ label }) => `${normalizedProjectPath(modulePath)}: ${label}`))
      .sort()

    expect(graph.unresolved, 'all relative production source edges must resolve').toEqual([])
    expect(forbiddenModules, 'Project V4 authorities remain reachable').toEqual([])
    expect(forbiddenSymbolHits, 'fixed or legacy symbols remain reachable').toEqual([])
    expect(forbiddenSourceFragmentHits, 'fixed-lane source fragments remain reachable').toEqual([])
    expect(graph.modules.has(realpathSync(resolve(projectRoot, 'src/app/v6/AppV6.tsx')))).toBe(true)
  })
})
