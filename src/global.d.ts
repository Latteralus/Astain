import type { GameApi } from '../electron/types'

declare global {
  interface Window {
    api: GameApi
  }
}

export {}
