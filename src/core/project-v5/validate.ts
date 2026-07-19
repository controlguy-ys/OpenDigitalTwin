import { deepFreezeV5, clonePlainDataV5 } from './validation-support.js'
import {
  preflightWorkcellProjectShapeV5,
  validateWorkcellProjectShapeV5,
} from './validate-shape.js'
import type { WorkcellProjectV5 } from './types.js'

export function validateWorkcellProjectV5(value: unknown): WorkcellProjectV5 {
  preflightWorkcellProjectShapeV5(value)
  const clone = clonePlainDataV5(value)
  return deepFreezeV5(validateWorkcellProjectShapeV5(clone))
}
