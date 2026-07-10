import createOcct from 'occt-import-js'
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'
import type { OcctModule } from '../../lib/cad/occt-types'
import type {
  StepWorkerRequest,
  StepWorkerResponse,
} from './step-worker-protocol'

interface StepWorkerScope {
  onmessage: ((event: MessageEvent<StepWorkerRequest>) => void) | null
  postMessage(message: StepWorkerResponse): void
}

const workerScope = globalThis as unknown as StepWorkerScope
let occtPromise: Promise<OcctModule> | null = null

function getOcct(): Promise<OcctModule> {
  occtPromise ??= createOcct({
    locateFile: () => occtWasmUrl,
  })
  return occtPromise
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown STEP conversion error.'
}

workerScope.onmessage = async (event) => {
  const request = event.data
  if (request.kind !== 'import-step') {
    workerScope.postMessage({
      kind: 'error',
      message: 'Unsupported STEP worker request.',
    })
    return
  }

  try {
    const occt = await getOcct()
    const result = occt.ReadStepFile(request.bytes, request.options)
    if (result.success !== true) {
      workerScope.postMessage({
        kind: 'error',
        message: 'OCCT could not parse this STEP file.',
      })
      return
    }

    workerScope.postMessage({ kind: 'success', result })
  } catch (error) {
    workerScope.postMessage({ kind: 'error', message: errorMessage(error) })
  }
}
