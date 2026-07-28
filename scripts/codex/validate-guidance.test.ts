import { describe, expect, it } from 'vitest'
import { validateGuidanceSnapshot } from './validate-guidance.mjs'

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
})
