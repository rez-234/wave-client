import type { JSX } from 'react'

import { useNow } from '../../hooks/useNow'
import { formatCountdown } from '../../lib/format'
import { displayUrl, type DeviceCodePrompt } from '../../lib/sign-in'
import { Button } from '../ui/Button'

interface DeviceCodeProps {
  prompt: DeviceCodePrompt
  onOpen: (url: string) => void
  onCopy: (text: string) => void
  copied: boolean
}

/** The code to enter on Microsoft's page, the link to that page and how long the code stays valid. */
export function DeviceCode({ prompt, onOpen, onCopy, copied }: DeviceCodeProps): JSX.Element {
  const now = useNow(1000)
  const left = prompt.expiresAt - now
  const expired = left <= 0

  return (
    <div className="device-code">
      <p className="device-code__intro">Open the Microsoft page below on any device and enter this code:</p>
      <div className="device-code__box">
        <span className="device-code__code mono">{prompt.userCode}</span>
        <Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} onClick={() => onCopy(prompt.userCode)}>
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>
      <Button variant="primary" trailingIcon="external" className="device-code__open" onClick={() => onOpen(prompt.verificationUri)}>
        Open {displayUrl(prompt.verificationUri)}
      </Button>
      <p className={`device-code__expiry${expired ? ' device-code__expiry--expired' : ''}`}>
        {expired ? 'This code has expired. Cancel and try again.' : `The code expires in ${formatCountdown(left)}.`}
      </p>
    </div>
  )
}
