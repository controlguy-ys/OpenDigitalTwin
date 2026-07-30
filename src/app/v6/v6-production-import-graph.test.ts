import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const projectRoot = realpathSync(process.cwd())
const v6ProductionRoots = [
  'src/app/v6',
  'src/features/commands/v6',
  'src/features/interaction/v6',
] as const
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])

function normalizedProjectPath(absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/')
}

function productionFiles(root: string): readonly string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(root, entry.name)
    if (entry.isDirectory()) return productionFiles(absolutePath)
    if (
      !entry.isFile()
      || !sourceExtensions.has(extname(entry.name))
      || entry.name.includes('.test.')
    ) return []
    return [realpathSync(absolutePath)]
  })
}

function importedModules(filePath: string): readonly string[] {
  const source = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const imports: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) imports.push(node.moduleSpecifier.text)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
}

describe('V6 production import graph', () => {
  it('contains the V6 boundary modules and never imports a V4 application or feature surface', () => {
    const productionV6Imports = v6ProductionRoots
      .flatMap((root) => productionFiles(resolve(projectRoot, root)))
      .flatMap((filePath) => importedModules(filePath).map((specifier) => ({
        file: normalizedProjectPath(filePath), specifier,
      })))
      .map(({ file, specifier }) => `${file} -> ${specifier}`)

    expect(existsSync(resolve(projectRoot, 'src/features/commands/v6/app-command-v6.ts')))
      .toBe(true)
    expect(existsSync(resolve(projectRoot, 'src/features/interaction/v6/workcell-selection-v6.ts')))
      .toBe(true)
    expect(productionV6Imports).not.toContainEqual(
      expect.stringMatching(/\/(?:app|features)\/.*\/v4\//u),
    )
  })
})
