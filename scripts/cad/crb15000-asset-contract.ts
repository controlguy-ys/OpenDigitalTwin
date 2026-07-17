export type Vector3Tuple = readonly [number, number, number]

export const CRB15000_ROBOT_MODEL_ID = 'CRB15000-12/1.27' as const

export const CRB15000_LINK_IDS = Object.freeze([
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const)

export type RobotLinkId = (typeof CRB15000_LINK_IDS)[number]

/** Source-CAD world origins used only by the deterministic GLB conversion pipeline. */
export const LINK_WORLD_ORIGINS = Object.freeze({
  LINK00: [0, 0, 0],
  LINK01: [0, 0, 0.338],
  LINK02: [0, 0, 0.338],
  LINK03: [0, 0, 1.045],
  LINK04: [0, 0, 1.155],
  LINK05: [0.534, 0, 1.155],
  LINK06: [0.635, 0, 1.235],
} as const satisfies Record<RobotLinkId, Vector3Tuple>)
