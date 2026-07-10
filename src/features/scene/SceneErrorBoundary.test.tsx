import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { SceneErrorBoundary } from './SceneErrorBoundary'

function BrokenRenderer({ message }: { message: string }): never {
  throw new Error(message)
}

afterEach(() => vi.restoreAllMocks())

it('shows the renderer error and remounts a fresh child on retry', async () => {
  const user = userEvent.setup()
  vi.spyOn(console, 'error').mockImplementation(() => {})

  function RetryHarness() {
    const [failed, setFailed] = useState(true)
    const [sceneKey, setSceneKey] = useState(0)

    return (
      <SceneErrorBoundary
        key={sceneKey}
        onRetry={() => {
          setFailed(false)
          setSceneKey((key) => key + 1)
        }}
      >
        {failed ? (
          <BrokenRenderer message="WebGL context creation failed" />
        ) : (
          <div>3D renderer ready</div>
        )}
      </SceneErrorBoundary>
    )
  }

  render(<RetryHarness />)

  expect(
    screen.getByRole('heading', { name: '3D renderer unavailable' }),
  ).toBeInTheDocument()
  expect(screen.getByText('WebGL context creation failed')).toBeInTheDocument()

  const retryButton = screen.getByRole('button', { name: 'Retry' })
  expect(retryButton).toHaveAttribute('type', 'button')
  await user.click(retryButton)
  expect(screen.getByText('3D renderer ready')).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: '3D renderer unavailable' }),
  ).not.toBeInTheDocument()
})

it('shows the exact failed LINK id with the original loader message', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const loaderMessage =
    'Could not load /models/robot/LINK04.glb: 404 Not Found'

  render(
    <SceneErrorBoundary
      formatError={(error) => `Failed to load LINK04: ${error.message}`}
      onRetry={() => {}}
    >
      <BrokenRenderer message={loaderMessage} />
    </SceneErrorBoundary>,
  )

  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent('Failed to load LINK04')
  expect(alert).toHaveTextContent(loaderMessage)
})
