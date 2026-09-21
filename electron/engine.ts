import type { DbManager } from './database/dbManager'
import { processTrips } from './fleet'
import { openDay, processDeliveries } from './market'
import { closeDay, runProductionMinute, snapshot } from './simulation'
import {
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  type ActionResult,
  type EodReport,
  type GamePhase,
  type GameState,
  type Notice,
} from './types'

/** Time scale: 1 real second = 1 in-game minute. */
export const TICK_MS = 1000

/** After a stall (system sleep, debugger pause) the clock catches up at most this many minutes, then resyncs. */
const MAX_CATCH_UP_TICKS = 5

/** All optional: a headless balancing run leaves them out and skips building a state snapshot every minute. */
export interface EngineEvents {
  onState?: (state: GameState) => void
  onEndOfDay?: (report: EodReport) => void
  onNotice?: (notice: Notice) => void
}

export interface EngineOptions {
  tickMs?: number
  /** Open a mid-day save paused so the player can get their bearings before the clock runs. */
  startPaused?: boolean
}

/**
 * The simulation heartbeat. `advance()` is the synchronous game step, so balancing runs can drive it headlessly;
 * `start()` binds it to real time.
 */
export class GameEngine {
  private phase: GamePhase = 'running'
  private timer: NodeJS.Timeout | null = null
  private nextTickAt = 0
  private tickMs: number

  constructor(
    private db: DbManager,
    private events: EngineEvents = {},
    options: EngineOptions = {},
  ) {
    this.tickMs = options.tickMs ?? TICK_MS
    // Covers a brand-new company and a crash between setting the clock and opening the day.
    openDay(db, db.getCompany().day)
    // A save that stopped at 8 PM (or went bankrupt there) reopens on the end-of-day screen.
    if (db.getCompany().minute >= DAY_END_MINUTE) {
      closeDay(db)
      this.phase = 'eod'
    } else if (options.startPaused) {
      this.phase = 'paused'
    }
  }

  get currentPhase(): GamePhase {
    return this.phase
  }

  private emitState() {
    if (this.events.onState) this.events.onState(this.getState())
  }

  getState(): GameState {
    return snapshot(this.db, this.phase)
  }

  getEodReport(): EodReport | null {
    return this.phase === 'eod' ? this.db.getReport(this.db.getCompany().day) : null
  }

  /**
   * Runs a player command atomically, then pushes the new state. Commands are refused while the yard is
   * closed so nothing lands in the ledger after the day's report has been written.
   */
  act(command: (db: DbManager) => ActionResult): ActionResult {
    if (this.db.getCompany().bankrupt_day !== null) return { ok: false, error: 'The company is bankrupt. The bank has the keys now.' }
    if (this.phase === 'eod') return { ok: false, error: 'The yard is closed for the night. Start the next day first.' }
    const result = this.db.transaction(() => command(this.db))
    this.emitState()
    return result
  }

  /**
   * Works one in-game minute and advances the clock, closing the day when it reaches 8:00 PM. Trucks move and
   * unload first, so lumber that arrives this minute can be worked this minute.
   */
  advance(): void {
    if (this.phase !== 'running') return
    const { day, minute } = this.db.getCompany()
    const next = minute + 1
    const notices = this.db.transaction(() => {
      const arrived = [...processDeliveries(this.db), ...processTrips(this.db)]
      runProductionMinute(this.db)
      if (next < DAY_END_MINUTE) this.db.setClock(day, next)
      return arrived
    })
    for (const notice of notices) this.events.onNotice?.(notice)
    if (next >= DAY_END_MINUTE) {
      const report = closeDay(this.db)
      this.phase = 'eod'
      this.stopTimer()
      this.emitState()
      this.events.onEndOfDay?.(report)
      return
    }
    this.emitState()
  }

  start(): void {
    if (this.phase === 'running') this.startTimer()
  }

  stop(): void {
    this.stopTimer()
  }

  pause(): GameState {
    if (this.phase === 'running') {
      this.phase = 'paused'
      this.stopTimer()
    }
    return this.getState()
  }

  resume(): GameState {
    if (this.phase === 'paused') {
      this.phase = 'running'
      this.startTimer()
    }
    return this.getState()
  }

  /** Opens the next morning. A bankrupt company stays closed for good. */
  startNextDay(): GameState {
    if (this.phase === 'eod' && this.db.getCompany().bankrupt_day === null) {
      const day = this.db.getCompany().day + 1
      this.db.transaction(() => {
        this.db.setClock(day, DAY_START_MINUTE)
        openDay(this.db, day)
      })
      this.phase = 'running'
      this.startTimer()
    }
    return this.getState()
  }

  // Schedules each tick against an absolute deadline so setTimeout jitter doesn't accumulate into clock drift.
  private startTimer() {
    if (this.timer) return
    this.nextTickAt = performance.now() + this.tickMs
    this.schedule()
  }

  private stopTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    this.timer = setTimeout(() => this.onTimer(), Math.max(0, this.nextTickAt - performance.now()))
  }

  private onTimer() {
    this.timer = null
    const now = performance.now()
    const due = Math.floor((now - this.nextTickAt) / this.tickMs) + 1
    for (let i = 0; i < Math.min(due, MAX_CATCH_UP_TICKS) && this.phase === 'running'; i++) this.advance()
    if (this.phase !== 'running') return
    this.nextTickAt = due > MAX_CATCH_UP_TICKS ? now + this.tickMs : this.nextTickAt + due * this.tickMs
    this.schedule()
  }
}
