import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

function requirePattern(errors, text, pattern, message) {
  if (!pattern.test(text)) errors.push(message)
}

export function validateDeploymentContract(files) {
  const errors = []
  requirePattern(errors, files.dockerfile, /FROM\s+node:22-alpine\s+AS\s+build/i, 'Web Dockerfile must use a pinned multi-stage Node build.')
  requirePattern(errors, files.dockerfile, /npm ci/, 'Web Dockerfile must use npm ci.')
  requirePattern(errors, files.dockerfile, /nginxinc\/nginx-unprivileged:1\.27-alpine/, 'Web runtime must use pinned unprivileged Nginx.')
  requirePattern(errors, files.dockerfile, /USER\s+101/, 'Web runtime must declare its non-root user.')
  requirePattern(errors, files.connectorDockerfile, /USER\s+node/, 'Connector must declare its non-root user.')
  requirePattern(errors, files.nginx, /location\s*=\s*\/healthz/, 'Nginx must expose /healthz.')
  requirePattern(errors, files.nginx, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/, 'Nginx must provide SPA fallback.')
  requirePattern(errors, files.nginx, /proxy_set_header\s+Upgrade/, 'Nginx must proxy WebSocket Upgrade headers.')
  requirePattern(errors, files.nginx, /immutable/, 'Nginx must cache hashed assets as immutable.')
  requirePattern(errors, files.nginx, /resolver\s+127\.0\.0\.11/, 'Nginx must defer optional connector DNS to Docker.')
  requirePattern(errors, files.compose, /profiles:\s*\[?['"]?opcua/i, 'Compose must gate the connector with the opcua profile.')
  requirePattern(errors, files.compose, /opcua\.config\.json:ro/, 'Compose must mount OPC UA configuration read-only.')
  if ((files.compose.match(/read_only:\s*true/g) ?? []).length < 2) errors.push('Both services must use read-only root filesystems.')
  if ((files.compose.match(/cap_drop:/g) ?? []).length < 2 || (files.compose.match(/- ALL/g) ?? []).length < 2) errors.push('Both services must drop all capabilities.')
  if ((files.compose.match(/no-new-privileges:true/g) ?? []).length < 2) errors.push('Both services must set no-new-privileges.')
  if ((files.compose.match(/healthcheck:/g) ?? []).length < 2) errors.push('Both services must define health checks.')
  requirePattern(errors, files.compose, /pids_limit:/, 'Compose must bound process counts.')
  requirePattern(errors, files.compose, /mem_limit:/, 'Compose must bound memory.')
  requirePattern(errors, files.compose, /cpus:/, 'Compose must bound CPU.')
  requirePattern(
    errors,
    files.compose,
    /\/home\/node\/\.config:.*uid=1000.*gid=1000/,
    'Connector must provide its node-owned PKI configuration path as tmpfs.',
  )
  requirePattern(errors, files.dockerignore, /node_modules/, '.dockerignore must exclude node_modules.')
  if (/privileged:\s*true|network_mode:\s*host|docker\.sock/i.test(files.compose)) {
    errors.push('Compose must not use privileged mode, host networking, or the Docker socket.')
  }
  return errors
}

export async function validateDeploymentFiles(root) {
  const read = (path) => readFile(resolve(root, path), 'utf8')
  const [dockerfile, connectorDockerfile, nginx, compose, dockerignore] = await Promise.all([
    read('Dockerfile'),
    read('middleware/Dockerfile'),
    read('deploy/nginx.conf'),
    read('compose.yaml'),
    read('.dockerignore'),
  ])
  return validateDeploymentContract({ dockerfile, connectorDockerfile, nginx, compose, dockerignore })
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const errors = await validateDeploymentFiles(root)
  if (errors.length > 0) {
    errors.forEach((error) => console.error(`[deploy] ${error}`))
    process.exitCode = 1
  } else {
    console.log('[deploy] static deployment contract valid')
  }
}
