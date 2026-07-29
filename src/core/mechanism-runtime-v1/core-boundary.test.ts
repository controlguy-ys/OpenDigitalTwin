import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const rawCoreModules = import.meta.glob('./**/*.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const CORE_DIRECTORY = 'src/core/mechanism-runtime-v1'
const PERMITTED_EXTERNAL_DEPENDENCY = '../project-v5/rigid-transform.js'
const FORBIDDEN_RUNTIME_IDENTIFIERS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'Element', 'Node',
  'Document', 'Window', 'Navigator', 'Location', 'History', 'Event', 'EventTarget', 'WebSocket',
  'XMLHttpRequest', 'EventSource', 'fetch', 'Worker', 'SharedWorker', 'ServiceWorker',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'Cache', 'CacheStorage', 'cookieStore',
  'process', 'Buffer', 'require', 'module', '__dirname', '__filename', 'React', 'THREE',
])

function isForbiddenRuntimeIdentifier(identifier: string): boolean {
  return FORBIDDEN_RUNTIME_IDENTIFIERS.has(identifier)
    || identifier.startsWith('OPCUA')
    || identifier.endsWith('V4')
}

interface ProductionCoreModule {
  readonly path: string
  readonly source: string
}

interface CoreBoundaryReport {
  readonly productionPaths: readonly string[]
  readonly unresolvedRelativeImports: readonly string[]
  readonly forbiddenImports: readonly string[]
  readonly forbiddenRuntimeIdentifiers: readonly string[]
  readonly parserFailures: readonly string[]
}

function normalizePosixPath(value: string): string | null {
  const segments: string[] = []
  for (const segment of value.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

function compareProductionPaths(left: string, right: string): number {
  return left.localeCompare(right)
}

function discoveredProductionPaths(
  rawModules: Readonly<Record<string, string>> = rawCoreModules,
): readonly string[] {
  return Object.keys(rawModules)
    .map((globPath) => {
      const path = normalizePosixPath(`${CORE_DIRECTORY}/${globPath}`)
      if (path === null || !path.startsWith(`${CORE_DIRECTORY}/`)) {
        throw new Error(`Mechanism Runtime V1 source glob escaped ${CORE_DIRECTORY}: ${globPath}`)
      }
      return path
    })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('/test-support.ts'))
    .sort(compareProductionPaths)
}

function productionCoreModules(
  rawModules: Readonly<Record<string, string>> = rawCoreModules,
): readonly ProductionCoreModule[] {
  return Object.entries(rawModules)
    .map(([globPath, source]) => {
      const path = normalizePosixPath(`${CORE_DIRECTORY}/${globPath}`)
      if (path === null || !path.startsWith(`${CORE_DIRECTORY}/`)) {
        throw new Error(`Mechanism Runtime V1 source glob escaped ${CORE_DIRECTORY}: ${globPath}`)
      }
      return { path, source }
    })
    .filter(({ path }) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('/test-support.ts'))
    .sort((left, right) => compareProductionPaths(left.path, right.path))
}

function isPermittedExternalDependency(specifier: string): boolean {
  return specifier === PERMITTED_EXTERNAL_DEPENDENCY
}

function isForbiddenImport(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/')
  return (!normalized.startsWith('./') && !normalized.startsWith('../'))
    || (!isPermittedExternalDependency(normalized) && normalized.includes('project-v4'))
    || (normalized.startsWith('../') && !isPermittedExternalDependency(normalized))
}

function resolveRelativeImport(
  importerPath: string,
  specifier: string,
  productionPaths: ReadonlySet<string>,
): string | null {
  if (specifier === PERMITTED_EXTERNAL_DEPENDENCY) return PERMITTED_EXTERNAL_DEPENDENCY
  const directory = importerPath.slice(0, importerPath.lastIndexOf('/'))
  const normalized = normalizePosixPath(`${directory}/${specifier}`)
  if (normalized === null || !normalized.startsWith(`${CORE_DIRECTORY}/`)) return null
  const candidates = normalized.endsWith('.js')
    ? [`${normalized.slice(0, -3)}.ts`]
    : normalized.endsWith('.ts')
      ? [normalized]
      : [`${normalized}.ts`, `${normalized}/index.ts`]
  const matches = candidates.filter((candidate) => productionPaths.has(candidate))
  return matches.length === 1 ? matches[0]! : null
}

function moduleSpecifiers(sourceFile: ts.SourceFile): readonly string[] {
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      specifiers.push(node.argument.literal.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (node.arguments.length === 1 && argument !== undefined && ts.isStringLiteralLike(argument)) specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`
}

function scanMechanismRuntimeV1(
  rawModules: Readonly<Record<string, string>> = rawCoreModules,
): CoreBoundaryReport {
  const modules = productionCoreModules(rawModules)
  const productionPaths = new Set(modules.map(({ path }) => path))
  const unresolvedRelativeImports: string[] = []
  const forbiddenImports: string[] = []
  const forbiddenRuntimeIdentifiers: string[] = []
  const parserFailures: string[] = []

  for (const module of modules) {
    const sourceFile = ts.createSourceFile(module.path, module.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const diagnostics = (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
    parserFailures.push(...diagnostics.map((diagnostic) => (
      `${module.path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
    )))
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (isForbiddenImport(specifier)) forbiddenImports.push(`${module.path}: ${specifier}`)
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && resolveRelativeImport(module.path, specifier, productionPaths) === null) {
        unresolvedRelativeImports.push(`${module.path}: ${specifier}`)
      }
    }
    const visitIdentifiers = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && isForbiddenRuntimeIdentifier(node.text)) {
        forbiddenRuntimeIdentifiers.push(`${sourceLocation(sourceFile, node)}: ${node.text}`)
      }
      ts.forEachChild(node, visitIdentifiers)
    }
    visitIdentifiers(sourceFile)
  }

  return {
    productionPaths: [...productionPaths].sort(compareProductionPaths),
    unresolvedRelativeImports,
    forbiddenImports,
    forbiddenRuntimeIdentifiers,
    parserFailures,
  }
}

describe('Mechanism Runtime V1 core boundary', () => {
  it('scans every production module and permits only the Project V5 rigid-transform dependency', () => {
    const report = scanMechanismRuntimeV1()

    expect(report.productionPaths).toEqual(discoveredProductionPaths())
    expect(report.unresolvedRelativeImports).toEqual([])
    expect(report.forbiddenImports).toEqual([])
    expect(report.forbiddenRuntimeIdentifiers).toEqual([])
    expect(report.parserFailures).toEqual([])
  })

  it('uses the discovery comparator for scanner output with case-sensitive paths', () => {
    const rawModules = {
      './a.ts': 'export {}',
      './A.ts': 'export {}',
    }

    expect(scanMechanismRuntimeV1(rawModules).productionPaths).toEqual(discoveredProductionPaths(rawModules))
  })

  it('rejects bare platform dependencies and runtime globals in a synthetic production module', () => {
    const report = scanMechanismRuntimeV1({
      './synthetic.ts': `
        import React from 'react'
        import * as THREE from 'three'
        import { create } from 'zustand'
        import fs from 'node:fs'
        import { OPCUAClient } from 'node-opcua'
        import { readFile } from 'fs/promises'
        import { WorkcellProjectV4 } from '../project-v4/index.js'
        void window
        void document
        void localStorage
        void new WebSocket('ws://example.test')
        void new Worker('worker.js')
        void fetch('https://example.test')
        void process
      `,
    })

    expect(report.forbiddenImports).toEqual([
      'src/core/mechanism-runtime-v1/synthetic.ts: react',
      'src/core/mechanism-runtime-v1/synthetic.ts: three',
      'src/core/mechanism-runtime-v1/synthetic.ts: zustand',
      'src/core/mechanism-runtime-v1/synthetic.ts: node:fs',
      'src/core/mechanism-runtime-v1/synthetic.ts: node-opcua',
      'src/core/mechanism-runtime-v1/synthetic.ts: fs/promises',
      'src/core/mechanism-runtime-v1/synthetic.ts: ../project-v4/index.js',
    ])
    expect(report.unresolvedRelativeImports).toEqual([
      'src/core/mechanism-runtime-v1/synthetic.ts: ../project-v4/index.js',
    ])
    expect(report.forbiddenRuntimeIdentifiers.map((finding) => finding.slice(finding.lastIndexOf(': ') + 2))).toEqual([
      'React', 'THREE', 'OPCUAClient', 'WorkcellProjectV4', 'window', 'document', 'localStorage', 'WebSocket', 'Worker', 'fetch', 'process',
    ])
  })
})
