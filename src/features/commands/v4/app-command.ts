export type AppCommandSectionV4 =
  | 'project'
  | 'home'
  | 'model'
  | 'job'
  | 'simulation'
  | 'connectivity'
  | 'view'
  | 'help'

export type AppCommandKindV4 = 'action' | 'toggle' | 'radio'
export type AppCommandExecutionV4 = void | 'cancelled'
export type AppCommandOutcomeV4 =
  | 'completed'
  | 'cancelled'
  | 'ignored'
  | 'failed'

export interface AppCommandV4 {
  readonly id: string
  readonly label: string
  readonly section: AppCommandSectionV4
  readonly kind: AppCommandKindV4
  readonly visible: boolean
  readonly enabled: boolean
  readonly checked?: boolean
  readonly groupId?: string
  readonly disabledReason?: string
  readonly destructive?: boolean
  readonly shortcut?: string
  execute(): AppCommandExecutionV4 | Promise<AppCommandExecutionV4>
}
