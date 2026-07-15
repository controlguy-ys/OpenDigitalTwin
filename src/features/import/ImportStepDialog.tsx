import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type {
  EquipmentOriginMode,
  EquipmentSourceUnit,
} from '../../domain/equipment/equipment'
import type {
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
} from '../../domain/project/project'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_OBJECT_ASSET_BYTES,
  MAX_OBJECT_ASSET_TRIANGLES,
} from '../../domain/project/project'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { WORKBENCH_TOP_Z } from '../scene/workcell-constants'
import {
  detectStepUnit,
  postImportScaleForUnit,
  type DetectedStepUnit,
  type KnownStepUnit,
} from './detect-step-unit'
import {
  assertOcctGeometryBudget,
  createThreeGroupFromOcct,
  type ImportedThreeAsset,
} from './occt-to-three'
import type { SceneCommandService } from '../scene/scene-command-service'

export const MAX_STEP_FILE_BYTES = MAX_OBJECT_ASSET_BYTES

export interface ImportStepController {
  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult>
  cancel(): void
}

export interface ImportStepGeometryCache {
  set(id: string, asset: ImportedThreeAsset): void
}

export interface ImportStepDialogProps {
  open: boolean
  client: ImportStepController
  cache: ImportStepGeometryCache
  commands: Pick<SceneCommandService, 'importStepObject'>
  onSelect(id: string): void
  onClose(): void
  createId?: () => string
  createAssetId?: () => string
}

interface ImportDraft {
  bytes: ArrayBuffer
  sourceFileName: string
  detectedUnit: DetectedStepUnit
  selectedSourceUnit: KnownStepUnit | null
  result: OcctSuccessResult
  asset: ImportedThreeAsset | null
  name: string
  scale: number
  originMode: EquipmentOriginMode
  graspable: boolean
  collisionHalfExtents: [number, number, number]
  stackLight: boolean
}

type DialogStage = 'idle' | 'converting' | 'configure' | 'committing'

function defaultId(): string {
  return `imported-${crypto.randomUUID()}`
}

function defaultAssetId(): string {
  return `asset-${crypto.randomUUID()}`
}

function baseName(fileName: string): string {
  return fileName.replace(/\.(?:step|stp)$/i, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to convert this STEP file.'
}

function halfExtents(asset: ImportedThreeAsset): [number, number, number] {
  return [
    asset.bounds.size[0] / 2,
    asset.bounds.size[1] / 2,
    asset.bounds.size[2] / 2,
  ]
}

function postScale(
  detectedUnit: DetectedStepUnit,
  selectedSourceUnit: KnownStepUnit,
): number {
  return detectedUnit === 'unknown'
    ? postImportScaleForUnit(selectedSourceUnit)
    : 1
}

function dimensionsLabel(asset: ImportedThreeAsset, scale: number): string {
  return asset.bounds.size
    .map((dimension) => (dimension * scale).toFixed(3))
    .join(' × ')
    .concat(' m')
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function geometryStatistics(result: OcctSuccessResult) {
  const totals = assertOcctGeometryBudget(result.meshes, {
    maxVertices: Number.MAX_SAFE_INTEGER,
    maxTriangles: MAX_OBJECT_ASSET_TRIANGLES,
  })
  if (result.meshes.length > MAX_ASSET_MESHES) {
    throw new Error(`Object Assets support at most ${MAX_ASSET_MESHES} meshes.`)
  }
  const materialKeys = new Set<string>()
  for (const mesh of result.meshes) {
    materialKeys.add(JSON.stringify(mesh.color ?? [0.68, 0.72, 0.74]))
    for (const face of mesh.brep_faces) {
      if (face.color !== null) materialKeys.add(JSON.stringify(face.color))
    }
  }
  if (materialKeys.size > MAX_ASSET_MATERIALS) {
    throw new Error(`Object Assets support at most ${MAX_ASSET_MATERIALS} materials.`)
  }
  return {
    ...totals,
    meshes: result.meshes.length,
    materials: materialKeys.size,
  }
}

export function ImportStepDialog({
  open,
  client,
  cache,
  commands,
  onSelect,
  onClose,
  createId = defaultId,
  createAssetId = defaultAssetId,
}: ImportStepDialogProps) {
  const [stage, setStage] = useState<DialogStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const operationId = useRef(0)
  const ownedClientOperation = useRef<number | null>(null)
  const candidateAsset = useRef<ImportedThreeAsset | null>(null)

  const releaseCandidate = () => {
    candidateAsset.current?.dispose()
    candidateAsset.current = null
  }

  const cancelOwnedConversion = () => {
    if (ownedClientOperation.current === null) {
      return
    }
    ownedClientOperation.current = null
    client.cancel()
  }

  const reset = () => {
    operationId.current += 1
    cancelOwnedConversion()
    releaseCandidate()
    setDraft(null)
    setError(null)
    setStage('idle')
  }

  useEffect(() => {
    if (!open) {
      reset()
    }
  }, [open])

  useEffect(
    () => () => {
      operationId.current += 1
      cancelOwnedConversion()
      releaseCandidate()
    },
    [client],
  )

  if (!open) {
    return null
  }

  const replaceGeometry = (
    current: ImportDraft,
    selectedSourceUnit: KnownStepUnit,
    originMode: EquipmentOriginMode,
  ): ImportDraft => {
    const asset = createThreeGroupFromOcct(current.result, {
      postImportScale: postScale(current.detectedUnit, selectedSourceUnit),
      originMode,
    }, {
      maxVertices: Number.MAX_SAFE_INTEGER,
      maxTriangles: MAX_OBJECT_ASSET_TRIANGLES,
    })
    geometryStatistics(current.result)
    releaseCandidate()
    candidateAsset.current = asset
    return {
      ...current,
      selectedSourceUnit,
      originMode,
      asset,
      collisionHalfExtents: halfExtents(asset),
    }
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file === undefined) {
      return
    }

    cancelOwnedConversion()
    operationId.current += 1
    const currentOperation = operationId.current
    releaseCandidate()
    setDraft(null)
    setError(null)

    if (!/\.(?:step|stp)$/i.test(file.name)) {
      setStage('idle')
      setError('Choose a .step or .stp file.')
      return
    }
    if (file.size > MAX_STEP_FILE_BYTES) {
      setStage('idle')
      setError('Object STEP files must be 50 MiB or smaller.')
      return
    }

    try {
      const bytes = await file.arrayBuffer()
      if (operationId.current !== currentOperation) {
        return
      }
      const detectedUnit = detectStepUnit(bytes)
      setStage('converting')
      ownedClientOperation.current = currentOperation
      const result = await client.import(bytes)
      if (ownedClientOperation.current === currentOperation) {
        ownedClientOperation.current = null
      }
      if (operationId.current !== currentOperation) {
        return
      }

      const selectedSourceUnit: KnownStepUnit | null =
        detectedUnit === 'unknown' ? null : detectedUnit
      let nextDraft: ImportDraft = {
        bytes,
        sourceFileName: file.name,
        detectedUnit,
        selectedSourceUnit,
        result,
        asset: null,
        name: baseName(file.name),
        scale: 1,
        originMode: 'center',
        graspable: false,
        collisionHalfExtents: [0, 0, 0],
        stackLight: false,
      }
      if (selectedSourceUnit !== null) {
        nextDraft = replaceGeometry(nextDraft, selectedSourceUnit, 'center')
      }
      setDraft(nextDraft)
      setStage('configure')
    } catch (conversionError) {
      if (ownedClientOperation.current === currentOperation) {
        ownedClientOperation.current = null
      }
      if (operationId.current !== currentOperation) {
        return
      }
      setStage('idle')
      if (
        conversionError instanceof DOMException &&
        conversionError.name === 'AbortError'
      ) {
        return
      }
      setError(errorMessage(conversionError))
    }
  }

  const updateDraft = (update: Partial<ImportDraft>) => {
    setDraft((current) => (current === null ? current : { ...current, ...update }))
  }

  const handleSourceUnit = (event: ChangeEvent<HTMLSelectElement>) => {
    if (draft === null) {
      return
    }
    try {
      setError(null)
      setDraft(
        replaceGeometry(
          draft,
          event.target.value as KnownStepUnit,
          draft.originMode,
        ),
      )
    } catch (conversionError) {
      setError(errorMessage(conversionError))
    }
  }

  const handleOriginMode = (event: ChangeEvent<HTMLSelectElement>) => {
    if (draft?.selectedSourceUnit === null || draft === null) {
      return
    }
    try {
      setError(null)
      setDraft(
        replaceGeometry(
          draft,
          draft.selectedSourceUnit,
          event.target.value as EquipmentOriginMode,
        ),
      )
    } catch (conversionError) {
      setError(errorMessage(conversionError))
    }
  }

  const handleCancelConversion = () => {
    operationId.current += 1
    cancelOwnedConversion()
    releaseCandidate()
    setDraft(null)
    setError(null)
    setStage('idle')
  }

  const handleClose = () => {
    if (stage === 'committing') {
      return
    }
    reset()
    onClose()
  }

  const canCommit =
    draft !== null &&
    draft.asset !== null &&
    draft.selectedSourceUnit !== null &&
    draft.name.trim().length > 0 &&
    isPositiveFinite(draft.scale) &&
    draft.collisionHalfExtents.every(isPositiveFinite) &&
    stage === 'configure'

  const handleCommit = async () => {
    if (!canCommit || draft?.asset === null || draft === null) {
      return
    }

    setStage('committing')
    setError(null)
    operationId.current += 1
    const commitOperation = operationId.current
    const selectedSourceUnit = draft.selectedSourceUnit as EquipmentSourceUnit
    const asset = draft.asset
    const instanceId = createId()
    const assetId = createAssetId()
    const positionZ =
      WORKBENCH_TOP_Z - asset.bounds.min[2] * draft.scale
    const transform = {
      position: [0.65, 0.35, positionZ] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: [draft.scale, draft.scale, draft.scale] as [number, number, number],
    }

    const objectAsset: ObjectAssetRecordV2 = {
      id: assetId,
      name: draft.name.trim(),
      sourceFileName: draft.sourceFileName,
      sourceBytes: draft.bytes,
      importScale: postScale(draft.detectedUnit, selectedSourceUnit),
      originMode: draft.originMode,
      colliderCenter: [...asset.colliderCenter],
      collisionHalfExtents: [...draft.collisionHalfExtents],
      collisionBoxes: [{
        id: 'default',
        center: [...asset.colliderCenter],
        halfExtents: [...draft.collisionHalfExtents],
        quaternion: [0, 0, 0, 1],
      }],
      statistics: geometryStatistics(draft.result),
    }
    const objectInstance: ObjectInstanceRecordV1 = {
      id: instanceId,
      assetId,
      name: draft.name.trim(),
      transform,
      numericStatus: 0,
      statusSource: 'manual',
      statusOverlayVisible: true,
      visible: true,
    }

    try {
      await commands.importStepObject({
        asset: objectAsset,
        instance: objectInstance,
        graspable: draft.graspable,
      })
      if (operationId.current !== commitOperation) {
        return
      }
      candidateAsset.current = null
      cache.set(assetId, asset)
      onSelect(instanceId)
      setDraft(null)
      setStage('idle')
      onClose()
    } catch (commitError) {
      if (operationId.current !== commitOperation) {
        return
      }
      setStage('configure')
      setError(errorMessage(commitError))
    }
  }

  const setCollisionExtent = (axis: 0 | 1 | 2, value: number) => {
    if (draft === null) {
      return
    }
    const collisionHalfExtents: [number, number, number] = [
      ...draft.collisionHalfExtents,
    ]
    collisionHalfExtents[axis] = value
    updateDraft({ collisionHalfExtents })
  }

  return (
    <div
      aria-labelledby="import-step-title"
      aria-modal="true"
      className="import-step-backdrop"
      role="dialog"
    >
      <section className="import-step-dialog">
        <header>
          <div>
            <p>Equipment asset</p>
            <h2 id="import-step-title">Import STEP</h2>
          </div>
          <button
            aria-label="Close import dialog"
            disabled={stage === 'committing'}
            onClick={handleClose}
            type="button"
          >
            Close
          </button>
        </header>

        <label className="import-file-field">
          <span>STEP file</span>
          <input
            accept=".step,.stp"
            disabled={stage === 'committing'}
            onChange={handleFile}
            type="file"
          />
        </label>

        {stage === 'converting' ? (
          <div aria-live="polite" className="import-converting">
            <span>Converting STEP…</span>
            <progress aria-label="STEP conversion progress" />
            <button onClick={handleCancelConversion} type="button">
              Cancel conversion
            </button>
          </div>
        ) : null}

        {error === null ? null : <p role="alert">{error}</p>}

        {draft === null ? null : (
          <form
            className="import-config"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCommit()
            }}
          >
            <div className="import-result-summary">
              <span aria-label="Detected unit">{draft.detectedUnit}</span>
              {draft.asset === null ? (
                <span>Select the source unit to calculate metre dimensions.</span>
              ) : (
                <strong>{dimensionsLabel(draft.asset, draft.scale)}</strong>
              )}
            </div>

            {draft.detectedUnit === 'unknown' ? (
              <label>
                <span>Source unit</span>
                <select
                  aria-label="Source unit"
                  onChange={handleSourceUnit}
                  value={draft.selectedSourceUnit ?? ''}
                >
                  <option disabled value="">
                    Select unit
                  </option>
                  <option value="millimeter">Millimetre</option>
                  <option value="meter">Metre</option>
                  <option value="inch">Inch</option>
                </select>
              </label>
            ) : (
              <output aria-label="Source unit">{draft.selectedSourceUnit}</output>
            )}

            <label>
              <span>Name</span>
              <input
                aria-label="Name"
                onChange={(event) => updateDraft({ name: event.target.value })}
                type="text"
                value={draft.name}
              />
            </label>
            <label>
              <span>Scale</span>
              <input
                aria-label="Scale"
                min="0.000001"
                onChange={(event) => updateDraft({ scale: event.target.valueAsNumber })}
                step="any"
                type="number"
                value={draft.scale}
              />
            </label>
            <label>
              <span>Origin mode</span>
              <select
                aria-label="Origin mode"
                onChange={handleOriginMode}
                value={draft.originMode}
              >
                <option value="center">Center</option>
                <option value="source">Source origin</option>
              </select>
            </label>
            <label className="import-toggle">
              <input
                aria-label="Graspable"
                checked={draft.graspable}
                onChange={(event) => updateDraft({ graspable: event.target.checked })}
                type="checkbox"
              />
              <span>Graspable</span>
            </label>

            <fieldset>
              <legend>Collision half extents (m)</legend>
              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
                <label key={axis}>
                  <span>{axis}</span>
                  <input
                    aria-label={`Collision ${axis}`}
                    min="0.000001"
                    onChange={(event) =>
                      setCollisionExtent(
                        index as 0 | 1 | 2,
                        event.target.valueAsNumber,
                      )
                    }
                    step="any"
                    type="number"
                    value={draft.collisionHalfExtents[index]}
                  />
                </label>
              ))}
            </fieldset>

            <label className="import-toggle">
              <input
                aria-label="Stack light"
                checked={draft.stackLight}
                onChange={(event) => updateDraft({ stackLight: event.target.checked })}
                type="checkbox"
              />
              <span>Attach stack light</span>
            </label>

            <footer>
              <button
                disabled={stage === 'committing'}
                onClick={handleClose}
                type="button"
              >
                Cancel
              </button>
              <button disabled={!canCommit} type="submit">
                {stage === 'committing' ? 'Adding…' : 'Add to scene'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
