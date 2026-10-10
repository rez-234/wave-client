import type { JSX, ReactNode } from 'react'

interface SettingRowProps {
  /** Base for the label's and description's ids: `${id}-label`, `${id}-description`. */
  id: string
  label: ReactNode
  description?: ReactNode
  /** Set when the control is a single form field, so clicking the label focuses it. */
  htmlFor?: string
  /** Puts the control under the text instead of beside it (for sliders and wide fields). */
  stacked?: boolean
  /** Shown at the end of the label line, e.g. the slider's value. */
  aside?: ReactNode
  children?: ReactNode
}

/** One setting: its name and explanation on the left, its control on the right (or below). */
export function SettingRow({ id, label, description, htmlFor, stacked = false, aside, children }: SettingRowProps): JSX.Element {
  const Label = htmlFor ? 'label' : 'p'

  return (
    <div className={`setting-row${stacked ? ' setting-row--stacked' : ''}`}>
      <div className="setting-row__text">
        <div className="setting-row__label-line">
          <Label id={`${id}-label`} className="setting-row__label" htmlFor={htmlFor}>
            {label}
          </Label>
          {aside}
        </div>
        {description && (
          <div id={`${id}-description`} className="setting-row__description">
            {description}
          </div>
        )}
      </div>
      {children && <div className="setting-row__control">{children}</div>}
    </div>
  )
}

/** A titled group of settings in a card. */
export function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        {title}
      </h2>
      <div className="card settings-card">{children}</div>
    </section>
  )
}
