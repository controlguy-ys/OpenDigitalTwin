import type { AppCommandRegistryV6 } from '../../commands/v6/app-command-v6.js'

import { CommandSurfaceControlV6 } from './CommandSurfaceControlV6.js'

export interface MainViewPaneToolbarCommandV6Props {
  readonly registry: AppCommandRegistryV6
}

export function MainViewPaneToolbarCommandV6({ registry }: MainViewPaneToolbarCommandV6Props) {
  return <div aria-label="Main View pane commands" role="toolbar">
    <CommandSurfaceControlV6
      ariaControls="v6-main-view"
      commandId="view.main.maximize"
      registry={registry}
      surface="main-view-pane-toolbar"
    />
  </div>
}
