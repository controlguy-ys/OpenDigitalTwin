import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { validateStateBatchV1 } from '../runtime-protocol/v1.js'
import {
  canonicalProjectV4Json,
  configRevisionForProjectV4,
  validateWorkcellProjectV4,
} from './index.js'
import { makeMinimalWorkcellProjectV4 } from './test-support.js'

const rawCoreModules = import.meta.glob('../**/*.ts', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

const CORE_ROOT = 'src/core'
const TEST_DIRECTORY = 'src/core/project-v4'
const RUNTIME_SURFACE_CLASSIFICATION = {
  approvedPortable: [
    'crypto',
    'TextEncoder',
    'TextDecoder',
  ],
  forbidden: {
    browserTransport: [
      'BroadcastChannel',
      'MessageChannel',
      'MessagePort',
      'WebSocket',
      'XMLHttpRequest',
      'EventSource',
      'fetch',
      'WebTransport',
      'Request',
      'Response',
      'Headers',
      'FormData',
    ],
    browserWorkersAndTiming: [
      'Worker',
      'SharedWorker',
      'ServiceWorker',
      'postMessage',
      'importScripts',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
    dom: [
      'window',
      'document',
      'navigator',
      'location',
      'history',
      'HTMLElement',
      'Element',
      'Node',
      'Document',
      'Window',
      'Navigator',
      'Location',
      'History',
      'Event',
      'EventTarget',
      'MessageEvent',
      'CustomEvent',
      'MouseEvent',
      'KeyboardEvent',
      'DOMParser',
      'XMLSerializer',
      'MutationObserver',
      'ResizeObserver',
      'IntersectionObserver',
      'FileReader',
    ],
    browserState: [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'Cache',
      'CacheStorage',
      'Storage',
      'StorageManager',
      'cookieStore',
      'CookieStore',
    ],
    nodeRuntime: [
      'process',
      'Buffer',
      'require',
      'module',
      '__dirname',
      '__filename',
    ],
  },
} as const

const APPROVED_PORTABLE_RUNTIME_IDENTIFIERS = new Set<string>(
  RUNTIME_SURFACE_CLASSIFICATION.approvedPortable,
)
const FORBIDDEN_RUNTIME_SURFACE_IDENTIFIERS = new Set<string>(
  Object.values(RUNTIME_SURFACE_CLASSIFICATION.forbidden).flat(),
)

interface ProductionCoreModule {
  readonly path: string
  readonly source: string
}

interface ModuleSpecifierOccurrence {
  readonly text: string
  readonly position: number
}

interface CoreSourceGraphReport {
  readonly productionFileCount: number
  readonly moduleSpecifierCount: number
  readonly externalSpecifiers: readonly string[]
  readonly unresolvedSpecifiers: readonly string[]
  readonly forbiddenPlatformIdentifiers: readonly string[]
  readonly forbiddenReferences: readonly string[]
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

function productionCoreModules(
  rawModules: Readonly<Record<string, string>> = rawCoreModules,
): readonly ProductionCoreModule[] {
  return Object.entries(rawModules)
    .map(([globPath, source]) => {
      const path = normalizePosixPath(`${TEST_DIRECTORY}/${globPath}`)
      if (path === null || !path.startsWith(`${CORE_ROOT}/`)) {
        throw new Error(`Core source glob escaped ${CORE_ROOT}: ${globPath}`)
      }
      return { path, source }
    })
    .filter(({ path }) => (
      path.endsWith('.ts')
      && !path.endsWith('.test.ts')
      && !path.endsWith('/test-support.ts')
    ))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function collectAstModuleSpecifiers(
  sourceFile: ts.SourceFile,
  parserFailures: string[],
): readonly ModuleSpecifierOccurrence[] {
  const specifiers: ModuleSpecifierOccurrence[] = []

  const addStringLiteral = (literal: ts.StringLiteralLike): void => {
    specifiers.push({ text: literal.text, position: literal.getStart(sourceFile) })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) {
        if (ts.isStringLiteralLike(node.moduleSpecifier)) addStringLiteral(node.moduleSpecifier)
        else parserFailures.push(`${sourceFile.fileName}: non-literal import or export specifier`)
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (
        ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression !== undefined
        && ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        addStringLiteral(node.moduleReference.expression)
        return
      }
      parserFailures.push(`${sourceFile.fileName}: unrecognized import-equals declaration`)
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        addStringLiteral(node.argument.literal)
        return
      }
      parserFailures.push(`${sourceFile.fileName}: non-literal import type`)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) {
        const [argument] = node.arguments
        if (node.arguments.length === 1 && argument !== undefined && ts.isStringLiteralLike(argument)) {
          addStringLiteral(argument)
        } else {
          parserFailures.push(`${sourceFile.fileName}: non-literal dynamic import or require`)
        }
      }
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteralLike(node.name)) {
      parserFailures.push(`${sourceFile.fileName}: ambient external module ${node.name.text}`)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers.sort((left, right) => left.position - right.position)
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`
}

function resolveRelativeCoreSpecifier(
  importerPath: string,
  specifier: string,
  productionPaths: ReadonlySet<string>,
): readonly string[] {
  const directory = importerPath.slice(0, importerPath.lastIndexOf('/'))
  const normalized = normalizePosixPath(`${directory}/${specifier}`)
  if (normalized === null || !normalized.startsWith(`${CORE_ROOT}/`)) return []

  let candidates: readonly string[]
  if (normalized.endsWith('.js')) {
    candidates = [`${normalized.slice(0, -3)}.ts`]
  } else if (normalized.endsWith('.ts')) {
    candidates = [normalized]
  } else if (normalized.slice(normalized.lastIndexOf('/') + 1).includes('.')) {
    candidates = []
  } else {
    candidates = [`${normalized}.ts`, `${normalized}/index.ts`]
  }

  return candidates.filter((candidate) => productionPaths.has(candidate))
}

function classifyRuntimeSurfaceIdentifier(
  identifier: string,
): 'approved-portable' | 'forbidden' | null {
  if (APPROVED_PORTABLE_RUNTIME_IDENTIFIERS.has(identifier)) return 'approved-portable'
  if (FORBIDDEN_RUNTIME_SURFACE_IDENTIFIERS.has(identifier)) return 'forbidden'
  return null
}

function scanProductionCoreGraph(
  rawModules: Readonly<Record<string, string>> = rawCoreModules,
): CoreSourceGraphReport {
  const modules = productionCoreModules(rawModules)
  const productionPaths = new Set(modules.map(({ path }) => path))
  const externalSpecifiers: string[] = []
  const unresolvedSpecifiers: string[] = []
  const forbiddenPlatformIdentifiers: string[] = []
  const forbiddenReferences: string[] = []
  const parserFailures: string[] = []
  let moduleSpecifierCount = 0

  for (const module of modules) {
    const preprocessed = ts.preProcessFile(module.source, true, true)
    const sourceFile = ts.createSourceFile(
      module.path,
      module.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics ?? []
    for (const diagnostic of parseDiagnostics) {
      parserFailures.push(
        `${module.path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
      )
    }

    const astSpecifiers = collectAstModuleSpecifiers(sourceFile, parserFailures)
    const preprocessedSpecifiers = preprocessed.importedFiles.map(({ fileName }) => fileName)
    if (JSON.stringify(astSpecifiers.map(({ text }) => text)) !== JSON.stringify(preprocessedSpecifiers)) {
      parserFailures.push(
        `${module.path}: AST/preProcess module mismatch `
        + `${JSON.stringify(astSpecifiers.map(({ text }) => text))} != `
        + JSON.stringify(preprocessedSpecifiers),
      )
    }

    moduleSpecifierCount += preprocessedSpecifiers.length
    for (const specifier of preprocessedSpecifiers) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        externalSpecifiers.push(`${module.path}: ${specifier}`)
        continue
      }
      const resolutions = resolveRelativeCoreSpecifier(module.path, specifier, productionPaths)
      if (resolutions.length !== 1) {
        unresolvedSpecifiers.push(
          `${module.path}: ${specifier} -> ${resolutions.length === 0 ? 'missing' : resolutions.join(', ')}`,
        )
      }
    }

    for (const reference of preprocessed.referencedFiles) {
      forbiddenReferences.push(`${module.path}: path ${reference.fileName}`)
    }
    for (const reference of preprocessed.typeReferenceDirectives) {
      forbiddenReferences.push(`${module.path}: types ${reference.fileName}`)
    }
    for (const reference of preprocessed.libReferenceDirectives) {
      forbiddenReferences.push(`${module.path}: lib ${reference.fileName}`)
    }
    for (const ambientModule of preprocessed.ambientExternalModules ?? []) {
      forbiddenReferences.push(`${module.path}: ambient module ${ambientModule}`)
    }

    const visitIdentifiers = (node: ts.Node): void => {
      if (
        ts.isIdentifier(node)
        && classifyRuntimeSurfaceIdentifier(node.text) === 'forbidden'
      ) {
        forbiddenPlatformIdentifiers.push(`${sourceLocation(sourceFile, node)}: ${node.text}`)
      }
      ts.forEachChild(node, visitIdentifiers)
    }
    visitIdentifiers(sourceFile)
  }

  return {
    productionFileCount: modules.length,
    moduleSpecifierCount,
    externalSpecifiers,
    unresolvedSpecifiers,
    forbiddenPlatformIdentifiers,
    forbiddenReferences,
    parserFailures,
  }
}

function scanSyntheticCoreModule(source: string): CoreSourceGraphReport {
  return scanProductionCoreGraph({ './synthetic-runtime-surface.ts': source })
}

function reportedIdentifierNames(report: CoreSourceGraphReport): readonly string[] {
  return report.forbiddenPlatformIdentifiers.map((finding) => finding.slice(finding.lastIndexOf(': ') + 2))
}

function keyedStateBatch(configRevision: string): unknown {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-1',
    projectId: 'project-v4',
    configRevision,
    endpointId: 'endpoint-1',
    sequence: 1,
    sourceTimestampMs: 100,
    publishedTimestampMs: 101,
    originId: 'origin-1',
    values: [{
      mappingId: 'joint-J1',
      coherenceGroupId: null,
      value: 0,
      unit: 'deg',
      quality: 'GOOD',
      statusCode: 'Good',
    }],
  }
}

describe('Project V4 shared Core browser boundary', () => {
  it('validates the golden Project and keyed protocol fixture in jsdom', async () => {
    const goldenConfigRevision = 'e679de7f286e2aa5bd2c3e9ca72c32916d527c9b7a68af7a7639dc16ba519969'
    const project = validateWorkcellProjectV4(makeMinimalWorkcellProjectV4())
    const canonicalJson = canonicalProjectV4Json(project)

    expect('document' in globalThis).toBe(true)
    expect(JSON.parse(canonicalJson)).toEqual(project)
    await expect(configRevisionForProjectV4(project)).resolves.toBe(goldenConfigRevision)
    expect(validateStateBatchV1(keyedStateBatch(goldenConfigRevision))).toMatchObject({
      configRevision: goldenConfigRevision,
      values: [{ mappingId: 'joint-J1', value: 0, unit: 'deg' }],
    })
  })

  it('keeps the Gateway-emitted production Core graph relative and platform-independent', () => {
    expect(scanProductionCoreGraph()).toEqual({
      productionFileCount: 32,
      moduleSpecifierCount: 80,
      externalSpecifiers: [],
      unresolvedSpecifiers: [],
      forbiddenPlatformIdentifiers: [],
      forbiddenReferences: [],
      parserFailures: [],
    })
  })

  it('rejects browser transport, DOM, and state surfaces even when Node exposes their types', () => {
    const forbiddenSurfaceNames = [
      'BroadcastChannel',
      'MessageChannel',
      'MessagePort',
      'WebSocket',
      'Worker',
      'XMLHttpRequest',
      'EventSource',
      'fetch',
      'WebTransport',
      'DOMParser',
      'MutationObserver',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'CacheStorage',
    ] as const
    const report = scanSyntheticCoreModule(
      forbiddenSurfaceNames.map((name) => `void ${name}`).join('\n'),
    )

    expect(reportedIdentifierNames(report)).toEqual(forbiddenSurfaceNames)
  })

  it('allows approved portable crypto and text APIs plus ordinary ECMAScript globals', () => {
    const report = scanSyntheticCoreModule(`
      void globalThis.crypto
      void new TextEncoder()
      void new TextDecoder()
      void new Map()
      void new Set()
      void Promise.resolve()
      void JSON.stringify(null)
    `)

    expect(report.forbiddenPlatformIdentifiers).toEqual([])
  })
})
