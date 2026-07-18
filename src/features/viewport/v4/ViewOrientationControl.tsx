import type { ReactNode } from 'react'
import type { StandardWorldView } from '../camera-actions.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'

export interface ViewOrientationControlPropsV4 {
  readonly commandBindings: AppCommandBindingsV4
}

const VIEW_ORIENTATION_OPTIONS_V4 = Object.freeze([
  ['isometric', 'Isometric'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['bottom', 'Bottom'],
] as const satisfies readonly (readonly [StandardWorldView, string])[])

export function ViewOrientationControlV4({ commandBindings }: ViewOrientationControlPropsV4): ReactNode {
  const isometric = useAppCommandV4(commandBindings, 'view.orientation.isometric')
  const top = useAppCommandV4(commandBindings, 'view.orientation.top')
  const front = useAppCommandV4(commandBindings, 'view.orientation.front')
  const right = useAppCommandV4(commandBindings, 'view.orientation.right')
  const back = useAppCommandV4(commandBindings, 'view.orientation.back')
  const left = useAppCommandV4(commandBindings, 'view.orientation.left')
  const bottom = useAppCommandV4(commandBindings, 'view.orientation.bottom')
  const commands = [isometric, top, front, right, back, left, bottom]
  const disabled = commands.every(({ command }) => (
    command === null || !command.visible || !command.enabled
  ))
  const error = commands.map(({ error }) => error).find((message) => message !== null) ?? null
  return (
    <>
      <select
      aria-label="View orientation"
        disabled={disabled}
        onChange={(event) => {
          const selected = event.currentTarget.value as StandardWorldView | ''
          if (selected === '') return
          const index = VIEW_ORIENTATION_OPTIONS_V4.findIndex(([view]) => view === selected)
          const [view] = VIEW_ORIENTATION_OPTIONS_V4[index] ?? []
          if (view === undefined) return
          const commandId = `view.orientation.${view}`
          const current = commandBindings.getRegistry().get(commandId)
          if (
            current?.visible !== true
            || current.enabled !== true
            || commandBindings.runtime.getState().pendingCommandIds.has(commandId)
          ) return
          void commandBindings.runtime.invoke(commandId)
        }}
      value=""
    >
      <option value="">View orientation</option>
      {VIEW_ORIENTATION_OPTIONS_V4.map(([view, label], index) => (
        <option disabled={
          commands[index]?.command === null
          || commands[index]?.command.visible !== true
          || commands[index]?.command.enabled !== true
          || commands[index]?.pending
        } key={view} value={view}>{label}</option>
      ))}
    </select>
      {error === null ? null : <span role="alert">{error}</span>}
    </>
  )
}
