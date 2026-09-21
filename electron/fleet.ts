// Phase 5: the company's own trucks, the crew that runs them and the storage lots, and what it all costs overnight.
import type { CrewRow, DbManager, VehicleRow } from './database/dbManager'
import {
  addWorkingMinutes,
  breakdownChancePerMinute,
  canDrive,
  CREW_ROLES,
  floorSqFt,
  isReached,
  LOAD_MINUTES,
  LOGISTICS_MANAGER_REPAIR_FACTOR,
  MILLS,
  PROPERTIES,
  PROPERTY_TAX_PER_DAY,
  REPUTATION_PER_BF,
  SPECIES,
  VEHICLES,
  type License,
  type Species,
} from './rules'
import { spaceSummary } from './simulation'
import type { CrewMember, Notice, Trip, TripKind, Vehicle, VehicleStatus } from './types'

type Random = () => number

const bf = (n: number) => `${Math.round(n).toLocaleString('en-US')} bf`
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const between = ([lo, hi]: readonly [number, number], random: Random) => lo + Math.floor(random() * (hi - lo + 1))

export function vehicleName(v: Pick<VehicleRow, 'id' | 'type'>): string {
  return `${VEHICLES[v.type].name} #${v.id}`
}

export function hasLogisticsManager(db: DbManager): boolean {
  return db.getCrew().some((c) => c.role === 'logistics_manager')
}

// --- Availability --------------------------------------------------------------------------------------

function vehicleStatus(v: VehicleRow, trip: Trip | undefined, day: number, minute: number): VehicleStatus {
  if (trip) {
    const repairing = trip.repairUntilDay !== null && !isReached(trip.repairUntilDay, trip.repairUntilMinute!, day, minute)
    return repairing ? 'broken_down' : 'on_trip'
  }
  if (v.shop_until_day !== null && !isReached(v.shop_until_day, v.shop_until_minute!, day, minute)) return 'in_shop'
  return 'idle'
}

export function vehicleStates(db: DbManager): Vehicle[] {
  const { day, minute } = db.getCompany()
  const trips = db.getOpenTrips()
  return db.getVehicles().map((v) => {
    const trip = trips.find((t) => t.vehicleId === v.id)
    return {
      id: v.id,
      type: v.type,
      condition: v.condition,
      purchasePrice: v.purchase_price,
      purchasedDay: v.purchased_day,
      status: vehicleStatus(v, trip, day, minute),
      tripId: trip?.id ?? null,
      shopUntilDay: v.shop_until_day,
      shopUntilMinute: v.shop_until_minute,
      breakdowns: v.breakdowns,
    }
  })
}

export function crewStates(db: DbManager): CrewMember[] {
  const trips = db.getOpenTrips()
  return db.getCrew().map((c) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    dailyWage: c.daily_wage,
    severance: Math.round(c.daily_wage * c.severance_multiplier),
    hiredDay: c.hired_day,
    tripId: trips.find((t) => t.driverId === c.id)?.id ?? null,
  }))
}

/**
 * The cheapest free driver licensed for `required`: a standard driver before a CDL driver, so the CDL holders stay
 * free for the heavy trucks.
 */
export function availableDriver(db: DbManager, required: License): CrewRow | undefined {
  const busy = new Set(db.getOpenTrips().map((t) => t.driverId))
  return db
    .getCrew()
    .filter((c) => !busy.has(c.id) && canDrive(CREW_ROLES[c.role].license, required))
    .sort((a, b) => a.daily_wage - b.daily_wage)[0]
}

// --- Dispatch ------------------------------------------------------------------------------------------

export interface Dispatch {
  kind: TripKind
  vehicle: VehicleRow
  driver: CrewRow
  species: Species
  boardFeet: number
  mill: Trip['mill']
  contractId: number | null
  goodsCost: number
  fuelCost: number
  driveMinutes: number
}

/** Sends a truck out. The outbound leg covers loading and the drive to the far end. */
export function dispatchTrip(db: DbManager, d: Dispatch): void {
  const { day, minute } = db.getCompany()
  const legEnds = addWorkingMinutes(day, minute, LOAD_MINUTES + d.driveMinutes)
  db.postTransaction(-d.fuelCost, `Fuel: ${vehicleName(d.vehicle)}`)
  db.addTrip({
    kind: d.kind,
    vehicle_id: d.vehicle.id,
    driver_id: d.driver.id,
    species: d.species,
    board_feet: d.boardFeet,
    mill: d.mill,
    contract_id: d.contractId,
    goods_cost: d.goodsCost,
    fuel_cost: d.fuelCost,
    drive_minutes: d.driveMinutes,
    departed_day: day,
    departed_minute: minute,
    leg_ends_day: legEnds.day,
    leg_ends_minute: legEnds.minute,
  })
}

// --- Trip state machine --------------------------------------------------------------------------------

/** Unloads a mill haul at the gate if the floor can take it. Returns false if it has to wait. */
function unloadHaul(db: DbManager, trip: Trip, day: number, minute: number): boolean {
  if (floorSqFt(trip.boardFeet) > spaceSummary(db).freeSqFt + 1e-6) return false
  db.adjustInventory(trip.species, 'raw', trip.boardFeet)
  if (trip.mill) {
    const mill = db.getMill(trip.mill)!
    db.updateMill({
      ...mill,
      reputation: mill.reputation + trip.boardFeet * REPUTATION_PER_BF,
      delivered_bf: mill.delivered_bf + trip.boardFeet,
      last_delivery_day: day,
    })
  }
  db.completeTrip(trip.id, day, minute)
  return true
}

/** The customer takes the order off the truck and pays: payout plus freight, less the penalty if it's late. */
function dropOff(db: DbManager, trip: Trip, day: number): string {
  const contract = trip.contractId !== null ? db.getContract(trip.contractId) : undefined
  if (!contract || contract.status !== 'shipping') return ''
  const late = contract.dueDay !== null && day > contract.dueDay
  const amount = contract.payout + contract.freight - (late ? contract.penalty : 0)
  const name = SPECIES[contract.species].name.toLowerCase()
  db.postTransaction(amount, `Contract: ${contract.customer} (${bf(contract.boardFeet)} ${name}, delivered${late ? ' late' : ''})`)
  db.resolveContract(contract.id, 'completed', day, late ? `Delivered late; ${money.format(contract.penalty)} deducted` : null)
  return late
    ? `${contract.customer} took the late order and docked ${money.format(contract.penalty)}. Paid ${money.format(amount)}.`
    : `${contract.customer} received their order. Paid ${money.format(amount)} including ${money.format(contract.freight)} freight.`
}

/**
 * Moves every truck on the road through one working minute: wear and the chance of a breakdown while driving,
 * then any leg that has come to its end. Out at the far end a delivery is paid for and a mill haul is loaded;
 * back at the yard a haul unloads, or waits at the gate for floor space. Service stays also end here.
 */
export function processTrips(db: DbManager, random: Random = Math.random): Notice[] {
  const { day, minute } = db.getCompany()
  const notices: Notice[] = []
  const manager = hasLogisticsManager(db)

  for (const v of db.getVehicles()) {
    if (v.shop_until_day !== null && isReached(v.shop_until_day, v.shop_until_minute!, day, minute)) {
      db.setVehicleShop(v.id, null)
      notices.push({ tone: 'info', text: `${vehicleName(v)} is back from service.` })
    }
  }

  for (const trip of db.getOpenTrips()) {
    const vehicle = db.getVehicle(trip.vehicleId)!
    const spec = VEHICLES[vehicle.type]
    const name = vehicleName(vehicle)

    if (trip.status === 'waiting') {
      if (unloadHaul(db, trip, day, minute)) {
        notices.push({ tone: 'info', text: `${name} finally unloaded ${bf(trip.boardFeet)} of ${SPECIES[trip.species].name.toLowerCase()}.` })
      }
      continue
    }

    const repairing = trip.repairUntilDay !== null && !isReached(trip.repairUntilDay, trip.repairUntilMinute!, day, minute)
    if (!repairing) {
      const condition = vehicle.condition - spec.wearPerHour / 60
      db.setVehicleCondition(vehicle.id, condition)
      if (random() < breakdownChancePerMinute(spec, condition, manager)) {
        const repairMinutes = Math.round(between(spec.repairMinutes, random) * (manager ? LOGISTICS_MANAGER_REPAIR_FACTOR : 1))
        const cost = between(spec.repairCost, random)
        db.breakDownTrip(
          trip.id,
          addWorkingMinutes(day, minute, repairMinutes),
          addWorkingMinutes(trip.legEndsDay, trip.legEndsMinute, repairMinutes),
        )
        db.countVehicleBreakdown(vehicle.id)
        db.postTransaction(-cost, `Roadside repair: ${name}`)
        const hours = Math.floor(repairMinutes / 60)
        const delay = hours > 0 ? `${hours}h ${repairMinutes % 60}m` : `${repairMinutes}m`
        notices.push({
          tone: 'warning',
          text: `${name} broke down on the road. Repair bill ${money.format(cost)}, ${delay} delay.`,
        })
        continue
      }
    }

    if (!isReached(trip.legEndsDay, trip.legEndsMinute, day, minute)) continue

    if (trip.status === 'outbound') {
      if (trip.kind === 'contract_delivery') {
        const text = dropOff(db, trip, day)
        if (text) notices.push({ tone: 'info', text })
      }
      db.setTripLeg(trip.id, 'returning', addWorkingMinutes(day, minute, trip.driveMinutes))
      continue
    }

    // Back at the yard.
    if (trip.kind === 'mill_pickup') {
      const species = SPECIES[trip.species].name.toLowerCase()
      if (unloadHaul(db, trip, day, minute)) {
        notices.push({ tone: 'info', text: `${name} is back from ${MILLS[trip.mill!].name} with ${bf(trip.boardFeet)} of ${species}.` })
      } else {
        db.setTripLeg(trip.id, 'waiting', { day, minute })
        notices.push({
          tone: 'warning',
          text: `${name} is waiting at the gate: no floor space for ${bf(trip.boardFeet)} of ${species}. Truck and driver are stuck until you make room.`,
        })
      }
    } else {
      db.completeTrip(trip.id, day, minute)
    }
  }
  return notices
}

// --- Overnight -----------------------------------------------------------------------------------------

/** Crew wages, fleet insurance, lease rent and property tax, charged at 8:00 PM inside closeDay's transaction. */
export function chargeExpansionOvernight(db: DbManager): void {
  const crew = db.getCrew()
  const crewPayroll = crew.reduce((sum, c) => sum + c.daily_wage, 0)
  if (crewPayroll > 0) db.postTransaction(-crewPayroll, `Crew payroll (${crew.length} crew)`, 'overnight')

  const vehicles = db.getVehicles()
  const insurance = vehicles.reduce((sum, v) => sum + VEHICLES[v.type].insurancePerDay, 0)
  if (insurance > 0) {
    db.postTransaction(-insurance, `Fleet insurance (${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'})`, 'overnight')
  }

  const properties = db.getProperties()
  const leases = properties.filter((p) => p.tenure === 'lease')
  const rent = leases.reduce((sum, p) => sum + PROPERTIES[p.type].leasePerDay, 0)
  if (rent > 0) db.postTransaction(-rent, `Lease rent (${leases.length} propert${leases.length === 1 ? 'y' : 'ies'})`, 'overnight')
  const tax = properties.filter((p) => p.tenure === 'own').reduce((sum, p) => sum + p.pricePaid * PROPERTY_TAX_PER_DAY, 0)
  if (tax > 0) db.postTransaction(-Math.round(tax * 100) / 100, 'Property tax', 'overnight')
}
