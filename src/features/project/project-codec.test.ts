import { strToU8, zipSync } from 'fflate'
import { expect, it, vi } from 'vitest'
import { createProjectSourceStagingService } from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
} from '../../lib/hash/sha256'
import {
  createProjectArchiveWorkerSession,
  type ProjectArchiveWorkerLike,
  type ProjectArchiveWorkerRequest,
  type ProjectArchiveWorkerResponse,
} from './project-archive-worker'
import { decodeWorkcellProject } from './project-codec'

class SessionWorker implements ProjectArchiveWorkerLike {
  onmessage: ((event: MessageEvent<ProjectArchiveWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  private readonly session = createProjectArchiveWorkerSession((response, transfer = []) => {
    const owned = structuredClone(response, { transfer })
    queueMicrotask(() => this.onmessage?.({ data: owned } as MessageEvent<ProjectArchiveWorkerResponse>))
  })

  postMessage(message: ProjectArchiveWorkerRequest, transfer: Transferable[] = []): void {
    const owned = structuredClone(message, { transfer })
    queueMicrotask(() => this.session.handle(owned))
  }

  terminate(): void {}
}

const workerFactory = (): ProjectArchiveWorkerLike => new SessionWorker()

function supersededArchive(schemaVersion: 1 | 2): Uint8Array {
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({
      format: 'WebDigitalTwinProject',
      schemaVersion,
      projectId: 'superseded',
      name: 'Superseded',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    })),
  })
}

it.each([1, 2] as const)(
  'rejects superseded schema V%s before source staging',
  async (schemaVersion) => {
    const digestSource = vi.fn(async () => '0'.repeat(64))
    const sourceStaging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
    })
    const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })

    await expect(decodeWorkcellProject(supersededArchive(schemaVersion), {
      workerFactory,
      sourceStaging,
      projectRevisionIdentityHasher: createProjectRevisionIdentityHasher(hashService),
    })).rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED' })

    expect(digestSource).not.toHaveBeenCalled()
  },
)
