export type KnownStepUnit = 'millimeter' | 'meter' | 'inch'
export type DetectedStepUnit = KnownStepUnit | 'unknown'

const UNKNOWN_UNIT_POST_SCALES: Record<KnownStepUnit, number> = {
  millimeter: 0.001,
  meter: 1,
  inch: 0.0254,
}

const SCAN_CHUNK_BYTES = 64 * 1024
const SCAN_OVERLAP_BYTES = 512
const ASCII_DECODER = new TextDecoder('ascii')

const UNIT_PATTERNS: readonly [KnownStepUnit, RegExp][] = [
  ['millimeter', /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i],
  ['meter', /SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)/i],
  [
    'inch',
    /CONVERSION_BASED_UNIT\s*\(\s*['"]\s*INCH(?:ES)?\s*['"]/i,
  ],
]

function asBytes(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source)
}

export function detectStepUnit(
  source: ArrayBuffer | Uint8Array,
): DetectedStepUnit {
  const bytes = asBytes(source)

  for (let offset = 0; offset < bytes.byteLength; offset += SCAN_CHUNK_BYTES) {
    const start = Math.max(0, offset - SCAN_OVERLAP_BYTES)
    const end = Math.min(bytes.byteLength, offset + SCAN_CHUNK_BYTES)
    const chunk = ASCII_DECODER.decode(bytes.subarray(start, end))

    for (const [unit, pattern] of UNIT_PATTERNS) {
      if (pattern.test(chunk)) {
        return unit
      }
    }
  }

  return 'unknown'
}

export function postImportScaleForUnit(unit: KnownStepUnit): number {
  return UNKNOWN_UNIT_POST_SCALES[unit]
}
