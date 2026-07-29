import { render, screen } from '@testing-library/react'
import { StrictMode, useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ForwardKinematicsResultV1 } from '../../../core/mechanism-runtime-v1/types.js'
import { MechanismPoseLayerV1 } from './MechanismPoseLayerV1.js'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { readonly children: ReactNode }) => <>{children}</>,
}))

const bodyWorldPoses: ForwardKinematicsResultV1['bodyWorldPoses'] = {
  torso: { positionM: [1, 2, 3], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] },
}

describe('MechanismPoseLayerV1', () => {
  it('renders each supplied Body at its completed World pose without calculating FK', () => {
    render(<MechanismPoseLayerV1
      bodyWorldPoses={bodyWorldPoses}
      visuals={[{ bodyId: 'torso', sizeM: [0.4, 0.5, 0.6], color: '#2468ac' }]}
    />)

    const body = screen.getByTestId('mechanism-body:torso')
    expect(body).toHaveAttribute('position', '1,2,3')
    expect(body).toHaveAttribute('quaternion', `0,0,${Math.SQRT1_2},${Math.SQRT1_2}`)
    expect(body.querySelector('boxgeometry')).toHaveAttribute('args', '0.4,0.5,0.6')
  })

  it('reports a missing Body after commit without causing a render-phase parent update', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Parent(): ReactNode {
      const [diagnosticCount, setDiagnosticCount] = useState(0)
      return <>
        <output data-testid="diagnostic-count">{diagnosticCount}</output>
        <MechanismPoseLayerV1
          bodyWorldPoses={bodyWorldPoses}
          visuals={[{ bodyId: 'missing', sizeM: [1, 1, 1], color: '#fff' }]}
          onDiagnostic={() => setDiagnosticCount(1)}
        />
      </>
    }

    render(<Parent />)

    expect(screen.getByTestId('diagnostic-count')).toHaveTextContent('1')
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('emits once for a Body newly missing and does not repeat on identical rerender', () => {
    const diagnostic = vi.fn()
    const view = render(<MechanismPoseLayerV1
      bodyWorldPoses={bodyWorldPoses}
      visuals={[{ bodyId: 'torso', sizeM: [1, 1, 1], color: '#fff' }]}
      onDiagnostic={diagnostic}
    />)

    expect(diagnostic).not.toHaveBeenCalled()
    view.rerender(<MechanismPoseLayerV1
      bodyWorldPoses={bodyWorldPoses}
      visuals={[
        { bodyId: 'missing', sizeM: [1, 1, 1], color: '#fff' },
        { bodyId: 'missing', sizeM: [2, 2, 2], color: '#000' },
      ]}
      onDiagnostic={diagnostic}
    />)

    expect(screen.queryByTestId('mechanism-body:missing')).not.toBeInTheDocument()
    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith('BODY_POSE_NOT_FOUND', 'missing')
    view.rerender(<MechanismPoseLayerV1
      bodyWorldPoses={bodyWorldPoses}
      visuals={[
        { bodyId: 'missing', sizeM: [1, 1, 1], color: '#fff' },
        { bodyId: 'missing', sizeM: [2, 2, 2], color: '#000' },
      ]}
      onDiagnostic={diagnostic}
    />)
    expect(diagnostic).toHaveBeenCalledTimes(1)
  })

  it('emits a missing Body once under Strict Mode', () => {
    const diagnostic = vi.fn()

    render(<StrictMode><MechanismPoseLayerV1
      bodyWorldPoses={bodyWorldPoses}
      visuals={[{ bodyId: 'missing', sizeM: [1, 1, 1], color: '#fff' }]}
      onDiagnostic={diagnostic}
    /></StrictMode>)

    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith('BODY_POSE_NOT_FOUND', 'missing')
  })
})
