import type { JSX } from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The id of the element that names the switch. */
  labelledBy?: string
  /** A name for the switch when no element on screen names it. */
  label?: string
  describedBy?: string
  disabled?: boolean
  id?: string
}

/** An on/off switch, like the mod menu's. */
export function Switch({ checked, onChange, labelledBy, label, describedBy, disabled, id }: SwitchProps): JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`switch${checked ? ' switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}
