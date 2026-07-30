import { useId } from 'react'

export interface SwitchFieldV6Props {
  readonly checked: boolean
  readonly description: string
  readonly label: string
  readonly onChange: (checked: boolean) => void
}

export function SwitchFieldV6({ checked, description, label, onChange }: SwitchFieldV6Props) {
  const inputId = useId()
  const descriptionId = useId()

  return (
    <div className="v6-switch-field">
      <input
        aria-describedby={descriptionId}
        checked={checked}
        id={inputId}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <div>
        <label htmlFor={inputId}>{label}</label>
        <span className="v6-switch-field-description" id={descriptionId}>{description}</span>
      </div>
    </div>
  )
}
