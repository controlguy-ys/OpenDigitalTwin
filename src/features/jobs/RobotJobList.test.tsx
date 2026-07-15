import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { ProjectSimulationStateV3 } from '../../domain/project/simulation-job-v1'
import type { JobCommandService } from './job-command-service'
import { RobotJobList } from './RobotJobList'

function commands(): JobCommandService {
  return {
    createJob: vi.fn(async () => 'job-new'),
    renameJob: vi.fn(async () => undefined),
    duplicateJob: vi.fn(async () => 'job-copy'),
    deleteJob: vi.fn(async () => undefined),
    setActiveJob: vi.fn(async () => undefined),
    saveCurrentPose: vi.fn(async () => 'pose-new'),
    setPoseSpeed: vi.fn(async () => undefined),
    movePose: vi.fn(async () => undefined),
    deletePose: vi.fn(async () => undefined),
  }
}

const simulation: ProjectSimulationStateV3 = {
  activeJobId: 'job-pick-cups',
  jobs: [
    { id: 'job-pick-cups', name: 'Pick Cups', revision: 1, poses: [] },
    {
      id: 'job-pack-cups',
      name: 'Pack Cups',
      revision: 2,
      poses: [{
        id: 'pose-pack', name: 'Pack', anglesDeg: [0, 0, 0, 0, 0, 0],
        durationMs: 1_000, easing: 'linear', speedPercentToNext: 100,
      }],
    },
  ],
}

it('always exposes New Job, Pose counts, active state, and Job selection', async () => {
  const user = userEvent.setup()
  const jobCommands = commands()
  render(<RobotJobList commands={jobCommands} simulation={simulation} />)

  expect(screen.getByRole('button', { name: '+ New Job' })).toBeVisible()
  expect(screen.getByRole('treeitem', { name: 'Pick Cups, 0 Poses' })).toHaveAttribute(
    'aria-selected', 'true',
  )
  expect(screen.getByRole('treeitem', { name: 'Pack Cups, 1 Pose' })).toHaveAttribute(
    'aria-selected', 'false',
  )

  await user.click(screen.getByRole('treeitem', { name: 'Pack Cups, 1 Pose' }))
  expect(jobCommands.setActiveJob).toHaveBeenCalledWith('job-pack-cups')
})

it('offers Rename, Duplicate, and confirmed Delete from a Job context menu', async () => {
  const user = userEvent.setup()
  const jobCommands = commands()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Renamed Job')
  render(<RobotJobList commands={jobCommands} simulation={simulation} />)

  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Pick Cups, 0 Poses' }),
  })
  await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
  expect(jobCommands.renameJob).toHaveBeenCalledWith('job-pick-cups', 'Renamed Job')

  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Pick Cups, 0 Poses' }),
  })
  await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
  expect(jobCommands.duplicateJob).toHaveBeenCalledWith('job-pick-cups')

  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('treeitem', { name: 'Pick Cups, 0 Poses' }),
  })
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(confirm).toHaveBeenCalled()
  expect(jobCommands.deleteJob).toHaveBeenCalledWith('job-pick-cups')
  prompt.mockRestore()
  confirm.mockRestore()
})

it('enforces the numeric 32 Job limit across create and duplicate commands', async () => {
  const user = userEvent.setup()
  const fullSimulation: ProjectSimulationStateV3 = {
    activeJobId: 'job-1',
    jobs: Array.from({ length: 32 }, (_, index) => ({
      id: `job-${index + 1}`,
      name: `Job ${index + 1}`,
      revision: 1,
      poses: [],
    })),
  }
  render(<RobotJobList commands={commands()} simulation={fullSimulation} />)

  expect(screen.getByRole('button', { name: '+ New Job' })).toBeDisabled()
  expect(screen.getByText(/32 Job limit/i)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Job 1 commands' }))
  expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeDisabled()
})

it('implements tree navigation plus keyboard context menu open and Escape focus return', async () => {
  const user = userEvent.setup()
  render(<RobotJobList commands={commands()} simulation={simulation} />)
  const first = screen.getByRole('treeitem', { name: 'Pick Cups, 0 Poses' })
  const second = screen.getByRole('treeitem', { name: 'Pack Cups, 1 Pose' })

  first.focus()
  await user.keyboard('{ArrowDown}')
  expect(second).toHaveFocus()
  await user.keyboard('{Home}')
  expect(first).toHaveFocus()
  await user.keyboard('{Shift>}{F10}{/Shift}')
  expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(first).toHaveFocus()
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})
