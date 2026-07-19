import { failProjectV5 } from './errors.js'
import { utf8Length as utf8LengthFromSupport } from './validation-support.js'
import type { LogicalSignalDataTypeV1, LogicalSignalValueV1 } from './types.js'

export const utf8Length = utf8LengthFromSupport

export function validateLogicalSignalValueV1(
  dataType: LogicalSignalDataTypeV1,
  value: unknown,
  path: string,
): LogicalSignalValueV1 {
  if (dataType === 'Boolean' && typeof value === 'boolean') return value
  if (dataType === 'String' && typeof value === 'string' && utf8Length(value) <= 4_096) return value
  if (
    dataType === 'Int32'
    && Number.isInteger(value)
    && Number(value) >= -2_147_483_648
    && Number(value) <= 2_147_483_647
  ) {
    return Number(value)
  }
  if (
    dataType === 'UInt32'
    && Number.isInteger(value)
    && Number(value) >= 0
    && Number(value) <= 4_294_967_295
  ) {
    return Number(value)
  }
  if (dataType === 'Double' && typeof value === 'number' && Number.isFinite(value)) return value
  return failProjectV5('LOGICAL_SIGNAL_VALUE_TYPE_MISMATCH', path, `${dataType} initial value is invalid.`)
}
