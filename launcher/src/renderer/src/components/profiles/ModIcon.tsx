import { memo, useEffect, useRef, useState, type JSX } from 'react'

import { initialOf } from '../../lib/format'

/**
 * Icons already loaded, by profile, mod and file size (an updated jar with the same name has
 * another size). Kept for the window's life: they're small (the main process caps them at 32 KB)
 * and a mods list asks for the same ones again after every toggle and poll.
 */
const cache = new Map<string, Promise<string | null>>()

function loadIcon(profileId: string, key: string, size: number): Promise<string | null> {
  const id = `${profileId}\u0000${key}\u0000${size}`
  let entry = cache.get(id)

  if (!entry) {
    entry = window.wave.mods.icon(profileId, key).catch(() => null)
    cache.set(id, entry)
  }

  return entry
}

interface ModIconProps {
  profileId: string
  modKey: string
  name: string
  size: number
  hasIcon: boolean
}

/** A mod's icon, loaded only once its row scrolls into view; the first letter of its name until then or without one. */
export const ModIcon = memo(function ModIcon({ profileId, modKey, name, size, hasIcon }: ModIconProps): JSX.Element {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    const target = element.current

    if (!hasIcon || visible || !target) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px 0px' }
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasIcon, visible])

  useEffect(() => {
    if (!hasIcon || !visible) {
      setSrc(null)
      return
    }

    let active = true
    void loadIcon(profileId, modKey, size).then((url) => active && setSrc(url))
    return () => {
      active = false
    }
  }, [profileId, modKey, size, hasIcon, visible])

  return (
    <span ref={element} className="mod-icon" aria-hidden="true">
      {src ? <img src={src} alt="" width={36} height={36} draggable={false} /> : <span className="mod-icon__letter">{initialOf(name)}</span>}
    </span>
  )
})
