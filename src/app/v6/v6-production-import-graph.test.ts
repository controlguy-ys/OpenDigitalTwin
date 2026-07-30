import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const projectRoot = realpathSync(process.cwd())
const sourceExtensions = Object.freeze([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
])

interface V6ProductionBoundary {
  readonly productionFiles: readonly string[]
  readonly imports: readonly string[]
  readonly forbiddenImports: readonly string[]
}

function normalizedPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).replaceAll('\\', '/')
}

function sourceFiles(root: string): readonly string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return []
      return sourceFiles(absolutePath)
    }
    if (
      !entry.isFile()
      || !sourceExtensions.includes(extname(entry.name))
      || /\.(?:spec|test)\.[^.]+$/u.test(entry.name)
    ) return []
    return [realpathSync(absolutePath)]
  })
}

function isV6FeatureSource(root: string, filePath: string): boolean {
  return /^src\/features\/(?:.+\/)?v6\//u.test(normalizedPath(root, filePath))
}

function v6ProductionFiles(root: string): readonly string[] {
  return [
    ...sourceFiles(resolve(root, 'src/app/v6')),
    ...sourceFiles(resolve(root, 'src/features'))
      .filter((filePath) => isV6FeatureSource(root, filePath)),
  ].sort((left, right) => normalizedPath(root, left).localeCompare(normalizedPath(root, right)))
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

function importedModules(filePath: string): readonly string[] {
  const source = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  )
  const imports: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined
      && ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push(node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      imports.push(node.arguments[0]!.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
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
    if (existsSync(candidate)) return realpathSync(candidate)
  }
  return null
}

function isForbiddenV6Import(root: string, targetPath: string): boolean {
  const target = normalizedPath(root, targetPath)
  return (
    /^src\/app\/(?:legacy|v4)\//u.test(target)
    || /^src\/features\/.+\/(?:legacy|v4)\//u.test(target)
  )
}

function inspectV6ProductionBoundary(root: string): V6ProductionBoundary {
  const productionFiles = v6ProductionFiles(root)
  const imports = productionFiles.flatMap((filePath) => importedModules(filePath)
    .map((specifier) => resolveRelativeSource(filePath, specifier))
    .filter((targetPath): targetPath is string => targetPath !== null)
    .map((targetPath) => ({
      targetPath,
      description: `${normalizedPath(root, filePath)} -> ${normalizedPath(root, targetPath)}`,
    })))
  return {
    productionFiles: productionFiles.map((filePath) => normalizedPath(root, filePath)),
    imports: imports.map(({ description }) => description).sort(),
    forbiddenImports: imports
      .filter(({ targetPath }) => isForbiddenV6Import(root, targetPath))
      .map(({ description }) => description)
      .sort(),
  }
}

describe('V6 production import graph', () => {
  it('discovers nested V6 sources, excludes tests, and resolves forbidden imports', () => {
    const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'open-digital-twin-v6-imports-')))
    try {
      const appV6Root = resolve(fixtureRoot, 'src/app/v6')
      const appV4Root = resolve(fixtureRoot, 'src/app/v4')
      const nestedV6Root = resolve(fixtureRoot, 'src/features/nested/tool/v6')
      const featureV4Root = resolve(fixtureRoot, 'src/features/ui/v4')
      mkdirSync(appV6Root, { recursive: true })
      mkdirSync(appV4Root, { recursive: true })
      mkdirSync(nestedV6Root, { recursive: true })
      mkdirSync(featureV4Root, { recursive: true })
      writeFileSync(resolve(appV6Root, 'AppV6.ts'), "import '../v4/legacy-app.js'\n")
      writeFileSync(resolve(appV4Root, 'legacy-app.ts'), 'export {}\n')
      writeFileSync(
        resolve(nestedV6Root, 'nested-command.ts'),
        "import '../../../ui/v4/legacy-feature.js'\n",
      )
      writeFileSync(resolve(featureV4Root, 'legacy-feature.ts'), 'export {}\n')
      writeFileSync(
        resolve(nestedV6Root, 'ignored.test.ts'),
        "import '../../../ui/v4/legacy-feature.js'\n",
      )

      const boundary = inspectV6ProductionBoundary(fixtureRoot)

      expect(boundary.productionFiles).toEqual([
        'src/app/v6/AppV6.ts',
        'src/features/nested/tool/v6/nested-command.ts',
      ])
      expect(boundary.forbiddenImports).toEqual([
        'src/app/v6/AppV6.ts -> src/app/v4/legacy-app.ts',
        'src/features/nested/tool/v6/nested-command.ts -> src/features/ui/v4/legacy-feature.ts',
      ])
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('contains the V6 boundary modules and never imports a V4 application or feature surface', () => {
    const boundary = inspectV6ProductionBoundary(projectRoot)

    expect(boundary.productionFiles).toEqual(expect.arrayContaining([
      'src/features/commands/v6/app-command-v6.ts',
      'src/features/interaction/v6/workcell-selection-v6.ts',
    ]))
    expect(boundary.forbiddenImports).toEqual([])
    expect(boundary.imports).not.toContainEqual(
      expect.stringMatching(/ -> src\/(?:app\/v4|features\/.+\/v4)\//u),
    )
  })
})
