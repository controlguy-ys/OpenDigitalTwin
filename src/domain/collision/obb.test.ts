import { describe, expect, it } from 'vitest'
import {
  pairKey,
  validateCollisionBox,
  validateCollisionDiagnostic,
  validateCollisionFinding,
  validateGeometryCollisionEntity,
  type WorldObb,
} from './collision'
import { queryObbPair, worldObbFromBox } from './obb'

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const

function obb(
  entityId: string,
  center: readonly [number, number, number],
  axes: WorldObb['axes'] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  halfExtents: readonly [number, number, number] = [0.5, 0.5, 0.5],
): WorldObb {
  return {
    entityId,
    boxId: 'proxy',
    center,
    axes,
    halfExtents,
  }
}

interface CrossAxisFixture {
  readonly label: string
  readonly axes: WorldObb['axes']
  readonly firstHalfExtents: readonly [number, number, number]
  readonly secondHalfExtents: readonly [number, number, number]
  readonly secondCenter: readonly [number, number, number]
}

// In each fixture all six face-axis projections overlap and exactly the named
// edge cross-product axis separates the boxes.
const CROSS_AXIS_FIXTURES: readonly CrossAxisFixture[] = [
  {
    label: 'A0 x B0',
    axes: [
      [-0.39948761098781593, -0.6122472060804255, -0.6823217769600793],
      [0.911527394240431, -0.3445303463467739, -0.22453652263144586],
      [-0.09760869949188533, -0.7116545503914697, 0.695715705364352],
    ],
    firstHalfExtents: [1.413841789565049, 0.6371021781116724, 0.9863028989173472],
    secondHalfExtents: [0.8576274559367448, 0.9061560555361211, 0.6916228294372558],
    secondCenter: [0.06839762919116765, -1.1100326667074114, 1.7016867509810254],
  },
  {
    label: 'A0 x B1',
    axes: [
      [-0.5806596829011339, 0.7329845587953941, -0.35435571001562266],
      [-0.3048894846727571, 0.2078020823691804, 0.9294410668240418],
      [0.7549018047329965, 0.6477282849548518, 0.1028169931495323],
    ],
    firstHalfExtents: [1.6016502938931807, 0.5976356048136949, 0.688384083006531],
    secondHalfExtents: [0.21131001678295433, 1.2778300850652158, 0.20562474578619003],
    secondCenter: [0.1845121990190819, 0.9943101422395557, -0.5842507985653356],
  },
  {
    label: 'A0 x B2',
    axes: [
      [-0.3848469354367469, 0.598538134113237, -0.7025987035977146],
      [-0.9064062933266991, -0.38869747136030997, 0.1653538846711954],
      [-0.17412773386999097, 0.7004758224024195, 0.6921077622212858],
    ],
    firstHalfExtents: [1.3910865541314705, 0.5104941163212061, 0.3022511229850352],
    secondHalfExtents: [0.7547102913726121, 0.3514791651628911, 1.140674328804016],
    secondCenter: [0.7887660443084314, 1.6261403968092054, -0.8297632524045184],
  },
  {
    label: 'A1 x B0',
    axes: [
      [0.12644349699779536, -0.23408495756354247, -0.9639586478212865],
      [0.6672194292327289, 0.7391607983193857, -0.09197579835043464],
      [0.7340505945241922, -0.6315421972206788, 0.24964810796069964],
    ],
    firstHalfExtents: [0.27907257943879815, 1.2615138597786426, 1.0407296125777066],
    secondHalfExtents: [1.6395718430634587, 0.4909417304210365, 1.2671106431633232],
    secondCenter: [-1.5266037549590692, 0.7110146603081375, -1.4963126924121752],
  },
  {
    label: 'A1 x B1',
    axes: [
      [0.4807933785781901, 0.24846769599720717, -0.8408932935641766],
      [0.2754400690504143, 0.8676679288470004, 0.4138660817364231],
      [0.8324484941886028, -0.43059977856031945, 0.34873103565202185],
    ],
    firstHalfExtents: [0.6678326092427597, 0.6924014110118151, 0.7419460088945925],
    secondHalfExtents: [0.16717104879207909, 0.9452740757726132, 0.41425697654485705],
    secondCenter: [-1.0874357213033363, 0.38223546906374395, 0.8203812333522364],
  },
  {
    label: 'A1 x B2',
    axes: [
      [-0.8135168981711275, 0.2694774515955589, -0.5153369378101966],
      [-0.49388934620327374, -0.7879981422717208, 0.36760337523371517],
      [-0.30702372888252466, 0.5535709808668442, 0.7741418468505561],
    ],
    firstHalfExtents: [0.3247438571183011, 0.8482974395155907, 0.7787912559695542],
    secondHalfExtents: [0.46078036199323835, 0.17891900343820452, 1.2374795448035],
    secondCenter: [0.5034038728335872, 1.1576662317384034, 1.710622270940803],
  },
  {
    label: 'A2 x B0',
    axes: [
      [-0.3866359466901919, -0.8321766225879862, -0.3974854884710024],
      [0.7076699375648956, 0.008662720730688356, -0.7064900683919335],
      [0.5913678247874802, -0.55444298722916, 0.5855570593191833],
    ],
    firstHalfExtents: [0.503763205348514, 0.5927877556532621, 1.3222603135742246],
    secondHalfExtents: [0.7521671297494322, 0.2265985063277185, 0.5620267130434513],
    secondCenter: [-1.027220196905546, 1.1279837011825293, 0.39644875458907336],
  },
  {
    label: 'A2 x B1',
    axes: [
      [-0.07001965796892033, -0.19577614028386303, -0.9781456693118201],
      [0.5898332711224041, 0.7826538267179308, -0.19887106325663245],
      [0.8044836603529992, -0.5908677435935492, 0.06067412797649346],
    ],
    firstHalfExtents: [0.43879332204815, 0.5967873249202966, 1.1052945242263377],
    secondHalfExtents: [0.5265242651570589, 1.2752500100992619, 0.4063420414924621],
    secondCenter: [-0.5253009767038748, 1.2179898878093809, 0.444243814679794],
  },
  {
    label: 'A2 x B2',
    axes: [
      [0.7794175605628425, -0.33945794808594, -0.52657057244737],
      [-0.6245124844450873, -0.4879433348774136, -0.6098323201675462],
      [-0.04992417308771524, 0.8041639157721461, -0.5923073302868338],
    ],
    firstHalfExtents: [0.7621531612006948, 0.625799636542797, 1.2232979667373],
    secondHalfExtents: [0.626706214947626, 0.36323012514039876, 0.9073308896273374],
    secondCenter: [-1.5098460087319836, -0.6014467000495642, 0.25783790403511375],
  },
]

describe('collision domain validation', () => {
  it('owns finite Box tuples and rejects non-positive extents', () => {
    const center: [number, number, number] = [0.1, 0.2, 0.3]
    const validated = validateCollisionBox({
      id: 'main',
      center,
      halfExtents: [0.4, 0.5, 0.6],
      quaternion: [0, 0, 0, 1],
    })

    center[0] = 99
    expect(validated.center).toEqual([0.1, 0.2, 0.3])
    expect(() =>
      validateCollisionBox({ ...validated, center: [0, Number.NaN, 0] }),
    ).toThrow(/finite/i)
    expect(() =>
      validateCollisionBox({ ...validated, halfExtents: [0.4, 0, 0.6] }),
    ).toThrow(/positive/i)
  })

  it('normalizes an owned Box quaternion for persistence-safe rotation data', () => {
    const quaternion: [number, number, number, number] = [0, 0, 0, 2]
    const validated = validateCollisionBox({
      id: 'main',
      center: [0, 0, 0],
      halfExtents: [0.4, 0.5, 0.6],
      quaternion,
    })

    quaternion[3] = 99
    expect(validated.quaternion).toEqual([0, 0, 0, 1])
    expect(Math.hypot(...validated.quaternion)).toBeCloseTo(1)
  })

  it('requires category-specific namespaces including workcell:workbench', () => {
    expect(
      validateGeometryCollisionEntity({
        id: 'workcell:workbench',
        name: 'Workbench',
        category: 'environment',
        worldMatrix: IDENTITY_MATRIX,
        boxes: [
          {
            id: 'top',
            center: [0, 0, 0],
            halfExtents: [1, 1, 0.1],
            quaternion: [0, 0, 0, 1],
          },
        ],
      }).id,
    ).toBe('workcell:workbench')

    expect(() =>
      validateGeometryCollisionEntity({
        id: 'environment:workbench',
        name: 'Workbench',
        category: 'environment',
        worldMatrix: IDENTITY_MATRIX,
        boxes: [],
      }),
    ).toThrow(/namespace/i)

    expect(
      validateGeometryCollisionEntity({
        id: 'object:cup-01',
        name: 'Held cup',
        category: 'held-object',
        worldMatrix: IDENTITY_MATRIX,
        boxes: [],
      }).id,
    ).toBe('object:cup-01')
  })

  it('canonicalizes pair identity independent of argument order', () => {
    expect(pairKey('robot-link:LINK03', 'object:cup-01')).toBe(
      'object:cup-01|robot-link:LINK03',
    )
    expect(pairKey('object:cup-01', 'robot-link:LINK03')).toBe(
      'object:cup-01|robot-link:LINK03',
    )
    expect(() => pairKey('object:cup|01', 'robot-link:LINK03')).toThrow(
      /separator/i,
    )
  })

  it('allows human-readable names and diagnostics to contain a pipe', () => {
    const entity = validateGeometryCollisionEntity({
      id: 'object:fixture',
      name: 'Fixture | Press',
      category: 'object',
      worldMatrix: IDENTITY_MATRIX,
      boxes: [],
    })
    const diagnostic = validateCollisionDiagnostic({
      entityId: entity.id,
      message: 'Object missing | inactive collision proxy',
    })

    expect(entity.name).toBe('Fixture | Press')
    expect(diagnostic.message).toBe('Object missing | inactive collision proxy')
  })

  it('rejects a runtime Collision Finding kind outside the domain union', () => {
    expect(() =>
      validateCollisionFinding({
        pairKey: 'object:cup-01|robot-link:LINK03',
        firstEntityId: 'object:cup-01',
        secondEntityId: 'robot-link:LINK03',
        firstBoxId: 'main',
        secondBoxId: 'main',
        kind: 'warning' as 'collision',
        separationM: -0.05,
        sampleIndex: null,
        timeMs: null,
      }),
    ).toThrow(/kind/i)
  })
})

describe('World OBB transforms', () => {
  it('composes translation, rotation, non-uniform scale, and local center', () => {
    const entity = validateGeometryCollisionEntity({
      id: 'object:fixture',
      name: 'Fixture',
      category: 'object',
      worldMatrix: [
        0, 2, 0, 0,
        -3, 0, 0, 0,
        0, 0, 4, 0,
        10, 20, 30, 1,
      ],
      boxes: [],
    })
    const world = worldObbFromBox(entity, {
      id: 'main',
      center: [1, 2, 3],
      halfExtents: [0.5, 1, 1.5],
      quaternion: [0, 0, 0, 1],
    })

    expect(world.center).toEqual([4, 22, 42])
    expect(world.axes[0]).toEqual([0, 1, 0])
    expect(world.axes[1]).toEqual([-1, 0, 0])
    expect(world.axes[2]).toEqual([0, 0, 1])
    expect(world.halfExtents).toEqual([1, 3, 6])
  })

  it('composes Box quaternion before parent non-uniform scale', () => {
    const halfSqrt = Math.SQRT1_2
    const entity = validateGeometryCollisionEntity({
      id: 'object:fixture',
      name: 'Fixture',
      category: 'object',
      worldMatrix: [
        2, 0, 0, 0,
        0, 3, 0, 0,
        0, 0, 4, 0,
        0, 0, 0, 1,
      ],
      boxes: [],
    })
    const world = worldObbFromBox(entity, {
      id: 'rotated',
      center: [0, 0, 0],
      halfExtents: [0.5, 1, 1.5],
      quaternion: [0, 0, halfSqrt, halfSqrt],
    })

    expect(world.axes[0][0]).toBeCloseTo(0)
    expect(world.axes[0][1]).toBeCloseTo(1)
    expect(world.axes[1][0]).toBeCloseTo(-1)
    expect(world.axes[1][1]).toBeCloseTo(0)
    expect(world.halfExtents[0]).toBeCloseTo(1.5)
    expect(world.halfExtents[1]).toBeCloseTo(2)
    expect(world.halfExtents[2]).toBeCloseTo(6)
  })
})

describe('OBB SAT query', () => {
  it('classifies overlapping proxy boxes as collision', () => {
    expect(queryObbPair(obb('object:a', [0, 0, 0]), obb('object:b', [0.9, 0, 0]), 0.1))
      .toMatchObject({ kind: 'collision', separationM: -0.1 })
  })

  it('classifies separated proxy boxes inside warning distance as near miss', () => {
    const finding = queryObbPair(
      obb('object:a', [0, 0, 0]),
      obb('object:b', [1.05, 0, 0]),
      0.1,
    )
    expect(finding).toMatchObject({ kind: 'near-miss' })
    expect(finding?.separationM).toBeCloseTo(0.05)
  })

  it('returns clear beyond the warning distance', () => {
    expect(
      queryObbPair(
        obb('object:a', [0, 0, 0]),
        obb('object:b', [1.11, 0, 0]),
        0.1,
      ),
    ).toBeNull()
  })

  it.each([
    ['X', [1.1, 0, 0]],
    ['Y', [0, 1.1, 0]],
    ['Z', [0, 0, 1.1]],
  ] as const)('tests both OBB face axes along %s', (_label, center) => {
    expect(queryObbPair(obb('object:a', [0, 0, 0]), obb('object:b', center), 0))
      .toBeNull()
  })

  it.each(CROSS_AXIS_FIXTURES)(
    'uses edge cross-product SAT axis $label',
    ({ axes, firstHalfExtents, secondHalfExtents, secondCenter }) => {
      const first = obb(
        'object:a',
        [0, 0, 0],
        undefined,
        firstHalfExtents,
      )
      const second = obb(
        'object:b',
        secondCenter,
        axes,
        secondHalfExtents,
      )

      expect(queryObbPair(first, second, 0)).toBeNull()
    },
  )
})
