import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  validateNed2GlbFile,
  validateNed2Manifest,
  validateRobotAssets,
} from './validate-robot-assets.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('NED2 asset validation', () => {
  it('accepts the nested manifest and all seven checked-in GLB containers', async () => {
    await expect(validateRobotAssets(
      resolve(process.cwd(), 'public', 'models', 'robot', 'ned2'),
    )).resolves.toBeUndefined()
  })

  it('rejects a manifest whose Link chain does not reference the NED2 assembly', () => {
    const manifest = {
      assetReference: {
        id: 'builtin-niryo-ned2-assembly-v1',
        uri: 'builtin://niryo/ned2-assembly@v1',
        sha256: '0'.repeat(64),
        byteLength: 1,
        sourceFileName: 'NED2_STEP.step',
        mediaType: 'model/step',
      },
      definition: {
        id: 'builtin-niryo-ned2-v1',
        manufacturer: 'Niryo',
        model: 'NED2',
        assetReferenceIds: ['builtin-niryo-ned2-assembly-v1'],
        sourceConventions: {
          'builtin-niryo-ned2-assembly-v1': {
            linearUnit: 'millimeter',
            sourceToMeters: 0.001,
            orientation: { mode: 'up-axis', upAxis: 'z' },
          },
        },
        links: [],
        joints: [],
        frames: [],
      },
    }

    expect(() => validateNed2Manifest(manifest)).toThrow(
      /must contain seven Links/,
    )
  })

  it('rejects a non-empty file without a GLB header', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ned2-glb-validation-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'LINK00.glb')
    await writeFile(path, Buffer.alloc(16, 0))

    await expect(validateNed2GlbFile(path, 'LINK00')).rejects.toThrow(
      /invalid GLB magic header/,
    )
  })
})
