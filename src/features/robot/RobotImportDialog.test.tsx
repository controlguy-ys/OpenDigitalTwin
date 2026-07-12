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
    expect(screen.getByRole('button', { name: 'Import new Robot' })).toBeDisabled()
    expect(client.import).not.toHaveBeenCalled()
  })

  it('shows deterministic LINK mappings before replacing the single robot', async () => {
    const user = userEvent.setup()
    render(<RobotImportDialog onClose={vi.fn()} open />)

    await user.upload(
      screen.getByLabelText('Robot link STEP files'),
      Array.from({ length: 7 }, (_, index) =>
        stepFile(`custom_LINK0${6 - index}.step`),
      ),
    )

    expect(screen.getByLabelText('Robot link mapping')).toHaveTextContent(
      'LINK00custom_LINK00.stepLINK01custom_LINK01.stepLINK02custom_LINK02.step',
    )
    expect(screen.getByRole('button', { name: 'Import new Robot' })).toBeEnabled()
  })

  it('offers a separate one-file Link replacement flow', async () => {
    const user = userEvent.setup()
    render(<RobotImportDialog onClose={vi.fn()} open />)

    await user.selectOptions(screen.getByLabelText('Robot import mode'), 'replace-link')
    await user.selectOptions(screen.getByLabelText('Target Robot Link'), 'LINK04')
    await user.upload(
      screen.getByLabelText('Robot link STEP files'),
      stepFile('replacement.step'),
    )

    expect(screen.getByLabelText('Robot link mapping')).toHaveTextContent(
      'LINK04replacement.step',
    )
    expect(screen.getByRole('button', { name: 'Replace selected Link' })).toBeEnabled()
  })
})
