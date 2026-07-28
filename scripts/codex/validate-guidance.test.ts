import { describe, expect, it } from 'vitest'
// @ts-expect-error The production validator is intentionally plain ESM without a declaration file.
import { validateGuidanceSnapshot, validateSkillSnapshot } from './validate-guidance.mjs'

const skill = (name: string, description: string, body = '1. Inspect the workflow.\n') => [
  '---',
  `name: ${name}`,
  `description: ${description}`,
  '---',
  body,
].join('\n')

describe('Codex repository guidance', () => {
  it('requires the exact instruction hierarchy and critical root sections', () => {
    const result = validateGuidanceSnapshot(new Map([
      ['AGENTS.md', '# OpenDigitalTwin\n'],
      ['src/core/project-v5/AGENTS.md', '# Project V5\n'],
      ['middleware/runtime-gateway/AGENTS.md', '# Gateway\n'],
      ['tests/AGENTS.md', '# Tests\n'],
    ]))
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('AGENTS.md is missing section: ## Verification')
  })

  it('rejects guidance that re-enables Legacy behavior', () => {
    const result = validateGuidanceSnapshot(new Map([
      ['AGENTS.md', [
        '# OpenDigitalTwin', '## Architecture', 'Project V5',
        '## Commands', 'npm run verify', '## Safety', 'OPC UA',
        '## Verification', 'Acceptance', 'Enable Legacy adapter by default.',
      ].join('\n')],
      ['src/core/project-v5/AGENTS.md', '# Project V5'],
      ['middleware/runtime-gateway/AGENTS.md', '# Gateway'],
      ['tests/AGENTS.md', '# Tests'],
    ]))
    expect(result.errors).toContain('AGENTS.md must not enable Legacy behavior.')
  })

  it('requires three focused repo Skills with valid frontmatter', () => {
    const result = validateSkillSnapshot(new Map([
      ['.agents/skills/robot-asset-onboarding/SKILL.md', 'missing frontmatter'],
    ]))

    expect(result.ok).toBe(false)
    expect(result.errors).toContain(
      'Missing Skill: .agents/skills/opcua-runtime-diagnostics/SKILL.md',
    )
    expect(result.errors).toContain(
      '.agents/skills/robot-asset-onboarding/SKILL.md has invalid frontmatter.',
    )
  })

  it('rejects duplicate Skill metadata, oversized descriptions, and a missing Robot acceptance reference', () => {
    const result = validateSkillSnapshot(new Map([
      ['.agents/skills/robot-asset-onboarding/SKILL.md', skill(
        'robot-asset-onboarding',
        'Shared description',
      )],
      ['.agents/skills/opcua-runtime-diagnostics/SKILL.md', skill(
        'robot-asset-onboarding',
        'Shared description',
      )],
      ['.agents/skills/release-verification/SKILL.md', skill(
        'release-verification',
        'x'.repeat(513),
      )],
    ]))

    expect(result.errors).toContain('Duplicate Skill name: robot-asset-onboarding.')
    expect(result.errors).toContain('Duplicate Skill description: Shared description.')
    expect(result.errors).toContain(
      '.agents/skills/release-verification/SKILL.md description exceeds 512 UTF-8 bytes.',
    )
    expect(result.errors).toContain(
      '.agents/skills/robot-asset-onboarding/SKILL.md must reference references/acceptance.md.',
    )
  })

  it('accepts the three required Skills when their metadata and Robot acceptance reference are valid', () => {
    const result = validateSkillSnapshot(new Map([
      ['.agents/skills/robot-asset-onboarding/SKILL.md', skill(
        'robot-asset-onboarding',
        'Inspect Robot assets.',
        '1. Read `references/acceptance.md`.\n',
      )],
      ['.agents/skills/opcua-runtime-diagnostics/SKILL.md', skill(
        'opcua-runtime-diagnostics',
        'Diagnose OPC UA runtime state.',
      )],
      ['.agents/skills/release-verification/SKILL.md', skill(
        'release-verification',
        'Verify a closed release scope.',
      )],
      ['.agents/skills/robot-asset-onboarding/references/acceptance.md', '# Acceptance\n'],
    ]))

    expect(result).toEqual({ ok: true, errors: [] })
  })
})
