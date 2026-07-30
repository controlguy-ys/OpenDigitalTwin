import type { LucideIcon } from 'lucide-react'

export type StatusBadgeStateV6 = 'neutral' | 'selection' | 'success' | 'warning' | 'fault'

export interface StatusBadgeV6Props {
  readonly icon: LucideIcon
  readonly label: string
  readonly state: StatusBadgeStateV6
}

export function StatusBadgeV6({ icon: Icon, label, state }: StatusBadgeV6Props) {
  return (
    <span className="v6-status-badge" data-state={state} data-testid="status-badge-v6">
      <Icon aria-hidden="true" data-testid="status-icon-v6" size={16} />
      <span>{label}</span>
    </span>
  )
}
