import { create } from 'zustand'
import type { ActionResult, EodReport, GameState, NoticeTone } from '../../electron/types'

export type Screen =
  | 'dashboard'
  | 'contracts'
  | 'market'
  | 'yard'
  | 'inventory'
  | 'properties'
  | 'fleet'
  | 'staff'
  | 'ledger'

export interface ToastNotice {
  id: number
  /** 'error' is a rejected player action; the others come from the simulation. */
  tone: NoticeTone | 'error'
  text: string
}

/** Oldest notices drop off once this many are showing. */
const MAX_NOTICES = 4

interface GameStore {
  screen: Screen
  /** The loaded career; null on the title menu. */
  game: GameState | null
  eodReport: EodReport | null
  notices: ToastNotice[]
  setScreen: (screen: Screen) => void
  setGame: (game: GameState | null) => void
  setEodReport: (report: EodReport | null) => void
  pushNotice: (tone: ToastNotice['tone'], text: string) => void
  dismissNotice: (id: number) => void
  /** Loads the main process's current game (or none) into the store, e.g. after starting or loading a save. */
  syncGame: () => Promise<void>
  /** Closes the game (it's already saved) and shows the title menu. */
  exitToMenu: () => Promise<void>
}

let nextNoticeId = 1

export const useGameStore = create<GameStore>((set) => ({
  screen: 'dashboard',
  game: null,
  eodReport: null,
  notices: [],
  setScreen: (screen) => set({ screen }),
  setGame: (game) => set({ game }),
  setEodReport: (eodReport) => set({ eodReport }),
  pushNotice: (tone, text) =>
    set((s) => ({ notices: [...s.notices, { id: nextNoticeId++, tone, text }].slice(-MAX_NOTICES) })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  syncGame: async () => {
    const [game, eodReport] = await Promise.all([window.api.getState(), window.api.getEodReport()])
    set({ game, eodReport, screen: 'dashboard', notices: [] })
  },
  exitToMenu: async () => {
    await window.api.exitToMenu()
    set({ game: null, eodReport: null, notices: [] })
  },
}))

/** Sends a player command to the main process and surfaces a rejection. State arrives via the game:state push. */
export async function runAction(command: () => Promise<ActionResult>): Promise<boolean> {
  const result = await command()
  if (!result.ok) useGameStore.getState().pushNotice('error', result.error)
  return result.ok
}
