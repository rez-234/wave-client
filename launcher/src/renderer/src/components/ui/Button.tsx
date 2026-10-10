import type { ButtonHTMLAttributes, JSX, ReactNode, Ref } from 'react'

import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** An icon after the label, e.g. for links that open the browser. */
  trailingIcon?: IconName
  children?: ReactNode
  ref?: Ref<HTMLButtonElement>
}

/** A flat button: accent fill for the main action, raised for secondary, danger outline, or ghost. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ')
  const iconSize = size === 'lg' ? 18 : size === 'sm' ? 14 : 16

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={iconSize - 2} className="btn__trailing" />}
    </button>
  )
}
