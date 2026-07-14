import {
  createProjectHashService,
  type ProjectHashWorker,
  type Sha256WorkerRequest,
} from '../src/lib/hash/sha256'

const MIB = 1024 * 1024
const SOURCE_BYTES = 64 * MIB

export interface ProjectHashBrowserEvidence {
  readonly projectByteLength: number
  readonly sourceOwnerKeys: readonly string[]
  readonly sourceByteLengths: readonly number[]
  readonly digests: readonly string[]
  readonly perSourceElapsedMs: readonly number[]
  readonly totalElapsedMs: number
  readonly rafFrames: number
  readonly workersConstructed: number
  readonly workersTerminated: number
  readonly maxActiveWorkers: number
  readonly workerUrls: readonly string[]
  readonly callerBoundaryBytes: readonly number[]
}

declare global {
  interface Window {
    __projectHashWorkerEvidence?: Promise<ProjectHashBrowserEvidence>
  }
}

class EvidenceHashWorker implements ProjectHashWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null

  readonly #worker: Worker
  readonly #onTerminate: () => void
  #terminated = false

  constructor(worker: Worker, onTerminate: () => void) {
    this.#worker = worker
    this.#onTerminate = onTerminate
    worker.addEventListener('message', (event) => this.onmessage?.(event))
    worker.addEventListener('error', (event) => this.onerror?.(event))
    worker.addEventListener('messageerror', (event) => this.onmessageerror?.(event))
  }

  postMessage(message: Sha256WorkerRequest, transfer?: Transferable[]): void {
    this.#worker.postMessage(message, transfer ?? [])
  }

  terminate(): void {
    if (this.#terminated) return
    this.#terminated = true
    this.#worker.terminate()
    this.#onTerminate()
  }
}

async function runProjectHashWorkerEvidence(): Promise<ProjectHashBrowserEvidence> {
  const createSource = (ownerKey: string, fillByte: number) => {
    const sourceBytes = new Uint8Array(SOURCE_BYTES)
    if (fillByte !== 0) sourceBytes.fill(fillByte)
    return { ownerKey, sourceBytes }
  }
  const projectInput = {
    robotSources: [
      createSource('robot-source:robot-0', 0),
      createSource('robot-source:robot-1', 1),
    ],
    objectAssets: [
      createSource('object-asset:object-0', 2),
      createSource('object-asset:object-1', 3),
    ],
  }
  const sources = [
    ...projectInput.robotSources,
    ...projectInput.objectAssets,
  ]
  let workersConstructed = 0
  let workersTerminated = 0
  let activeWorkers = 0
  let maxActiveWorkers = 0
  const workerUrls: string[] = []
  const hashService = createProjectHashService({
    subtle: undefined,
    workerFactory: () => {
      const workerUrl = new URL('../src/lib/hash/sha256-worker.ts', import.meta.url)
      const worker = new Worker(
        new URL('../src/lib/hash/sha256-worker.ts', import.meta.url),
        { name: 'project-sha256-fallback', type: 'module' },
      )
      workerUrls.push(workerUrl.href)
      workersConstructed += 1
      activeWorkers += 1
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers)
      return new EvidenceHashWorker(worker, () => {
        workersTerminated += 1
        activeWorkers -= 1
      })
    },
  })

  let rafFrames = 0
  let countFrames = true
  const countFrame = (): void => {
    if (!countFrames) return
    rafFrames += 1
    requestAnimationFrame(countFrame)
  }
  requestAnimationFrame(countFrame)

  const digests: string[] = []
  const perSourceElapsedMs: number[] = []
  const totalStartedAt = performance.now()
  try {
    for (const { sourceBytes } of sources) {
      const sourceStartedAt = performance.now()
      digests.push(await hashService.sha256(sourceBytes))
      perSourceElapsedMs.push(performance.now() - sourceStartedAt)
    }
  } finally {
    countFrames = false
  }

  return {
    projectByteLength: sources.reduce(
      (totalBytes, sourceRecord) => totalBytes + sourceRecord.sourceBytes.byteLength,
      0,
    ),
    sourceOwnerKeys: sources.map(({ ownerKey }) => ownerKey),
    sourceByteLengths: sources.map(({ sourceBytes }) => sourceBytes.byteLength),
    digests,
    perSourceElapsedMs,
    totalElapsedMs: performance.now() - totalStartedAt,
    rafFrames,
    workersConstructed,
    workersTerminated,
    maxActiveWorkers,
    workerUrls,
    callerBoundaryBytes: sources.map(({ sourceBytes }) => sourceBytes.at(-1) ?? -1),
  }
}

const runButton = document.querySelector<HTMLButtonElement>('#run-evidence')
const status = document.querySelector<HTMLOutputElement>('#evidence-status')
if (runButton === null || status === null) {
  throw new Error('Project hash evidence controls are missing.')
}
runButton.addEventListener('click', () => {
  runButton.disabled = true
  status.value = 'Hashing'
  const pending = runProjectHashWorkerEvidence()
  window.__projectHashWorkerEvidence = pending
  void pending.then(
    (evidence) => {
      status.value = `Complete: ${evidence.rafFrames} animation frames`
    },
    (error: unknown) => {
      status.value = `Failed: ${error instanceof Error ? error.message : String(error)}`
    },
  )
})
