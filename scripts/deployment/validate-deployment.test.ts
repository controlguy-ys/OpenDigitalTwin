import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validateDeploymentContract,
  validateDeploymentFiles,
} from './validate-deployment.mjs'

describe('deployment contract', () => {
  it('validates the checked-in hardened Compose deployment', async () => {
    await expect(validateDeploymentFiles(resolve('.'))).resolves.toEqual([])
  })

  it('reports missing health, WebSocket, and hardening contracts', () => {
    const errors = validateDeploymentContract({
      dockerfile: 'FROM node:22-alpine',
      connectorDockerfile: 'FROM node:22-alpine',
      nginx: 'server { listen 8080; }',
      compose: 'services: { web: {} }',
      dockerignore: 'node_modules',
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/multi-stage/i),
      expect.stringMatching(/healthz/i),
      expect.stringMatching(/WebSocket/i),
      expect.stringMatching(/profile/i),
      expect.stringMatching(/read-only/i),
      expect.stringMatching(/capabilities/i),
      expect.stringMatching(/PKI.*tmpfs/i),
    ]))
  })
})
