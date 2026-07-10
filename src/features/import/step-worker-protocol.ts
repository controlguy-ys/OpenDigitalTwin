import type { OcctResult } from '../../lib/cad/occt-types'

export const STEP_IMPORT_OPTIONS = {
  linearUnit: 'meter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
} as const

export interface StepWorkerRequest {
  kind: 'import-step'
  bytes: Uint8Array
  options: typeof STEP_IMPORT_OPTIONS
}

export type StepWorkerResponse =
  | { kind: 'success'; result: OcctResult }
  | { kind: 'error'; message: string }
