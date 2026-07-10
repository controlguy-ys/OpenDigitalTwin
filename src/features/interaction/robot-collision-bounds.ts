import type { RobotLinkId } from '../../domain/robot/crb15000'

export interface LocalCollisionBounds {
  center: [number, number, number]
  halfExtents: [number, number, number]
}

// Derived from public/models/robot/asset-report.json generated.localBounds.
const LOCAL_BOUNDS = {
  LINK00: { min: [-0.14180000126361847, -0.10000000149011612, -2.7755575615628914e-16], max: [0.10000000149011612, 0.10000000149011612, 0.21400000154972076] },
  LINK01: { min: [-0.0800001472234726, -0.09515000134706497, -0.12309999763965607], max: [0.0800001472234726, 0.11159999668598175, 0.08010978996753693] },
  LINK02: { min: [-0.08076024800539017, -0.2036534696817398, -0.0807277262210846], max: [0.08076024800539017, -0.08630000054836273, 0.775532603263855] },
  LINK03: { min: [-0.06499999761581421, -0.08500000089406967, -0.06497151404619217], max: [0.09600000083446503, 0.10999999940395355, 0.16257204115390778] },
  LINK04: { min: [0.09700000286102295, -0.052799999713897705, -0.052819326519966125], max: [0.5847763419151306, 0.13300000131130219, 0.052819326519966125] },
  LINK05: { min: [-0.1274278312921524, -0.09350000321865082, -0.05400000140070915], max: [0.06800000369548798, 0.07450000196695328, 0.132750004529953] },
  LINK06: { min: [-0.032600000500679016, -0.052497901022434235, -0.05254051089286804], max: [-2.220446049250313e-16, 0.05252917855978012, 0.05254051089286804] },
} as const satisfies Record<RobotLinkId, {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}>

export const ROBOT_LINK_COLLISION_BOUNDS = Object.fromEntries(
  Object.entries(LOCAL_BOUNDS).map(([id, bounds]) => [
    id,
    {
      center: bounds.min.map(
        (minimum, index) => (minimum + bounds.max[index]!) / 2,
      ),
      halfExtents: bounds.min.map(
        (minimum, index) => (bounds.max[index]! - minimum) / 2,
      ),
    },
  ]),
) as Record<RobotLinkId, LocalCollisionBounds>
