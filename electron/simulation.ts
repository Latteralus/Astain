import type { DbManager, EmployeeRow } from './database/dbManager'
import { chargeExpansionOvernight, crewStates, vehicleStates } from './fleet'
import { millStates, settleMarketDay } from './market'
import {
  availableStorage,
  BF_PER_SQFT,
  EQUIPMENT,
  floorSqFt,
  FORKLIFT_COVERAGE_SQFT,
  INSOLVENCY_GRACE_NIGHTS,
  loanPayment,
  PROPERTIES,
  hourlyOutput,
  statGainOnLevelUp,
  wastePercentage,
  xpRequired,
  SPECIES,
  type Species,
} from './rules'
import {
  DAY_END_MINUTE,
  type Employee,
  type EodReport,
  type GamePhase,
  type GameState,
  type MarketQuote,
  type SpaceSummary,
} from './types'

const EPSILON = 1e-6

export function spaceSummary(db: DbManager): SpaceSummary {
  let equipmentSqFt = 0
  let rackSqFt = 0
  let rackCapacityBf = 0
  for (const item of db.getEquipment()) {
    const spec = EQUIPMENT[item.type]
    if (spec.kind === 'rack') {
      rackSqFt += spec.footprintSqFt
      rackCapacityBf += spec.capacityBf
    } else {
      equipmentSqFt += spec.footprintSqFt
    }
  }

  let floorBf = 0
  let rackUsedBf = 0
  for (const item of db.getInventory()) {
    if (item.state === 'drying') rackUsedBf += item.boardFeet
    else floorBf += item.boardFeet
  }

  let totalSqFt = db.getCompany().yard_sq_ft
  let lotSqFt = 0
  for (const p of db.getProperties()) {
    const spec = PROPERTIES[p.type]
    if (spec.zone === 'production') totalSqFt += spec.sqFt
    else lotSqFt += spec.sqFt
  }
  const forklifts = db.getCrew().filter((c) => c.role === 'forklift_driver').length
  const lotUsableSqFt = Math.min(lotSqFt, forklifts * FORKLIFT_COVERAGE_SQFT)

  const availableSqFt = availableStorage(totalSqFt, equipmentSqFt, rackSqFt)
  const inventorySqFt = floorSqFt(floorBf)
  // Forklift crews stage stacks out on the lots first, keeping the production floor clear.
  const lotInventorySqFt = Math.min(inventorySqFt, lotUsableSqFt)
  const yardInventorySqFt = inventorySqFt - lotInventorySqFt
  const inboundBf =
    db.getInTransit().reduce((sum, d) => sum + d.boardFeet, 0) +
    db
      .getOpenTrips()
      .filter((t) => t.kind === 'mill_pickup')
      .reduce((sum, t) => sum + t.boardFeet, 0)
  return {
    totalSqFt,
    equipmentSqFt,
    rackSqFt,
    availableSqFt,
    lotSqFt,
    lotUsableSqFt,
    inventorySqFt,
    lotInventorySqFt,
    yardInventorySqFt,
    yardFreeSqFt: availableSqFt - yardInventorySqFt,
    freeSqFt: availableSqFt + lotUsableSqFt - inventorySqFt,
    rackCapacityBf,
    rackUsedBf,
    inboundSqFt: floorSqFt(inboundBf),
  }
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    xp: row.xp,
    speed: row.speed,
    quality: row.quality,
    dailyWage: row.daily_wage,
    severance: Math.round(row.daily_wage * row.severance_multiplier),
    hiredDay: row.hired_day,
    stationId: row.station_id,
    status: row.status,
  }
}

function marketQuotes(db: DbManager, day: number): MarketQuote[] {
  const today = db.getPrices(day)
  const yesterday = db.getPrices(day - 1)
  return (Object.keys(SPECIES) as Species[]).map((species) => ({
    species,
    price: today[species] ?? SPECIES[species].basePricePerBf,
    previousPrice: yesterday[species] ?? null,
  }))
}

export function snapshot(db: DbManager, phase: GamePhase): GameState {
  const c = db.getCompany()
  return {
    day: c.day,
    minute: c.minute,
    phase,
    companyName: c.name,
    cash: c.cash,
    loanBalance: c.loan_balance,
    loanRate: c.loan_rate,
    loanInstallment: c.loan_installment,
    insolventNights: c.insolvent_nights,
    bankrupt: c.bankrupt_day !== null,
    space: spaceSummary(db),
    inventory: db.getInventory(),
    equipment: db.getEquipment(),
    employees: db.getEmployees().map(toEmployee),
    candidates: db.getCandidates(),
    today: db.getProductionTotals(c.day),
    market: marketQuotes(db, c.day),
    headline: db.getNews(c.day)[0]?.headline ?? null,
    mills: millStates(db),
    deliveries: db.getDeliveries(c.day),
    contracts: db.getContracts(['offered', 'active', 'shipping']),
    properties: db.getProperties(),
    crew: crewStates(db),
    vehicles: vehicleStates(db),
    trips: db.getTrips(c.day),
  }
}

/** Applies XP and any level-ups; each level needs Base_XP × Level^1.5. */
function grantXp(db: DbManager, e: EmployeeRow, amount: number) {
  let { level, xp, speed, quality } = e
  xp += amount
  while (xp >= xpRequired(level)) {
    xp -= xpRequired(level)
    level++
    speed += statGainOnLevelUp(speed)
    quality += statGainOnLevelUp(quality)
  }
  db.updateProgress(e.id, { level, xp, speed, quality })
}

/**
 * The species the crew should stain first: whichever the earliest-due open contract is still short of (counting
 * finished and drying stock), then the rest by pile size. Without this a deep pine pile would starve a cedar order.
 */
function stainingOrder(db: DbManager, raw: Map<Species, number>): Species[] {
  const covered = new Map<Species, number>()
  for (const item of db.getInventory()) {
    if (item.state !== 'raw') covered.set(item.species, (covered.get(item.species) ?? 0) + item.boardFeet)
  }
  const urgent: Species[] = []
  for (const c of db.getContracts(['active'])) {
    // getContracts sorts by due day, so the first contract left uncovered for a species sets its place in line.
    const left = (covered.get(c.species) ?? 0) - c.boardFeet
    covered.set(c.species, left)
    if (left < 0 && !urgent.includes(c.species)) urgent.push(c.species)
  }
  const rest = [...raw.keys()].filter((s) => !urgent.includes(s)).sort((a, b) => raw.get(b)! - raw.get(a)!)
  return [...urgent, ...rest]
}

/**
 * One in-game minute of work. Each assigned worker stains raw lumber at
 * Hourly Output = Equip_Max × Speed/100; the Waste Percentage of it is ruined and the rest goes onto the
 * drying racks. Workers take the species an open order needs soonest, and stall when raw stock runs out or the
 * racks are full.
 */
export function runProductionMinute(db: DbManager): void {
  const { day } = db.getCompany()
  const stations = new Map(db.getEquipment().map((item) => [item.id, EQUIPMENT[item.type]]))
  const raw = new Map<Species, number>()
  let rackFreeBf = 0
  for (const item of db.getInventory()) {
    if (item.state === 'raw') raw.set(item.species, item.boardFeet)
  }
  for (const spec of stations.values()) if (spec.kind === 'rack') rackFreeBf += spec.capacityBf
  for (const item of db.getInventory()) if (item.state === 'drying') rackFreeBf -= item.boardFeet
  const order = stainingOrder(db, raw)

  for (const e of db.getEmployees()) {
    const spec = e.station_id === null ? undefined : stations.get(e.station_id)
    if (!spec || spec.kind !== 'station') {
      if (e.status !== 'unassigned') db.setStatus(e.id, 'unassigned')
      continue
    }
    const ratePerMinute = hourlyOutput(spec.maxBfPerHour, e.speed) / 60
    const waste = wastePercentage(e.level, spec.wasteFactor)

    const species = order.find((s) => (raw.get(s) ?? 0) > EPSILON)
    const stock = species ? raw.get(species)! : 0
    const rackLimit = waste >= 1 ? Infinity : Math.max(0, rackFreeBf) / (1 - waste)
    const processed = Math.min(ratePerMinute, stock, rackLimit)

    if (!species || processed < EPSILON) {
      const status = stock < EPSILON ? 'no_raw' : 'racks_full'
      if (e.status !== status) db.setStatus(e.id, status)
      continue
    }

    const stained = processed * (1 - waste)
    raw.set(species, stock - processed)
    rackFreeBf -= stained
    db.adjustInventory(species, 'raw', -processed)
    db.adjustInventory(species, 'drying', stained)
    db.logProduction(day, e.id, stained, processed - stained)
    grantXp(db, e, processed / ratePerMinute)
    if (e.status !== 'working') db.setStatus(e.id, 'working')
  }
}

/**
 * Closes the current day at 8:00 PM: pays wages and overnight costs (crew, fleet insurance, property and the loan
 * included), penalizes missed contract deadlines, counts nights in the red toward bankruptcy, dries racked wood into finished stock, expires stale job applicants and offers,
 * and records the daily report. Runs as one transaction so a crash can never leave a day half-closed. Safe to call
 * twice for the same day.
 */
export function closeDay(db: DbManager): EodReport {
  return db.transaction(() => {
    const company = db.getCompany()
    const existing = db.getReport(company.day)
    if (existing) return existing

    db.setClock(company.day, DAY_END_MINUTE)

    const employees = db.getEmployees()
    const payroll = employees.reduce((sum, e) => sum + e.daily_wage, 0)
    if (payroll > 0) db.postTransaction(-payroll, `Payroll (${employees.length} stainers)`, 'overnight')
    for (const cost of db.getFixedCosts()) {
      if (cost.daily_amount > 0) db.postTransaction(-cost.daily_amount, cost.label, 'overnight')
    }
    chargeExpansionOvernight(db)
    if (company.loan_balance > 0) {
      const { interest, principal } = loanPayment(company.loan_balance, company.loan_rate, company.loan_installment)
      if (interest > 0) db.postTransaction(-interest, 'Loan interest', 'overnight')
      if (principal > 0) db.postTransaction(-principal, 'Loan principal', 'overnight')
      db.setLoanBalance(company.loan_balance - principal)
    }
    settleMarketDay(db, company.day)

    // Dried wood moves off the racks onto the floor, as far as floor space allows.
    let floorRoomBf = Math.max(0, spaceSummary(db).freeSqFt * BF_PER_SQFT)
    let driedBf = 0
    let stuckOnRacksBf = 0
    for (const item of db.getInventory()) {
      if (item.state !== 'drying') continue
      const moved = Math.min(item.boardFeet, floorRoomBf)
      db.adjustInventory(item.species, 'drying', -moved)
      db.adjustInventory(item.species, 'finished', moved)
      floorRoomBf -= moved
      driedBf += moved
      stuckOnRacksBf += item.boardFeet - moved
    }

    db.expireCandidates(company.day + 1)
    db.setAllStatuses('off_shift')

    // The bank tolerates an overdraft for a few nights; after that it forecloses and the career is over.
    const endingCash = db.getCompany().cash
    const insolventNights = endingCash < 0 ? company.insolvent_nights + 1 : 0
    db.setSolvency(insolventNights, insolventNights >= INSOLVENCY_GRACE_NIGHTS ? company.day : null)

    const totals = db.getLedgerTotals(company.day)
    const production = db.getProductionTotals(company.day)
    db.saveReport({
      day: company.day,
      opening_cash: endingCash - totals.net,
      revenue: totals.revenue,
      operating_expenses: totals.operatingExpenses,
      capital_spending: totals.capital,
      overnight_costs: totals.overnight,
      ending_cash: endingCash,
      stained_bf: production.stainedBf,
      wasted_bf: production.wastedBf,
      dried_bf: driedBf,
      stuck_on_racks_bf: stuckOnRacksBf,
      insolvent_nights: insolventNights,
    })
    return db.getReport(company.day)!
  })
}
