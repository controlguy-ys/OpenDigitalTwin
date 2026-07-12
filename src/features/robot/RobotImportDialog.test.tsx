import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RobotImportDialog } from './RobotImportDialog'

function stepFile(name: string): File {
  return new File(['STEP'], name, { type: 'application/step' })
}

describe('RobotImportDialog', () => {
  it('rejects an eighth STEP file before conversion', async () => {
    const user = userEvent.setup()
    const client = { import: vi.fn(), cancel: vi.fn() }
    render(
      <RobotImportDialog
        client={client}
        onClose={vi.fn()}
        open
      />,
    )

    await user.upload(
      screen.getByLabelText('Robot link STEP files'),
      Array.from({ length: 8 }, (_, index) => stepFile(`part-${index}.step`)),
    )

    expect(screen.getByRole('alert')).toHaveTextContent('maximum of 7')
    expect(screen.getByRole('button', { name: 'Replace robot geometry' })).toBeDisabled()
    expect(client.import).not.toHaveBeenCalled()
  })

  it('shows deterministic LINK mappings before replacing the single robot', async () => {
    const user = userEvent.setup()
    render(<RobotImportDialog onClose={vi.fn()} open />)

    await user.upload(screen.getByLabelText('Robot link STEP files'), [
      stepFile('custom_LINK01.step'),
      stepFile('custom_LINK00.step'),
    ])

    expect(screen.getByLabelText('Robot link mapping')).toHaveTextContent(
      'LINK00custom_LINK00.stepLINK01custom_LINK01.step',
    )
    expect(screen.getByRole('button', { name: 'Replace robot geometry' })).toBeEnabled()
  })
})
