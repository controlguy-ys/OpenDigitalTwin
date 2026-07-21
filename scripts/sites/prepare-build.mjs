import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = resolve(scriptDirectory, '..', '..')
const source = resolve(scriptDirectory, 'worker.js')
const destination = resolve(projectDirectory, 'dist', 'server', 'index.js')

await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
