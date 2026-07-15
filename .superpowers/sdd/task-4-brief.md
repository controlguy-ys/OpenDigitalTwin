### Task 4: Make Robot Jobs Discoverable and Fix the Desktop Shell

**Files:**
- Create: `src/features/jobs/RobotJobList.tsx`
- Create: `src/features/jobs/RobotJobList.test.tsx`
- Create: `src/features/jobs/job-command-service.ts`
- Create: `src/features/jobs/job-command-service.test.ts`
- Create: `src/features/ui/BottomWorkspace.tsx`
- Create: `src/features/ui/BottomWorkspace.test.tsx`
- Create: `src/features/ui/theme-preference.ts`
- Create: `src/features/ui/theme-preference.test.ts`
- Modify: `src/features/ui/Timeline.tsx`
- Test: `src/features/ui/Timeline.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`

**Interfaces:**
- Produces: upper Scene Objects/lower Robot Jobs sidebar split, active Job selection, Job/Pose CRUD and ordering, Timeline/Collision bottom tabs, fixed desktop sizing, and Light/Dark browser preference.

- [ ] **Step 1: Write layout and Job RED tests**

```tsx
it('renders Scene Objects above Robot Jobs and selects a Job', async () => {
  render(<AppShell assetTree={<SceneExplorer />} jobTree={<RobotJobList />} viewport={<div />} />)
  expect(screen.getByRole('region', { name: 'Scene Objects' })).toBeVisible()
  expect(screen.getByRole('region', { name: 'Robot Jobs' })).toBeVisible()
  await user.click(screen.getByRole('treeitem', { name: 'Pick Cups' }))
  expect(jobCommands.setActiveJob).toHaveBeenCalledWith('job-pick-cups')
})

it('persists the draggable 60/40 split only in browser preferences', async () => {
  await dragSidebarDividerTo(55)
  expect(localStorage.getItem('robotsim.sidebarSplitPercent')).toBe('55')
  expect(JSON.stringify(activeProject())).not.toContain('sidebarSplitPercent')
})

it('moves and deletes poses inside the active Job atomically', async () => {
  await jobCommands.movePose('job-a', 'pose-3', 0)
  await jobCommands.deletePose('job-a', 'pose-2')
  expect(activeJob().poses.map(({ id }) => id)).toEqual(['pose-3', 'pose-1'])
})

it('shows only one bottom workspace panel at a time', async () => {
  render(<BottomWorkspace />)
  await user.click(screen.getByRole('tab', { name: 'Collision' }))
  expect(screen.getByRole('tabpanel', { name: 'Collision' })).toBeVisible()
  expect(screen.queryByRole('tabpanel', { name: 'Timeline' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run RED**

```powershell
npm run test:run -- src/features/jobs src/features/ui src/app/AppShell.test.tsx
```

Expected: FAIL because Jobs have no sidebar surface and Timeline/Collision render side-by-side.

- [ ] **Step 3: Implement Job commands through V3**

```ts
export interface JobCommandService {
  createJob(name: string): Promise<string>
  renameJob(jobId: string, name: string): Promise<void>
  duplicateJob(jobId: string): Promise<string>
  deleteJob(jobId: string): Promise<void>
  setActiveJob(jobId: string | null): Promise<void>
  saveCurrentPose(name: string): Promise<string>
  setPoseSpeed(jobId: string, poseId: string, speedPercentToNext: number): Promise<void>
  movePose(jobId: string, poseId: string, nextIndex: number): Promise<void>
  deletePose(jobId: string, poseId: string): Promise<void>
}
```

Every command submits one Project recipe. Speed accepts 1–100%. Moving or deleting a Pose recomputes canonical outgoing durations in the same recipe and increments the Job revision once.

- [ ] **Step 4: Implement the fixed shell and theme preference**

Set `html`, `body`, and `#root` to `height: 100%; overflow: hidden`. The shell owns `100dvh`; only Scene Objects, Robot Jobs, Inspector, Timeline, and Collision content areas scroll internally. The Sidebar starts at 60/40 and its draggable divider is clamped to 35–75%. Persist the split, active bottom tab, drawer state, and `'light' | 'dark' | 'system'` theme in browser storage; Project archives do not include them. Replace the permanent STEP/Robot/primitive/Group buttons with one **Add** menu, and move Robot Mechanics/Geometry/Frames to the selected target Inspector.

- [ ] **Step 5: Run GREEN and commit**

```powershell
npm run test:run -- src/features/jobs src/features/ui src/app
npm run lint
npm run build
git add src/features/jobs src/features/ui src/app src/styles/tokens.css src/styles/global.css
git diff --cached --check
git commit -m "feat: expose jobs in the desktop shell"
```

---
