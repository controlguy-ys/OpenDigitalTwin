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

  it('reports missing Runtime Gateway proxy, service, OPC UA port, and hardening contracts', () => {
    const errors = validateDeploymentContract({
      dockerfile: 'FROM node:22-alpine',
      gatewayDockerfile: 'FROM node:22-alpine',
      nginx: 'server { listen 8080; }',
      compose: 'services: { web: {} }',
      dockerignore: 'node_modules',
    })

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/multi-stage/i),
      expect.stringMatching(/healthz/i),
      expect.stringMatching(/Runtime Gateway/i),
      expect.stringMatching(/OPC UA port/i),
      expect.stringMatching(/read-only/i),
      expect.stringMatching(/capabilities/i),
      expect.stringMatching(/PKI.*tmpfs/i),
    ]))
  })

  it('rejects the removed Connector profile and legacy proxy surface', () => {
    const deployment = {
      dockerfile: [
        'FROM node:22-alpine AS build',
        'RUN npm ci',
        'FROM nginxinc/nginx-unprivileged:1.27-alpine',
        'USER 101',
      ].join('\n'),
      gatewayDockerfile: 'FROM node:22-alpine\nUSER node',
      nginx: [
        'resolver 127.0.0.11;',
        'location = /healthz {}',
        'location /runtime/ { proxy_pass http://runtime-gateway:8081; }',
        'location /assets/ { add_header Cache-Control immutable; }',
        'location / { try_files $uri $uri/ /index.html; }',
      ].join('\n'),
      compose: [
        'services:',
        '  web:',
        '    read_only: true',
        '    cap_drop: [- ALL]',
        '    security_opt: [- no-new-privileges:true]',
        '    healthcheck: {}',
        '  opcua-connector:',
        '    profiles: [opcua]',
        '    read_only: true',
        '    cap_drop: [- ALL]',
        '    security_opt: [- no-new-privileges:true]',
        '    healthcheck: {}',
        '    pids_limit: 128',
        '    mem_limit: 512m',
        '    cpus: 1.0',
        '    ports: [- 4840:4840]',
        '    tmpfs: [- /tmp:size=16m]',
      ].join('\n'),
      dockerignore: 'node_modules',
    }

    expect(validateDeploymentContract(deployment)).toEqual(expect.arrayContaining([
      expect.stringMatching(/runtime-gateway service/i),
      expect.stringMatching(/legacy opcua-connector/i),
      expect.stringMatching(/profile/i),
    ]))
  })
})
