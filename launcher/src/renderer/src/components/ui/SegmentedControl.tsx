import { useRef, type JSX, type KeyboardEvent } from 'react'

interface SegmentedControlProps<T extends string> {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  labelledBy?: string
  describedBy?: string
  disabled?: boolean
}

/** A row of mutually exclusive options (a radio group): arrow keys move between them. */
export function SegmentedControl<T extends string>({ value, options, onChange, labelledBy, describedBy, disabled }: SegmentedControlProps<T>): JSX.Element {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = options.findIndex((option) => option.value === value)
    let next: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % options.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = options.length - 1
    }

    const option = next === null ? undefined : options[next]

    if (next !== null && option) {
      event.preventDefault()
      onChange(option.value)
      buttons.current[next]?.focus()
    }
  }

  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} onKeyDown={disabled ? undefined : onKeyDown}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            className={`segmented__option${selected ? ' segmented__option--selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
