// A scripted player for balancing runs. It plays the way a careful human would: takes work it can finish in time,
// buys the lumber for it from the cheapest mill, keeps every station staffed, and delivers as soon as an order is ready.
import * as actions from '../../electron/actions'
import type { DbManager } from '../../electron/database/dbManager'
import type { GameEngine } from '../../electron/engine'
import { millStates } from '../../electron/market'
import { spaceSummary } from '../../electron/simulation'
import {
  BF_PER_SQFT,
  floorSqFt,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  EQUIPMENT,
  hourlyOutput,
  LUMBER_BUNDLE_BF,
  MAX_ORDER_BUNDLES,
  MILLS,
  SPECIES,
  VEHICLES,
  wastePercentage,
  type JobPostingTier,
  type Species,
} from '../../electron/rules'
import type { ActionResult } from '../../electron/types'

export interface BotContext {
  db: DbManager
  engine: GameEngine
  /** Runs a player command and returns whether it went through. */
  act: (command: (db: DbManager) => ActionResult) => boolean
}

/** Hires the best `count` applicants from a posting (or as many as it produced). */
export function recruit(ctx: BotContext, tier: JobPostingTier, count: number): number {
  let hired = 0
  while (hired < count) {
    if (ctx.db.getCandidates().length === 0 && !ctx.act((db) => actions.postJob(db, tier))) break
    const best = ctx.db.getCandidates().sort((a, b) => b.speed + b.quality - (a.speed + a.quality))[0]
    if (!best || !ctx.act((db) => actions.hireCandidate(db, best.id))) break
    hired++
  }
  return hired
}

/** Puts the fastest workers on the biggest stations. Anyone left over waits unassigned (and still gets paid). */
export function staffStations(ctx: BotContext): void {
  const stations = ctx.db
    .getEquipment()
    .filter((e) => EQUIPMENT[e.type].kind === 'station')
    .sort((a, b) => {
      const sa = EQUIPMENT[a.type]
      const sb = EQUIPMENT[b.type]
      return (sb.kind === 'station' ? sb.maxBfPerHour : 0) - (sa.kind === 'station' ? sa.maxBfPerHour : 0)
    })
  const workers = ctx.db.getEmployees().sort((a, b) => b.speed - a.speed)
  stations.forEach((station, i) => {
    const worker = workers[i]
    if (worker && worker.station_id !== station.id) ctx.act((db) => actions.assignStation(db, worker.id, station.id))
  })
}

/** Finished board feet a day the yard can turn out: station output after waste, capped by what the racks can dry. */
export function dailyCapacity(db: DbManager): { finishedBf: number; waste: number } {
  const equipment = new Map(db.getEquipment().map((e) => [e.id, EQUIPMENT[e.type]]))
  let processed = 0
  let finished = 0
  let rackBf = 0
  for (const spec of equipment.values()) if (spec.kind === 'rack') rackBf += spec.capacityBf
  for (const e of db.getEmployees()) {
    const spec = e.station_id === null ? undefined : equipment.get(e.station_id)
    if (!spec || spec.kind !== 'station') continue
    const perDay = hourlyOutput(spec.maxBfPerHour, e.speed) * ((DAY_END_MINUTE - DAY_START_MINUTE) / 60)
    processed += perDay
    finished += perDay * (1 - wastePercentage(spec.baseError, e.quality))
  }
  return { finishedBf: Math.min(finished, rackBf), waste: processed > 0 ? 1 - finished / processed : 0.3 }
}

export interface OperatorOptions {
  /** Cash kept back from lumber purchases to cover a few nights of overhead. */
  reserve: number
  /** Deliver in the company's own trucks when one is free (earns freight); otherwise hand over at the gate. */
  useFleet: boolean
  /** Haul lumber from the mill in the company's own trucks when one is free. */
  haulOwnLumber: boolean
}

const DEFAULT_OPERATOR: OperatorOptions = { reserve: 3000, useFleet: false, haulOwnLumber: false }

/** Raw lumber kept on hand or on order, in days of processing. More ties up cash and floor for nothing. */
const RAW_DAYS_AHEAD = 2
/** The most work booked ahead, in days of capacity; beyond it a hiccup (a late truck, a cash crunch) costs a deadline. */
const MAX_QUEUE_DAYS = 6

/** Board feet already committed per species, and what's on hand or on the way to cover it (as finished-equivalent). */
function position(db: DbManager, species: Species, waste: number) {
  const raw = db.getStock(species, 'raw')
  const active = db.getContracts(['active']).filter((c) => c.species === species)
  const needed = active.reduce((sum, c) => sum + c.boardFeet, 0)
  const inbound =
    db
      .getInTransit()
      .filter((d) => d.species === species)
      .reduce((sum, d) => sum + d.boardFeet, 0) +
    db
      .getOpenTrips()
      .filter((t) => t.kind === 'mill_pickup' && t.species === species)
      .reduce((sum, t) => sum + t.boardFeet, 0)
  const have = db.getStock(species, 'finished') + db.getStock(species, 'drying') + (raw + inbound) * (1 - waste)
  return { needed, have, rawPipeline: raw + inbound }
}

function idleVehicle(db: DbManager, maxBf: number, minBf = 0) {
  const busy = new Set(db.getOpenTrips().map((t) => t.vehicleId))
  const { day, minute } = db.getCompany()
  return db
    .getVehicles()
    .filter((v) => !busy.has(v.id))
    .filter((v) => v.shop_until_day === null || v.shop_until_day < day || (v.shop_until_day === day && v.shop_until_minute! <= minute))
    .map((v) => ({ v, capacity: VEHICLES[v.type].capacityBundles * LUMBER_BUNDLE_BF }))
    .filter(({ capacity }) => capacity >= minBf && capacity <= Math.max(maxBf, minBf))
    .sort((a, b) => a.capacity - b.capacity)[0]?.v
}

/** One decision pass. Called every few in-game minutes while the yard is open. */
export function operate(ctx: BotContext, takeWork: boolean, options: Partial<OperatorOptions> = {}): void {
  const opts = { ...DEFAULT_OPERATOR, ...options }
  const { db } = ctx
  staffStations(ctx)
  const { finishedBf: capacity, waste } = dailyCapacity(db)
  const rawPerDay = capacity / (1 - waste)

  // 1. Deliver anything that's ready, earliest deadline first.
  for (const c of db.getContracts(['active']).sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0))) {
    if (db.getStock(c.species, 'finished') + 1e-6 < c.boardFeet) continue
    if (c.kind === 'toll' && !c.materialReceived) continue
    const truck = opts.useFleet ? idleVehicle(db, Infinity, c.boardFeet) : undefined
    if (truck && ctx.act((d) => actions.shipContract(d, c.id, truck.id))) continue
    ctx.act((d) => actions.deliverContract(d, c.id))
  }

  // 2. Take offers the yard can finish before their deadline, given what's already booked.
  if (takeWork && capacity > 0) {
    const { day } = db.getCompany()
    for (const offer of db.getContracts(['offered']).sort((a, b) => b.payout / b.boardFeet - a.payout / a.boardFeet)) {
      const backlog = db
        .getContracts(['active'])
        .reduce((sum, c) => sum + c.boardFeet, 0) -
        db.getInventory().filter((i) => i.state !== 'raw').reduce((sum, i) => sum + i.boardFeet, 0)
      // Everything spends a night on the racks, and a careful operator keeps a spare day for surprises.
      const daysNeeded = Math.ceil((Math.max(0, backlog) + offer.boardFeet) / capacity) + 1
      if (daysNeeded > Math.min(offer.leadDays - 1, MAX_QUEUE_DAYS)) continue
      // A toll customer's lumber arrives within the hour or two; a load with no floor to land on fails the contract.
      const space = spaceSummary(db)
      if (offer.kind === 'toll' && floorSqFt(offer.boardFeet) > space.freeSqFt - space.inboundSqFt - 50) continue
      if (offer.kind === 'purchase') {
        const lumber = (offer.boardFeet / (1 - waste)) * SPECIES[offer.species].basePricePerBf * 1.1
        if (db.getCompany().cash < lumber + opts.reserve) continue
      }
      if (offer.offeredDay > day) continue
      ctx.act((d) => actions.acceptContract(d, offer.id))
    }
  }

  // 3. Buy the raw lumber the booked work still needs, cheapest landed cost first.
  for (const species of Object.keys(SPECIES) as Species[]) {
    const { needed, have, rawPipeline } = position(db, species, waste)
    const shortRaw = Math.min(Math.max(0, needed - have) / (1 - waste), RAW_DAYS_AHEAD * rawPerDay - rawPipeline)
    const space = spaceSummary(db)
    const floorRoomBf = (space.freeSqFt - space.inboundSqFt) * BF_PER_SQFT
    let shortBundles = Math.floor(Math.min(Math.ceil(shortRaw / LUMBER_BUNDLE_BF) * LUMBER_BUNDLE_BF, floorRoomBf) / LUMBER_BUNDLE_BF)
    const mills = millStates(db)
      .filter((m) => MILLS[m.id].species.includes(species))
      .sort(
        (a, b) =>
          a.prices[species]! * LUMBER_BUNDLE_BF * 6 + MILLS[a.id].deliveryFee -
          (b.prices[species]! * LUMBER_BUNDLE_BF * 6 + MILLS[b.id].deliveryFee),
      )
    const mill = mills[0]
    while (shortBundles > 0 && mill) {
      const perBundle = mill.prices[species]! * LUMBER_BUNDLE_BF
      const affordable = Math.floor((db.getCompany().cash - opts.reserve - MILLS[mill.id].deliveryFee) / perBundle)
      const bundles = Math.min(shortBundles, MAX_ORDER_BUNDLES, affordable)
      if (bundles < 1) break
      // Our own truck only when it can carry the whole order; splitting it into small hauls starves the yard.
      const truck = opts.haulOwnLumber ? idleVehicle(db, Infinity, bundles * LUMBER_BUNDLE_BF) : undefined
      const ok = ctx.act((d) => actions.orderLumber(d, mill.id, species, bundles, truck?.id ?? null))
      if (!ok && truck) {
        // No driver free, most likely: fall back to the mill's own truck.
        if (!ctx.act((d) => actions.orderLumber(d, mill.id, species, bundles, null))) break
      } else if (!ok) break
      shortBundles -= bundles
    }
  }
}
