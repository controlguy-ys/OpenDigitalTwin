import { act, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  OperationFeedback,
  createOperationFeedbackStore,
  runOperationWithFeedback,
} from './OperationFeedback'

it('shows non-blocking resource thresholds with exact current and limit', () => {
  const store = createOperationFeedbackStore()
  render(<OperationFeedback store={store} />)

  act(() => store.getState().publishResourceWarning({
    code: 'OBJECT_INSTANCE_WARNING', current: 205, limit: 256,
  }))

  expect(screen.getByRole('status')).toHaveTextContent(
    'OBJECT_INSTANCE_WARNING: 205 of 256',
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows rejected operations as an alert instead of swallowing the error', () => {
  const store = createOperationFeedbackStore()
  render(<OperationFeedback store={store} />)

  act(() => store.getState().publishError(
    new Error('OBJECT_INSTANCE_LIMIT: 256 of 256 Object Instances are already in use.'),
  ))

  expect(screen.getByRole('alert')).toHaveTextContent(
    'OBJECT_INSTANCE_LIMIT: 256 of 256 Object Instances are already in use.',
  )
})

it('routes a rejected async create operation into the visible feedback boundary', async () => {
  const store = createOperationFeedbackStore()
  const onSuccess = vi.fn()

  await runOperationWithFeedback(
    async () => { throw new Error('MAX_OBJECT_INSTANCES is 256; current usage is 256 of 256.') },
    onSuccess,
    store,
  )

  expect(onSuccess).not.toHaveBeenCalled()
  expect(store.getState().message).toEqual({
    kind: 'alert',
    text: 'MAX_OBJECT_INSTANCES is 256; current usage is 256 of 256.',
  })
})

it('clears old feedback before an operation and preserves a warning emitted by that operation', async () => {
  const store = createOperationFeedbackStore()
  render(<OperationFeedback store={store} />)
  store.getState().publishError(new Error('old failure'))

  await runOperationWithFeedback(
    async () => {
      expect(store.getState().message).toBeNull()
      store.getState().publishResourceWarning({
        code: 'OBJECT_INSTANCE_WARNING', current: 205, limit: 256,
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'created'
    },
    vi.fn(),
    store,
  )

  expect(screen.getByRole('status')).toHaveTextContent(
    'OBJECT_INSTANCE_WARNING: 205 of 256',
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(screen.getByRole('status')).toBeVisible()
})
