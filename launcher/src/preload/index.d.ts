import type { WaveApi } from '@shared/ipc'

declare global {
  interface Window {
    /** The launcher's API, exposed by the preload script. */
    wave: WaveApi
  }
}

export {}
