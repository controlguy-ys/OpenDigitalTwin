import type { EquipmentOriginMode } from '../equipment/equipment'
import type { ObjectAssetRecordV2, ObjectInstanceRecordV1 } from './project'

export type DeepReadonly<T> = T extends ArrayBuffer
  ? ArrayBuffer
  : T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export const MAX_OBJECT_ASSETS = 256
export const MAX_STEP_OBJECT_ASSETS = 64
export const MAX_OBJECT_INSTANCES = 256
export const MAX_VISIBLE_RENDER_ITEMS = 1_024
export const MAX_VISIBLE_STATUS_OVERLAYS = 128

export type ObjectAssetGeometryV3 = DeepReadonly<Pick<
  ObjectAssetRecordV2,
  | 'id'
  | 'name'
  | 'colliderCenter'
  | 'collisionHalfExtents'
  | 'collisionBoxes'
  | 'statistics'
>>

export type StepObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'step'
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer
  readonly importScale: number
  readonly originMode: EquipmentOriginMode
}

export type BoxObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'box'
  readonly dimensionsM: readonly [number, number, number]
  readonly color: `#${string}`
}

export type CylinderObjectAssetRecordV3 = ObjectAssetGeometryV3 & {
  readonly sourceKind: 'cylinder'
  readonly radiusM: number
  readonly heightM: number
  readonly axis: 'z'
  readonly radialSegments: 32
  readonly color: `#${string}`
}

export type ObjectAssetRecordV3 =
  | StepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3

export type ObjectInstanceRecordV3 = Readonly<
  Omit<ObjectInstanceRecordV1, 'transform' | 'numericStatus' | 'visible'> & {
    readonly scale: readonly [number, number, number]
    readonly graspable: boolean
    readonly manualNumericStatus: number
  }
>
