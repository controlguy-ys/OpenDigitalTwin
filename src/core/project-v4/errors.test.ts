import { describe, expect, it } from 'vitest'

import { failProjectV4, ProjectV4Error } from './errors'

describe('ProjectV4Error', () => {
  it('reports a stable code, JSON path, message, and recovery', () => {
    const error = new ProjectV4Error(
      'INVALID_PROJECT_VALUE',
      '$.robots[0].id',
      'Robot id must not be empty.',
      'Assign a stable robot id.',
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: 'INVALID_PROJECT_VALUE',
      path: '$.robots[0].id',
      message: 'INVALID_PROJECT_VALUE at $.robots[0].id: Robot id must not be empty.',
      recovery: 'Assign a stable robot id.',
    })
  })

  it('throws the shared error contract through failProjectV4', () => {
    expect(() => failProjectV4(
      'PROJECT_NOT_READY',
      '$.metadata',
      'Project metadata is incomplete.',
      'Complete the required metadata.',
    )).toThrowError(expect.objectContaining({
      code: 'PROJECT_NOT_READY',
      path: '$.metadata',
      recovery: 'Complete the required metadata.',
    }))
  })
})
