import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SceneCommandService } from '../scene/scene-command-service'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import type { ImportedThreeAsset } from './occt-to-three'
import {
  ImportStepDialog,
  MAX_STEP_FILE_BYTES,
  type ImportStepController,
  type ImportStepGeometryCache,
} from './ImportStepDialog'

const encoder = new TextEncoder()
const LINK00_RESULT: OcctSuccessResult = {
  success: true,
  root: { name: 'root', meshes: [0], children: [] },
  meshes: [
    {
      name: 'LINK00',
      brep_faces: [],
      attributes: {
        position: {
          array: [
            -0.142, -0.1, 0,
            0.1, 0.1, 0.214,
            0.1, -0.1, 0,
          ],
        },
      },
      index: { array: [0, 1, 2] },
    },
  ],
}

function stepFile(
  contents: string,
  name = 'LINK00_CAD.step',
  declaredSize?: number,
): File {
  const bytes = Uint8Array.from(encoder.encode(contents))
  const file = new File([bytes], name, { type: 'model/step' })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.buffer.slice(0),
  })
  if (declaredSize !== undefined) {
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: declaredSize,
    })
  }
  return file
}

function renderDialog(
  clientOverrides: Partial<ImportStepController> = {},
) {
  const client: ImportStepController = {
    import: vi.fn(async () => LINK00_RESULT),
    cancel: vi.fn(),
    ...clientOverrides,
  }
  const cache: ImportStepGeometryCache = {
    set: vi.fn<(id: string, asset: ImportedThreeAsset) => void>(),
  }
  const onCommit = vi.fn<SceneCommandService['importStepObject']>(
    async (input) => `object:${input.instance.id}`,
  )
  const onSelect = vi.fn<(id: string) => void>()
  const onClose = vi.fn()
  render(
    <ImportStepDialog
      cache={cache}
      client={client}
      createId={() => 'imported-link00'}
      onClose={onClose}
      commands={{ importStepObject: onCommit }}
      onSelect={onSelect}
      open
    />,
  )
  return { cache, client, onClose, onCommit, onSelect }
}

describe('ImportStepDialog', () => {
  it('routes the confirmed import through the Project V3 scene command once', async () => {
    const user = userEvent.setup()
    const commands = {
      importStepObject: vi.fn(async () => 'object:instance-link00' as const),
    } as Pick<SceneCommandService, 'importStepObject'>
    const cache: ImportStepGeometryCache = { set: vi.fn() }
    render(
      <ImportStepDialog
        cache={cache}
        client={{ import: vi.fn(async () => LINK00_RESULT), cancel: vi.fn() }}
        commands={commands}
        createAssetId={() => 'asset-link00'}
        createId={() => 'instance-link00'}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        open
      />,
    )

    await user.upload(
      screen.getByLabelText('STEP file'),
      stepFile('SI_UNIT(.MILLI.,.METRE.);'),
    )
    await screen.findByText('0.242 × 0.200 × 0.214 m')
    await user.click(screen.getByRole('button', { name: 'Add to scene' }))

    expect(commands.importStepObject).toHaveBeenCalledTimes(1)
    expect(commands.importStepObject).toHaveBeenCalledWith(expect.objectContaining({
      asset: expect.objectContaining({ id: 'asset-link00' }),
      instance: expect.objectContaining({ id: 'instance-link00' }),
    }))
    expect(cache.set).toHaveBeenCalledWith('asset-link00', expect.any(Object))
  })

  it('commits one reusable Object Asset and one scene Instance', async () => {
    const user = userEvent.setup()
    const onCommitAsset = vi.fn<SceneCommandService['importStepObject']>(
      async (input) => `object:${input.instance.id}`,
    )
    const cache: ImportStepGeometryCache = { set: vi.fn() }
    render(
      <ImportStepDialog
        cache={cache}
        client={{ import: vi.fn(async () => LINK00_RESULT), cancel: vi.fn() }}
        createAssetId={() => 'asset-link00'}
        createId={() => 'instance-link00'}
        onClose={vi.fn()}
        commands={{ importStepObject: onCommitAsset }}
        onSelect={vi.fn()}
        open
      />,
    )

    await user.upload(
      screen.getByLabelText('STEP file'),
      stepFile('SI_UNIT(.MILLI.,.METRE.);'),
    )
    await screen.findByText('0.242 × 0.200 × 0.214 m')
    await user.click(screen.getByRole('button', { name: 'Add to scene' }))

    expect(onCommitAsset).toHaveBeenCalledWith(expect.objectContaining({
      asset: expect.objectContaining({
        id: 'asset-link00',
        sourceFileName: 'LINK00_CAD.step',
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      }),
      instance: expect.objectContaining({
        id: 'instance-link00',
        assetId: 'asset-link00',
      }),
    }))
    expect(cache.set).toHaveBeenCalledWith(
      'asset-link00',
      expect.objectContaining({ bounds: expect.any(Object) }),
    )
  })

  it('prevalidates extension and size before parsing or mutating scene surfaces', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const harness = renderDialog()
    const input = screen.getByLabelText('STEP file')

    expect(input).toHaveAttribute('accept', '.step,.stp')
    await user.upload(input, stepFile('DATA;', 'fixture.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/\.step or \.stp/i)
    expect(harness.client.import).not.toHaveBeenCalled()

    await user.upload(
      input,
      stepFile('DATA;', 'oversize.step', MAX_STEP_FILE_BYTES + 1),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/50 MiB/i)
    expect(harness.client.import).not.toHaveBeenCalled()
    expect(harness.onCommit).not.toHaveBeenCalled()
    expect(harness.cache.set).not.toHaveBeenCalled()
    expect(harness.onSelect).not.toHaveBeenCalled()
  })

  it('rejects a limit-blocked STEP before parsing or mutating scene surfaces', async () => {
    const user = userEvent.setup()
    const client: ImportStepController = {
      import: vi.fn(async () => LINK00_RESULT),
      cancel: vi.fn(),
    }
    const commands = {
      importStepObject: vi.fn(async () => 'object:never' as const),
    } as Pick<SceneCommandService, 'importStepObject'>
    render(
      <ImportStepDialog
        cache={{ set: vi.fn() }}
        client={client}
        commands={commands}
        importUnavailableReason="STEP Asset limit reached: 64 of 64."
        onClose={vi.fn()}
        onSelect={vi.fn()}
        open
      />,
    )

    const input = screen.getByLabelText('STEP file')
    expect(input).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('64 of 64')
    await user.upload(input, stepFile('SI_UNIT(.MILLI.,.METRE.);'))

    expect(client.import).not.toHaveBeenCalled()
    expect(commands.importStepObject).not.toHaveBeenCalled()
  })

  it('configures and atomically confirms a known-unit STEP asset', async () => {
    const user = userEvent.setup()
    const harness = renderDialog()

    await user.upload(
      screen.getByLabelText('STEP file'),
      stepFile('SI_UNIT(.MILLI.,.METRE.);'),
    )

    expect(await screen.findByText('0.242 × 0.200 × 0.214 m')).toBeVisible()
    expect(screen.getByLabelText('Detected unit')).toHaveTextContent('millimeter')
    expect(screen.queryByRole('combobox', { name: 'Source unit' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('LINK00_CAD')
    expect(screen.getByLabelText('Scale')).toHaveValue(1)
    expect(screen.getByLabelText('Origin mode')).toHaveValue('center')
    expect(screen.getByLabelText('Collision X')).toHaveValue(0.121)
    expect(screen.getByLabelText('Collision Y')).toHaveValue(0.1)
    expect(screen.getByLabelText('Collision Z')).toHaveValue(0.107)

    await user.click(screen.getByLabelText('Graspable'))
    await user.click(screen.getByLabelText('Stack light'))
    await user.click(screen.getByRole('button', { name: 'Add to scene' }))

    expect(harness.onCommit).toHaveBeenCalledTimes(1)
    const input = harness.onCommit.mock.calls[0]![0]
    expect(input).toMatchObject({
      graspable: true,
      asset: {
        id: expect.any(String),
        collisionHalfExtents: [0.121, 0.1, 0.107],
        sourceFileName: 'LINK00_CAD.step',
        importScale: 1,
        originMode: 'center',
        colliderCenter: [0, 0, 0],
      },
      instance: { id: 'imported-link00', name: 'LINK00_CAD' },
    })
    expect(input.asset.sourceBytes.byteLength).toBeGreaterThan(0)
    expect(harness.cache.set).toHaveBeenCalledWith(
      input.asset.id,
      expect.objectContaining({ bounds: expect.any(Object) }),
    )
    expect(harness.onSelect).toHaveBeenCalledWith(input.instance.id)
    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('requires an explicit unit for unitless STEP and applies exactly one scale', async () => {
    const user = userEvent.setup()
    const harness = renderDialog()

    await user.upload(screen.getByLabelText('STEP file'), stepFile('DATA; ENDSEC;'))

    expect(await screen.findByLabelText('Detected unit')).toHaveTextContent('unknown')
    expect(screen.getByRole('button', { name: 'Add to scene' })).toBeDisabled()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Source unit' }), 'inch')
    expect(await screen.findByText('0.006 × 0.005 × 0.005 m')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Origin mode'), 'source')
    await user.click(screen.getByRole('button', { name: 'Add to scene' }))

    const input = harness.onCommit.mock.calls[0]![0]
    expect(input.asset).toMatchObject({
      importScale: 0.0254,
      originMode: 'source',
    })
    expect(input.asset.colliderCenter[0]).toBeCloseTo(-0.0005334, 10)
    expect(input.asset.colliderCenter[1]).toBe(0)
    expect(input.asset.colliderCenter[2]).toBeCloseTo(0.0027178, 10)
  })

  it('cancel and corrupt conversion leave records, cache, and selection unchanged and allow retry', async () => {
    const user = userEvent.setup()
    let rejectImport: ((error: DOMException) => void) | undefined
    const pending = new Promise<OcctSuccessResult>((_resolve, reject) => {
      rejectImport = reject
    })
    const importStep = vi
      .fn<(source: ArrayBuffer | Uint8Array) => Promise<OcctSuccessResult>>()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error('corrupt STEP'))
      .mockResolvedValueOnce(LINK00_RESULT)
    const cancel = vi.fn(() => {
      rejectImport?.(new DOMException('cancelled', 'AbortError'))
    })
    const harness = renderDialog({ import: importStep, cancel })
    const input = screen.getByLabelText('STEP file')

    await user.upload(input, stepFile('DATA;', 'cancel.step'))
    expect(await screen.findByText('Converting STEP…')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel conversion' }))
    expect(cancel).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.queryByText('Converting STEP…')).not.toBeInTheDocument()
    })

    await user.upload(input, stepFile('DATA;', 'corrupt.step'))
    expect(await screen.findByRole('alert')).toHaveTextContent('corrupt STEP')
    await user.upload(input, stepFile('SI_UNIT($,.METRE.);', 'retry.step'))
    expect(await screen.findByText('0.242 × 0.200 × 0.214 m')).toBeVisible()

    expect(harness.onCommit).not.toHaveBeenCalled()
    expect(harness.cache.set).not.toHaveBeenCalled()
    expect(harness.onSelect).not.toHaveBeenCalled()
  })

  it('cancels an owned conversion before importing a second file', async () => {
    const user = userEvent.setup()
    let active = false
    let rejectFirst: ((error: DOMException) => void) | undefined
    const first = new Promise<OcctSuccessResult>((_resolve, reject) => {
      rejectFirst = reject
    })
    const importStep = vi.fn(async () => {
      if (active) {
        throw new Error('A STEP import is already in progress.')
      }
      active = true
      if (importStep.mock.calls.length === 1) {
        return first
      }
      active = false
      return LINK00_RESULT
    })
    const cancel = vi.fn(() => {
      active = false
      rejectFirst?.(new DOMException('cancelled', 'AbortError'))
    })
    renderDialog({ import: importStep, cancel })
    const input = screen.getByLabelText('STEP file')

    await user.upload(input, stepFile('DATA;', 'first.step'))
    expect(await screen.findByText('Converting STEP…')).toBeVisible()
    await user.upload(input, stepFile('SI_UNIT($,.METRE.);', 'second.step'))

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(importStep).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('0.242 × 0.200 × 0.214 m')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('guards the candidate and controls while commit is pending', async () => {
    const user = userEvent.setup()
    let finishCommit: (() => void) | undefined
    const commit = new Promise<void>((resolve) => {
      finishCommit = resolve
    })
    const harness = renderDialog()
    harness.onCommit.mockImplementationOnce(async () => {
      await commit
      return 'object:imported-link00'
    })

    await user.upload(
      screen.getByLabelText('STEP file'),
      stepFile('SI_UNIT($,.METRE.);'),
    )
    await screen.findByText('0.242 × 0.200 × 0.214 m')
    await user.click(screen.getByRole('button', { name: 'Add to scene' }))

    expect(screen.getByLabelText('STEP file')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close import dialog' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finishCommit?.()
    await waitFor(() => expect(harness.cache.set).toHaveBeenCalledTimes(1))
    const cachedAsset = vi.mocked(harness.cache.set).mock.calls[0]![1]
    expect(cachedAsset.group.children.length).toBeGreaterThan(0)
    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not cancel the shared client when it unmounts idle', () => {
    const cancel = vi.fn()
    const client: ImportStepController = {
      import: vi.fn(async () => LINK00_RESULT),
      cancel,
    }
    const view = render(
      <ImportStepDialog
        cache={{ set: vi.fn() }}
        client={client}
        onClose={vi.fn()}
        commands={{ importStepObject: vi.fn(async () => 'object:idle' as const) }}
        onSelect={vi.fn()}
        open
      />,
    )

    view.unmount()

    expect(cancel).not.toHaveBeenCalled()
  })

  it('treats invalid OCCT arrays as an atomic conversion error', async () => {
    const user = userEvent.setup()
    const invalid: OcctSuccessResult = {
      ...LINK00_RESULT,
      meshes: [
        {
          ...LINK00_RESULT.meshes[0]!,
          attributes: { position: { array: [0, 0, Number.NaN] } },
          index: { array: [0, 0, 0] },
        },
      ],
    }
    const harness = renderDialog({ import: vi.fn(async () => invalid) })

    await user.upload(
      screen.getByLabelText('STEP file'),
      stepFile('SI_UNIT($,.METRE.);'),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/non-finite position/i)
    expect(harness.onCommit).not.toHaveBeenCalled()
    expect(harness.cache.set).not.toHaveBeenCalled()
    expect(harness.onSelect).not.toHaveBeenCalled()
  })
})
