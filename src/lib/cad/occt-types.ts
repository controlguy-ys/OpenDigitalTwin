export type OcctColor = readonly [number, number, number]

export interface OcctAttribute {
  array: number[]
}

export interface OcctBrepFace {
  first: number
  last: number
  color: OcctColor | null
}

export interface OcctMesh {
  name: string
  color?: OcctColor
  brep_faces: OcctBrepFace[]
  attributes: {
    position: OcctAttribute
    normal?: OcctAttribute
  }
  index: OcctAttribute
}

export interface OcctNode {
  name: string
  meshes: number[]
  children: OcctNode[]
}

export interface OcctSuccessResult {
  success: true
  root: OcctNode
  meshes: OcctMesh[]
}

export interface OcctFailureResult {
  success: false
}

export type OcctResult = OcctSuccessResult | OcctFailureResult

export interface OcctReadParameters {
  linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
  linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
  linearDeflection?: number
  angularDeflection?: number
}

export interface OcctModule {
  ReadStepFile(
    content: Uint8Array,
    parameters?: OcctReadParameters | null,
  ): OcctResult
}
