// Headless economy simulation: plays scripted careers through the real engine, minute by minute, and checks that
// the economy behaves as designed. Above all it checks the death spiral: fixed costs must bankrupt a company that
// over-expands into a contract lull, while a sensible operator stays afloat.
//
//   npm run sim                         all scenarios, 5 seeds each
//   npm run sim -- --seeds 10           more seeds
//   npm run sim -- --only steady        scenarios whose name contains "steady"
//   npm run sim -- --trace steady       day-by-day ledger for the first seed of the matching scenario
//
// Exits non-zero if any expectation fails, so it can gate balance changes.
import * as actions from '../../electron/actions'
import { DbManager } from '../../electron/database/dbManager'
import { GameEngine } from '../../electron/engine'
import {
  CAPITALIZATIONS,
  EQUIPMENT,
  PROPERTY_RESALE,
  SPECIES,
  vehicleResale,
  VEHICLES,
  type Capitalization,
} from '../../electron/rules'
import { operate, recruit, staffStations, type BotContext, type OperatorOptions } from './bot'

// --- Scenarios -----------------------------------------------------------------------------------------

interface Scenario {
  name: string
  description: string
  capitalization: Capitalization
  days: number
  /** Day 1, 8:00 AM, before the clock starts. */
  setup?: (ctx: BotContext) => void
  /** Each morning from day 2, before the clock starts. */
  morning?: (ctx: BotContext, day: number) => void
  /** Whether the operator takes on new contracts that day. False models a contract lull. */
  takeWork: (day: number) => boolean
  operator?: Partial<OperatorOptions>
  expect: Expectation[]
}

interface Expectation {
  label: string
  check: (runs: RunResult[]) => boolean
}

/** A modest first step: a dip tank for the starting hand and one more worker on the brush bench. */
function modestExpansion(ctx: BotContext) {
  ctx.act((db) => actions.buyEquipment(db, 'dip_tank'))
  ctx.act((db) => actions.buyEquipment(db, 'drying_rack'))
  recruit(ctx, 'classifieds', 1)
  staffStations(ctx)
}

/** Everything at once on day 1: more stations, a crew of stainers, a truck and driver, and a storage lot. */
function overExpansion(ctx: BotContext) {
  for (const type of ['dip_tank', 'dip_tank', 'drying_rack', 'drying_rack', 'drying_rack', 'drying_rack'] as const) {
    ctx.act((db) => actions.buyEquipment(db, type))
  }
  recruit(ctx, 'trade_board', 3)
  ctx.act((db) => actions.buyVehicle(db, 'pickup'))
  ctx.act((db) => actions.hireCrew(db, 'driver'))
  ctx.act((db) => actions.acquireProperty(db, 'gravel_lot', 'lease'))
  ctx.act((db) => actions.hireCrew(db, 'forklift_driver'))
  staffStations(ctx)
}

/** Sheds what can be shed: surplus stainers, the truck and its driver, the lot and its forklift crew. */
function retrench(ctx: BotContext) {
  const { db } = ctx
  for (const e of db.getEmployees().slice(1)) ctx.act((d) => actions.fireEmployee(d, e.id))
  for (const p of db.getProperties()) ctx.act((d) => actions.releaseProperty(d, p.id))
  for (const v of db.getVehicles()) ctx.act((d) => actions.sellVehicle(d, v.id))
  for (const c of db.getCrew()) ctx.act((d) => actions.fireCrew(d, c.id))
}

const lullAfter = (day: number) => (d: number) => d < day

const SCENARIOS: Scenario[] = [
  {
    name: 'idle',
    description: 'Bootstrapped, never takes a contract. Pure fixed costs.',
    capitalization: 'bootstrapped',
    days: 150,
    takeWork: () => false,
    expect: [
      { label: 'goes bankrupt', check: (runs) => runs.every((r) => r.bankruptDay !== null) },
      {
        label: 'but only after 60+ days (a new player has time to learn)',
        check: (runs) => runs.every((r) => (r.bankruptDay ?? Infinity) >= 60),
      },
    ],
  },
  {
    name: 'starter',
    description: 'Bootstrapped, plays the starting yard as-is: one hand on the brush bench, takes what it can finish.',
    capitalization: 'bootstrapped',
    days: 60,
    takeWork: () => true,
    expect: [
      { label: 'survives 60 days', check: (runs) => runs.every((r) => r.bankruptDay === null) },
      { label: 'but loses money (the starting yard is too small to live on)', check: (runs) => median(runs.map((r) => r.equity)) < 50000 },
    ],
  },
  {
    name: 'steady',
    description: 'Bootstrapped, buys a dip tank and hires one hand on day 1, then takes what it can finish.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: modestExpansion,
    takeWork: () => true,
    expect: [
      { label: 'survives 60 days', check: (runs) => runs.every((r) => r.bankruptDay === null) },
      { label: 'grows equity (median above the $50k start)', check: (runs) => median(runs.map((r) => r.equity)) > 50000 },
      { label: 'fails few contracts (<10%)', check: (runs) => sum(runs.map((r) => r.failed)) < 0.1 * sum(runs.map((r) => r.completed + r.failed)) },
    ],
  },
  {
    name: 'overhire-lull',
    description: 'Over-expands on day 1 (2 dip tanks, 4 stainers, truck + driver, leased lot + forklift), then no contracts come.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: overExpansion,
    takeWork: () => false,
    expect: [
      { label: 'death spiral: bankrupt every time', check: (runs) => runs.every((r) => r.bankruptDay !== null) },
      { label: 'within 25 days', check: (runs) => runs.every((r) => (r.bankruptDay ?? Infinity) <= 25) },
    ],
  },
  {
    name: 'overhire-cut',
    description: 'Same over-expansion and lull, but lays everyone off and sells the truck on day 3.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: overExpansion,
    morning: (ctx, day) => day === 3 && retrench(ctx),
    takeWork: () => false,
    expect: [
      {
        // Idle overhead still sinks a company with no work at all (see "idle"), so cutting buys time, not rescue.
        label: 'lasts 20+ days, about twice as long as not cutting (severance hurts, but stops the bleeding)',
        check: (runs) => runs.every((r) => r.bankruptDay === null || r.bankruptDay >= 20),
      },
    ],
  },
  {
    name: 'overhire-busy',
    description: 'Same over-expansion, with contracts flowing. Uses the truck for deliveries and mill hauls.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: overExpansion,
    takeWork: () => true,
    operator: { useFleet: true, haulOwnLumber: true },
    expect: [{ label: 'survives with work flowing', check: (runs) => runs.every((r) => r.bankruptDay === null) }],
  },
  {
    name: 'steady-fleet',
    description: 'Steady operator plus a pickup and a driver: hauls its own lumber and delivers for freight.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: (ctx) => {
      modestExpansion(ctx)
      ctx.act((db) => actions.buyVehicle(db, 'pickup'))
      ctx.act((db) => actions.hireCrew(db, 'driver'))
    },
    takeWork: () => true,
    operator: { useFleet: true, haulOwnLumber: true },
    expect: [
      { label: 'survives 60 days', check: (runs) => runs.every((r) => r.bankruptDay === null) },
      // The truck costs $16k up front; it should earn most of that back in two months, not sink the company.
      { label: 'grows equity despite the $16k truck', check: (runs) => median(runs.map((r) => r.equity)) > 50000 },
    ],
  },
  {
    name: 'steady-lull',
    description: 'Steady operator whose contracts dry up after day 20.',
    capitalization: 'bootstrapped',
    days: 60,
    setup: modestExpansion,
    takeWork: lullAfter(20),
    expect: [{ label: 'a modest yard rides out a 40-day lull', check: (runs) => runs.every((r) => r.bankruptDay === null) }],
  },
  {
    name: 'bank-steady',
    description: 'Bank-backed start, same modest expansion. The loan payment runs every night.',
    capitalization: 'bank_backed',
    days: 60,
    setup: modestExpansion,
    takeWork: () => true,
    expect: [{ label: 'survives 60 days', check: (runs) => runs.every((r) => r.bankruptDay === null) }],
  },
  {
    name: 'bank-overhire-lull',
    description: 'Bank-backed start spent on the over-expansion, then a lull.',
    capitalization: 'bank_backed',
    days: 60,
    setup: overExpansion,
    takeWork: () => false,
    expect: [{ label: 'the loan payment speeds the spiral: bankrupt within 60 days', check: (runs) => runs.every((r) => r.bankruptDay !== null) }],
  },
]

// --- Running -------------------------------------------------------------------------------------------

interface DayLine {
  day: number
  endingCash: number
  revenue: number
  overnight: number
  operating: number
  stainedBf: number
  /** End-of-day stock and the board feet of accepted work still to deliver. */
  rawBf: number
  finishedBf: number
  backlogBf: number
}

interface RunResult {
  seed: number
  bankruptDay: number | null
  daysPlayed: number
  endCash: number
  minCash: number
  /** Cash plus what the assets would fetch, less the loan. */
  equity: number
  revenue: number
  completed: number
  failed: number
  /** Why contracts failed, with counts. */
  failures: Record<string, number>
  /** Average overnight charges over the last 7 days played. */
  nightlyOverhead: number
  days: DayLine[]
}

/** Small, fast, seedable PRNG so every run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Minutes between the operator's decision passes. */
const DECISION_EVERY = 15

function equity(db: DbManager): number {
  const c = db.getCompany()
  let total = c.cash - c.loan_balance
  for (const e of db.getEquipment()) total += EQUIPMENT[e.type].price * 0.5
  for (const v of db.getVehicles()) total += vehicleResale(VEHICLES[v.type], v.condition)
  for (const p of db.getProperties()) if (p.tenure === 'own') total += p.pricePaid * PROPERTY_RESALE
  for (const i of db.getInventory()) total += i.boardFeet * SPECIES[i.species].basePricePerBf
  return total
}

function runScenario(scenario: Scenario, seed: number): RunResult {
  // The engine and actions default to Math.random, so seeding it makes the whole run deterministic.
  Math.random = mulberry32(seed)
  const db = new DbManager(':memory:', { companyName: scenario.name, capitalization: scenario.capitalization })
  const engine = new GameEngine(db)
  const ctx: BotContext = { db, engine, act: (command) => engine.act(command).ok }
  let minCash = db.getCompany().cash
  const stock = new Map<number, Pick<DayLine, 'rawBf' | 'finishedBf' | 'backlogBf'>>()

  scenario.setup?.(ctx)
  for (;;) {
    const { day, minute, bankrupt_day } = db.getCompany()
    if (engine.currentPhase === 'eod') {
      minCash = Math.min(minCash, db.getCompany().cash)
      const inventory = db.getInventory()
      stock.set(day, {
        rawBf: inventory.filter((i) => i.state === 'raw').reduce((s, i) => s + i.boardFeet, 0),
        finishedBf: inventory.filter((i) => i.state === 'finished').reduce((s, i) => s + i.boardFeet, 0),
        backlogBf: db.getContracts(['active', 'shipping']).reduce((s, k) => s + k.boardFeet, 0),
      })
      if (bankrupt_day !== null || day >= scenario.days) break
      engine.startNextDay()
      engine.stop() // startNextDay arms the real-time timer; the simulation drives the clock itself.
      scenario.morning?.(ctx, day + 1)
      continue
    }
    if ((minute - 480) % DECISION_EVERY === 0) operate(ctx, scenario.takeWork(day), scenario.operator)
    engine.advance()
  }

  const reports = db.getReportHistory().reverse()
  const recent = reports.slice(-7)
  const contracts = db.getContractHistory(100000)
  const c = db.getCompany()
  const result: RunResult = {
    seed,
    bankruptDay: c.bankrupt_day,
    daysPlayed: c.day,
    endCash: c.cash,
    minCash,
    equity: equity(db),
    revenue: reports.reduce((s, r) => s + r.revenue, 0),
    completed: contracts.filter((k) => k.status === 'completed').length,
    failed: contracts.filter((k) => k.status === 'failed').length,
    failures: contracts
      .filter((k) => k.status === 'failed')
      .reduce<Record<string, number>>((acc, k) => ({ ...acc, [`${k.kind}: ${k.note}`]: (acc[`${k.kind}: ${k.note}`] ?? 0) + 1 }), {}),
    nightlyOverhead: -recent.reduce((s, r) => s + r.overnightItems.reduce((t, i) => t + i.amount, 0), 0) / Math.max(1, recent.length),
    days: reports.map((r) => ({
      day: r.day,
      endingCash: r.endingCash,
      revenue: r.revenue,
      overnight: r.overnightItems.reduce((t, i) => t + i.amount, 0),
      operating: r.operatingExpenses,
      stainedBf: r.production.stainedBf,
      ...(stock.get(r.day) ?? { rawBf: 0, finishedBf: 0, backlogBf: 0 }),
    })),
  }
  db.close()
  return result
}

// --- Reporting -----------------------------------------------------------------------------------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
const pad = (s: string | number, n: number) => String(s).padStart(n)

function parseArgs(argv: string[]) {
  const args = { seeds: 5, only: '', trace: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seeds') args.seeds = Number(argv[++i])
    else if (argv[i] === '--only') args.only = argv[++i]
    else if (argv[i] === '--trace') args.trace = argv[++i]
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const scenarios = SCENARIOS.filter((s) => s.name.includes(args.only || args.trace))
  let failures = 0
  console.log(`AStain balancing run: ${scenarios.length} scenarios x ${args.seeds} seeds\n`)

  for (const scenario of scenarios) {
    const started = performance.now()
    const runs = Array.from({ length: args.seeds }, (_, i) => runScenario(scenario, 1000 + i))
    const seconds = ((performance.now() - started) / 1000).toFixed(1)
    const bankrupt = runs.filter((r) => r.bankruptDay !== null)
    const start = CAPITALIZATIONS[scenario.capitalization]

    console.log(`== ${scenario.name} (${scenario.capitalization}, ${scenario.days} days, ${seconds}s)`)
    console.log(`   ${scenario.description}`)
    console.log(
      `   bankrupt ${bankrupt.length}/${runs.length}` +
        (bankrupt.length ? ` (day ${Math.min(...bankrupt.map((r) => r.bankruptDay!))}-${Math.max(...bankrupt.map((r) => r.bankruptDay!))})` : '') +
        ` | start ${usd(start.cash)} | median end cash ${usd(median(runs.map((r) => r.endCash)))}` +
        ` | median equity ${usd(median(runs.map((r) => r.equity)))} | worst low ${usd(Math.min(...runs.map((r) => r.minCash)))}`,
    )
    console.log(
      `   contracts ${sum(runs.map((r) => r.completed))} done / ${sum(runs.map((r) => r.failed))} failed` +
        ` | median revenue/day ${usd(median(runs.map((r) => r.revenue / r.daysPlayed)))}` +
        ` | overhead/night ${usd(median(runs.map((r) => r.nightlyOverhead)))}`,
    )
    const reasons: Record<string, number> = {}
    for (const r of runs) for (const [why, n] of Object.entries(r.failures)) reasons[why] = (reasons[why] ?? 0) + n
    if (Object.keys(reasons).length > 0) {
      console.log(`   failed contracts: ${Object.entries(reasons).map(([why, n]) => `${n}x ${why}`).join('; ')}`)
    }
    for (const e of scenario.expect) {
      const ok = e.check(runs)
      if (!ok) failures++
      console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${e.label}`)
    }
    console.log()

    if (args.trace) {
      const run = runs[0]
      console.log(`   Trace, seed ${run.seed}:`)
      const cols = ['day', 'revenue', 'operating', 'overnight', 'stained', 'raw', 'finished', 'backlog', 'cash']
      console.log('   ' + cols.map((c, i) => pad(c, i === 0 ? 4 : 10)).join(' '))
      for (const d of run.days) {
        const cells = [d.day, usd(d.revenue), usd(d.operating), usd(d.overnight), ...[d.stainedBf, d.rawBf, d.finishedBf, d.backlogBf].map(Math.round), usd(d.endingCash)]
        console.log('   ' + cells.map((c, i) => pad(c, i === 0 ? 4 : 10)).join(' '))
      }
      console.log()
    }
  }

  console.log(failures === 0 ? 'All expectations met.' : `${failures} expectation(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
