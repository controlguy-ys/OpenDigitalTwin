import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support.js'
import { SelectionInspectorV6 } from './SelectionInspectorV6.js'

describe('SelectionInspectorV6', () => {
  it.each([null, { kind: 'frame', id: 'world' } as const, { kind: 'group', id: 'group-1' } as const])('renders a safe empty Inspector for %j selection', (selection) => {
    render(<SelectionInspectorV6 project={makeMinimalWorkcellProjectV5()} selection={selection} />)
    expect(screen.getByText('Select a Robot or Object to inspect.')).toBeInTheDocument()
  })

  it('renders a safe stale Object state without routing to a Robot', () => {
    const project = makeMinimalWorkcellProjectV5()
    render(<SelectionInspectorV6 project={project} selection={{ kind: 'entity', id: 'deleted-object' }} />)
    expect(screen.getByText('Selected Object is no longer available.')).toBeInTheDocument()
    expect(screen.queryByText(project.robots[0]?.name ?? '')).toBeNull()
  })
})
