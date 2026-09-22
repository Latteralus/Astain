// Renderer-side helpers that derive display values from the game state using the shared rules.
import { formatClock } from '@/lib/utils'
import {
  addWorkingMinutes,
  canDrive,
  CREW_ROLES,
  EQUIPMENT,
  hourlyOutput,
  LOAD_MINUTES,
  LUMBER_BUNDLE_BF,
  MAX_ORDER_BUNDLES,
  MILLS,
  VEHICLES,
  wastePercentage,
  workingMinutesBetween,
  type License,
  type MillId,
  type Species,
  type StationSpec,
} from '../../electron/rules'
import type {
  Delivery,
  Employee,
  EmployeeStatus,
  EquipmentItem,
  GameState,
  InventoryState,
  Trip,
  Vehicle,
  VehicleStatus,
} from '../../electron/types'

export function equipmentLabel(item: EquipmentItem) {
  return `${EQUIPMENT[item.type].name} #${item.id}`
}

export function stationSpec(item: EquipmentItem | undefined): StationSpec | undefined {
  const spec = item && EQUIPMENT[item.type]
  return spec?.kind === 'station' ? spec : undefined
}

export function stations(game: GameState) {
  return game.equipment.filter((item) => EQUIPMENT[item.type].kind === 'station')
}

/** A worker's rate and waste on their current station, or undefined if they aren't on one. */
export function workerOutput(game: GameState, employee: Employee) {
  const spec = stationSpec(game.equipment.find((item) => item.id === employee.stationId))
  if (!spec) return undefined
  return {
    bfPerHour: hourlyOutput(spec.maxBfPerHour, employee.speed),
    waste: wastePercentage(employee.level, spec.wasteFactor),
  }
}

export function stock(game: GameState, state: InventoryState, species?: Species) {
  return game.inventory
    .filter((i) => i.state === state && (!species || i.species === species))
    .reduce((sum, i) => sum + i.boardFeet, 0)
}

/** Floor that will still be free once every truck on the road has unloaded. */
export function projectedFreeSqFt(game: GameState) {
  return game.space.freeSqFt - game.space.inboundSqFt
}

/** The cheapest way to buy a species today, delivery fee spread over a full truckload. */
export function cheapestMill(game: GameState, species: Species) {
  let best: { mill: MillId; pricePerBf: number } | undefined
  for (const m of game.mills) {
    const price = m.prices[species]
    if (price === undefined) continue
    const landed = price + MILLS[m.id].deliveryFee / (MAX_ORDER_BUNDLES * LUMBER_BUNDLE_BF)
    if (!best || landed < best.pricePerBf) best = { mill: m.id, pricePerBf: landed }
  }
  return best
}

/** "Due today", "Due tomorrow", "Due in 3 days", or "Overdue". */
export function dueLabel(today: number, dueDay: number) {
  const days = dueDay - today
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/** A moment relative to now, e.g. "in 2h 15m" or "tomorrow 9:40 AM". */
export function whenLabel(game: GameState, day: number, minute: number) {
  if (day > game.day) return `${day === game.day + 1 ? 'tomorrow' : `day ${day}`} ${formatClock(minute)}`
  const left = Math.max(0, minute - game.minute)
  return left === 0 ? 'now' : `in ${Math.floor(left / 60)}h ${left % 60}m`
}

/** A truck's ETA relative to now. */
export function etaLabel(game: GameState, delivery: Delivery) {
  const label = whenLabel(game, delivery.etaDay, delivery.etaMinute)
  return label === 'now' ? 'arriving' : label
}

/** How far along a truck is, 0–100, measured in working time. */
export function transitProgress(game: GameState, d: Delivery) {
  const total = workingMinutesBetween(d.orderedDay, d.orderedMinute, d.etaDay, d.etaMinute)
  const done = workingMinutesBetween(d.orderedDay, d.orderedMinute, game.day, game.minute)
  return total > 0 ? Math.min(100, (done / total) * 100) : 100
}

/**
 * How much of each open order is covered, earliest deadline first: finished stock, then wood still on the racks.
 * Orders for the same species share one pile, so a later order only gets what the earlier ones leave. A toll order
 * whose lumber hasn't arrived yet claims nothing.
 */
export function contractCoverage(game: GameState): Map<number, { finishedBf: number; dryingBf: number }> {
  const finished = new Map<Species, number>()
  const drying = new Map<Species, number>()
  for (const i of game.inventory) {
    if (i.state === 'finished') finished.set(i.species, i.boardFeet)
    if (i.state === 'drying') drying.set(i.species, i.boardFeet)
  }
  const coverage = new Map<number, { finishedBf: number; dryingBf: number }>()
  const open = game.contracts
    .filter((c) => c.status === 'active' && (c.kind === 'purchase' || c.materialReceived))
    .sort((a, b) => (a.dueDay ?? 0) - (b.dueDay ?? 0) || a.id - b.id)
  for (const c of open) {
    const f = Math.min(c.boardFeet, finished.get(c.species) ?? 0)
    const d = Math.min(c.boardFeet - f, drying.get(c.species) ?? 0)
    finished.set(c.species, (finished.get(c.species) ?? 0) - f)
    drying.set(c.species, (drying.get(c.species) ?? 0) - d)
    coverage.set(c.id, { finishedBf: f, dryingBf: d })
  }
  return coverage
}

/** How far an outbound delivery trip is toward the customer, 0–100. */
export function outboundProgress(game: GameState, t: Trip) {
  if (t.status !== 'outbound') return 100
  const total = workingMinutesBetween(t.departedDay, t.departedMinute, t.legEndsDay, t.legEndsMinute)
  const done = workingMinutesBetween(t.departedDay, t.departedMinute, game.day, game.minute)
  return total > 0 ? Math.min(100, (done / total) * 100) : 100
}

export function deliverySource(game: GameState, d: Delivery) {
  if (d.mill) return MILLS[d.mill].name
  return game.contracts.find((c) => c.id === d.contractId)?.customer ?? 'Customer drop-off'
}

export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  working: 'Working',
  no_raw: 'Idle: no raw lumber',
  racks_full: 'Idle: racks full',
  unassigned: 'Unassigned',
  off_shift: 'Off shift',
}

export const STATUS_VARIANTS: Record<EmployeeStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  working: 'default',
  no_raw: 'destructive',
  racks_full: 'destructive',
  unassigned: 'outline',
  off_shift: 'secondary',
}

// --- Fleet ---------------------------------------------------------------------------------------------

export function vehicleLabel(v: Pick<Vehicle, 'id' | 'type'>) {
  return `${VEHICLES[v.type].name} #${v.id}`
}

export function vehicleCapacityBf(v: Pick<Vehicle, 'type'>) {
  return VEHICLES[v.type].capacityBundles * LUMBER_BUNDLE_BF
}

/** Whether a driver licensed for `license` is free right now. */
export function driverFree(game: GameState, license: License) {
  return game.crew.some((c) => c.tripId === null && canDrive(CREW_ROLES[c.role].license, license))
}

/** Vehicles parked at the yard with a driver free to take them. */
export function readyVehicles(game: GameState) {
  return game.vehicles.filter((v) => v.status === 'idle' && driverFree(game, VEHICLES[v.type].license))
}

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  idle: { label: 'In the yard', variant: 'outline' },
  on_trip: { label: 'On a run', variant: 'default' },
  broken_down: { label: 'Broken down', variant: 'destructive' },
  in_shop: { label: 'In the shop', variant: 'secondary' },
}

/** When a truck leaving now would reach the far end, and when it would be back. */
export function tripPlan(game: GameState, driveMinutes: number) {
  const arrive = addWorkingMinutes(game.day, game.minute, LOAD_MINUTES + driveMinutes)
  return { arrive, back: addWorkingMinutes(arrive.day, arrive.minute, driveMinutes) }
}

/** When a trip is back at the yard, given where it is now. */
export function tripBackAt(t: Trip) {
  return t.status === 'outbound'
    ? addWorkingMinutes(t.legEndsDay, t.legEndsMinute, t.driveMinutes)
    : { day: t.legEndsDay, minute: t.legEndsMinute }
}

export function tripRepairing(game: GameState, t: Trip) {
  if (t.repairUntilDay === null || t.repairUntilMinute === null) return false
  return t.repairUntilDay > game.day || (t.repairUntilDay === game.day && t.repairUntilMinute > game.minute)
}

/** How far through the whole round trip, 0–100, in working time. */
export function tripProgress(game: GameState, t: Trip) {
  if (t.status === 'completed' || t.status === 'waiting') return 100
  const back = tripBackAt(t)
  const total = workingMinutesBetween(t.departedDay, t.departedMinute, back.day, back.minute)
  const done = workingMinutesBetween(t.departedDay, t.departedMinute, game.day, game.minute)
  return total > 0 ? Math.min(100, (done / total) * 100) : 100
}

export function tripDestination(game: GameState, t: Trip) {
  if (t.mill) return MILLS[t.mill].name
  return game.contracts.find((c) => c.id === t.contractId)?.customer ?? 'Customer'
}
