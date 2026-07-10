export type Vector3Tuple = readonly [number, number, number]

export interface RobotJointDefinition {
  id: 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
  parentLink: `LINK0${number}`
  childLink: `LINK0${number}`
  origin: Vector3Tuple
  axis: Vector3Tuple
  minDeg: number
  maxDeg: number
}

export const LINK_WORLD_ORIGINS = {
  LINK00: [0, 0, 0],
  LINK01: [0, 0, 0.338],
  LINK02: [0, 0, 0.338],
  LINK03: [0, 0, 1.045],
  LINK04: [0, 0, 1.155],
  LINK05: [0.534, 0, 1.155],
  LINK06: [0.635, 0, 1.235],
} as const satisfies Record<string, Vector3Tuple>

export type RobotLinkId = keyof typeof LINK_WORLD_ORIGINS

// Numeric kinematics are attributed to ROS-Industrial's
// abb_crb15000_support/urdf/crb15000_12_127_macro.xacro. Joint limits were
// cross-checked against ABB product specification 3HAC077390-001 Revision X.
export const CRB15000_DEFINITION = {
  id: 'CRB15000-12/1.27',
  baseLink: 'LINK00',
  joints: [
    {
      id: 'J1',
      parentLink: 'LINK00',
      childLink: 'LINK01',
      origin: [0, 0, 0.338],
      axis: [0, 0, 1],
      minDeg: -270,
      maxDeg: 270,
    },
    {
      id: 'J2',
      parentLink: 'LINK01',
      childLink: 'LINK02',
      origin: [0, 0, 0],
      axis: [0, 1, 0],
      minDeg: -180,
      maxDeg: 180,
    },
    {
      id: 'J3',
      parentLink: 'LINK02',
      childLink: 'LINK03',
      origin: [0, 0, 0.707],
      axis: [0, 1, 0],
      minDeg: -225,
      maxDeg: 85,
    },
    {
      id: 'J4',
      parentLink: 'LINK03',
      childLink: 'LINK04',
      origin: [0, 0, 0.11],
      axis: [1, 0, 0],
      minDeg: -180,
      maxDeg: 180,
    },
    {
      id: 'J5',
      parentLink: 'LINK04',
      childLink: 'LINK05',
      origin: [0.534, 0, 0],
      axis: [0, 1, 0],
      minDeg: -180,
      maxDeg: 180,
    },
    {
      id: 'J6',
      parentLink: 'LINK05',
      childLink: 'LINK06',
      origin: [0.101, 0, 0.08],
      axis: [1, 0, 0],
      minDeg: -270,
      maxDeg: 270,
    },
  ],
  toolRotationYRad: Math.PI / 2,
} as const satisfies {
  id: string
  baseLink: `LINK0${number}`
  joints: readonly RobotJointDefinition[]
  toolRotationYRad: number
}
