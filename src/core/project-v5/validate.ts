import { deepFreezeV5, clonePlainDataV5 } from './validation-support.js'
import {
  preflightWorkcellProjectShapeV5,
  validateWorkcellProjectShapeV5,
} from './validate-shape.js'
import { validateWorkcellProjectReferencesV5 } from './validate-references.js'
import type { WorkcellProjectV5 } from './types.js'

export function validateWorkcellProjectV5(value: unknown): WorkcellProjectV5 {
  preflightWorkcellProjectShapeV5(value)
  const clone = clonePlainDataV5(value)
  const project = validateWorkcellProjectShapeV5(clone)
  validateWorkcellProjectReferencesV5(project)
  return deepFreezeV5(project)
}
