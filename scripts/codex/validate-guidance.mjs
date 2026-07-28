import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_FILES = Object.freeze([
  'AGENTS.md',
  'src/core/project-v5/AGENTS.md',
  'middleware/runtime-gateway/AGENTS.md',
  'tests/AGENTS.md',
])

const REQUIRED_SKILLS = Object.freeze([
  '.agents/skills/robot-asset-onboarding/SKILL.md',
  '.agents/skills/opcua-runtime-diagnostics/SKILL.md',
  '.agents/skills/release-verification/SKILL.md',
])

const REQUIRED_SKILL_NAMES = Object.freeze({
  '.agents/skills/robot-asset-onboarding/SKILL.md': 'robot-asset-onboarding',
  '.agents/skills/opcua-runtime-diagnostics/SKILL.md': 'opcua-runtime-diagnostics',
  '.agents/skills/release-verification/SKILL.md': 'release-verification',
})

const ROBOT_ACCEPTANCE_REFERENCE = '.agents/skills/robot-asset-onboarding/references/acceptance.md'
const SKILL_FRONTMATTER = /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: (.+)\r?\n---\r?\n/u

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
  errors.push(...validateSkillSnapshot(files).errors)
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) })
}

export function validateSkillSnapshot(files) {
  const errors = []
  const names = new Set()
  const descriptions = new Set()

  for (const file of REQUIRED_SKILLS) {
    const source = files.get(file)
    if (source === undefined) {
      errors.push(`Missing Skill: ${file}`)
      continue
    }

    const frontmatter = SKILL_FRONTMATTER.exec(source)
    if (!frontmatter) {
      errors.push(`${file} has invalid frontmatter.`)
      continue
    }

    const [, name, rawDescription] = frontmatter
    const description = rawDescription.trim()
    if (!description) {
      errors.push(`${file} has an empty description.`)
      continue
    }
    if (name !== REQUIRED_SKILL_NAMES[file]) {
      errors.push(`${file} must use name: ${REQUIRED_SKILL_NAMES[file]}.`)
    }
    if (names.has(name)) errors.push(`Duplicate Skill name: ${name}.`)
    if (descriptions.has(description)) errors.push(`Duplicate Skill description: ${description}.`)
    if (Buffer.byteLength(description, 'utf8') > 512) {
      errors.push(`${file} description exceeds 512 UTF-8 bytes.`)
    }
    names.add(name)
    descriptions.add(description)
  }

  const robotSkill = files.get('.agents/skills/robot-asset-onboarding/SKILL.md')
  if (robotSkill?.includes('references/acceptance.md') === false) {
    errors.push('.agents/skills/robot-asset-onboarding/SKILL.md must reference references/acceptance.md.')
  }
  if (!files.has(ROBOT_ACCEPTANCE_REFERENCE)) {
    errors.push(`Missing Skill reference: ${ROBOT_ACCEPTANCE_REFERENCE}`)
  }

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) })
}

export async function validateGuidance(rootDirectory) {
  const entries = await Promise.all([...REQUIRED_FILES, ...REQUIRED_SKILLS, ROBOT_ACCEPTANCE_REFERENCE].map(async (file) => {
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
