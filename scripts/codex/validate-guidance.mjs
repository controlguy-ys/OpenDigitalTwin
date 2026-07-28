import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_FILES = Object.freeze([
  'AGENTS.md',
  'src/core/project-v5/AGENTS.md',
  'middleware/runtime-gateway/AGENTS.md',
  'tests/AGENTS.md',
])

const ROOT_SECTIONS = Object.freeze([
  '## Architecture',
  '## Commands',
  '## Safety',
  '## Verification',
])

export function validateGuidanceSnapshot(files) {
  const errors = []
  for (const file of REQUIRED_FILES) {
    if (!files.has(file)) errors.push(`Missing guidance file: ${file}`)
  }
  const root = files.get('AGENTS.md') ?? ''
  for (const section of ROOT_SECTIONS) {
    if (!root.includes(section)) errors.push(`AGENTS.md is missing section: ${section}`)
  }
  if (/\benable Legacy\b/iu.test(root)) {
    errors.push('AGENTS.md must not enable Legacy behavior.')
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) })
}

export async function validateGuidance(rootDirectory) {
  const entries = await Promise.all(REQUIRED_FILES.map(async (file) => {
    try {
      return [file, await readFile(resolve(rootDirectory, file), 'utf8')]
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }))
  return validateGuidanceSnapshot(new Map(entries.filter(Boolean)))
}

async function main() {
  const result = await validateGuidance(process.cwd())
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`${error}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
