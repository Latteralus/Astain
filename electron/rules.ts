// Game constants, catalogs and the core formulas from Technical.md.
// Pure and dependency-free so the renderer can import it to preview outcomes before the player commits.

// --- Space ---------------------------------------------------------------------------------------------

/** Board feet of stacked lumber (raw or finished) that fit on one square foot of floor, aisles included. */
export const BF_PER_SQFT = 10

/** Available Storage = Total SqFt − Σ Equipment Footprint − Σ Active Drying Racks */
export function availableStorage(totalSqFt: number, equipmentSqFt: number, rackSqFt: number): number {
  return totalSqFt - equipmentSqFt - rackSqFt
}

export function floorSqFt(boardFeet: number): number {
  return boardFeet / BF_PER_SQFT
}

// --- Production ----------------------------------------------------------------------------------------

/** Hourly Output = Equip_Max × (Worker_Speed / 100), in board feet per hour. */
export function hourlyOutput(equipMaxBfPerHour: number, workerSpeed: number): number {
  return equipMaxBfPerHour * (workerSpeed / 100)
}

/** Waste for a level 1 worker, the most anyone ever ruins. No real finisher keeps their job wasting more. */
export const MAX_WASTE = 0.1
/** Waste at the mastery level, and the floor beyond it (before the machine's factor). */
export const MASTERY_WASTE = 0.05
export const MASTERY_LEVEL = 50

/**
 * Waste Percentage, as a 0–1 fraction. Experience sets it: 10% at level 1 falling in a straight line to 5% at
 * level 50 (and staying there). The station then scales it down: a spray booth lays an even coat, a brush doesn't.
 */
export function wastePercentage(workerLevel: number, machineWasteFactor: number): number {
  const progress = Math.min(1, Math.max(0, (workerLevel - 1) / (MASTERY_LEVEL - 1)))
  return (MAX_WASTE - (MAX_WASTE - MASTERY_WASTE) * progress) * machineWasteFactor
}

// --- Worker progression --------------------------------------------------------------------------------

/**
 * XP is earned at 1 per in-game minute of productive work (720 in a full day). At 60, a full-time worker reaches
 * level 10 in ~9 working days, level 25 in ~100 and level 50 in ~575.
 */
export const BASE_XP = 60

/** XP_req = Base_XP × Level^1.5 — the XP needed to advance from `level` to `level + 1`. */
export function xpRequired(level: number): number {
  return Math.round(BASE_XP * level ** 1.5)
}

/** Each level closes 5% of the gap to 100, so gains shrink as a worker approaches mastery. */
export function statGainOnLevelUp(stat: number): number {
  return stat >= 100 ? 0 : Math.max(1, Math.round((100 - stat) * 0.05))
}

// --- Labor market --------------------------------------------------------------------------------------

export function dailyWage(speed: number, quality: number): number {
  return Math.round(110 + (speed + quality) * 0.9)
}

/** Firing costs 10–14× the daily wage; the multiplier is rolled at hire so the UI can quote it exactly. */
export const SEVERANCE_MULTIPLIER_RANGE = [10, 14] as const

/** Candidates from a posting stay available for this many days. */
export const CANDIDATE_SHELF_DAYS = 3

export type JobPostingTier = 'classifieds' | 'trade_board' | 'staffing_agency'

export interface JobPostingSpec {
  name: string
  cost: number
  candidates: number
  statRange: readonly [number, number]
  description: string
}

export const JOB_POSTINGS: Record<JobPostingTier, JobPostingSpec> = {
  classifieds: {
    name: 'Local classifieds',
    cost: 150,
    candidates: 3,
    statRange: [25, 60],
    description: 'Cheap and quick. Mostly green applicants.',
  },
  trade_board: {
    name: 'Trade job board',
    cost: 600,
    candidates: 3,
    statRange: [40, 75],
    description: 'Reaches people with some finishing experience.',
  },
  staffing_agency: {
    name: 'Staffing agency',
    cost: 2000,
    candidates: 2,
    statRange: [60, 90],
    description: 'Pre-screened, experienced finishers.',
  },
}

// --- Equipment -----------------------------------------------------------------------------------------

export type EquipmentType = 'brush_bench' | 'dip_tank' | 'spray_booth' | 'drying_rack'

interface EquipmentBase {
  name: string
  price: number
  footprintSqFt: number
  description: string
}

export interface StationSpec extends EquipmentBase {
  kind: 'station'
  maxBfPerHour: number
  /** Multiplies the operator's waste; below 1 means the machine wastes less than hand work. */
  wasteFactor: number
}

export interface RackSpec extends EquipmentBase {
  kind: 'rack'
  capacityBf: number
}

export type EquipmentSpec = StationSpec | RackSpec

export const EQUIPMENT: Record<EquipmentType, EquipmentSpec> = {
  brush_bench: {
    kind: 'station',
    name: 'Brush bench',
    price: 1500,
    footprintSqFt: 80,
    maxBfPerHour: 60,
    wasteFactor: 1,
    description: 'Hand-applied stain. Slow and forgiving on the budget, not on the wood.',
  },
  dip_tank: {
    kind: 'station',
    name: 'Dip tank',
    price: 7500,
    footprintSqFt: 200,
    maxBfPerHour: 180,
    wasteFactor: 0.8,
    description: 'Bundles are dipped and hung. The workhorse of small yards.',
  },
  spray_booth: {
    kind: 'station',
    name: 'Spray booth',
    price: 22000,
    footprintSqFt: 450,
    maxBfPerHour: 400,
    wasteFactor: 0.6,
    description: 'Enclosed conveyor sprayer. High volume, even coats.',
  },
  drying_rack: {
    kind: 'rack',
    name: 'Drying rack',
    price: 800,
    footprintSqFt: 60,
    capacityBf: 600,
    description: 'Stained wood dries here for a few hours before it can be stacked.',
  },
}

/** How long stained wood sits on a rack before it can be stacked as finished stock, in minutes. */
export const DRYING_MINUTES = 180

/** Selling equipment returns this fraction of its list price. */
export const EQUIPMENT_RESALE = 0.5

// --- Clock ---------------------------------------------------------------------------------------------

/** Working hours, in minutes since midnight. */
export const DAY_START_MINUTE = 8 * 60 // 8:00 AM
export const DAY_END_MINUTE = 20 * 60 // 8:00 PM

/**
 * Adds a delay counted in working minutes: trucks don't run overnight, so time left over at 8:00 PM
 * carries into the next morning.
 */
export function addWorkingMinutes(day: number, minute: number, delay: number): { day: number; minute: number } {
  let m = Math.max(minute, DAY_START_MINUTE) + delay
  let d = day
  while (m >= DAY_END_MINUTE) {
    m -= DAY_END_MINUTE - DAY_START_MINUTE
    d++
  }
  return { day: d, minute: m }
}

/** Working minutes from one point in time to a later one (0 if it has already passed). */
export function workingMinutesBetween(fromDay: number, fromMinute: number, toDay: number, toMinute: number): number {
  const workday = DAY_END_MINUTE - DAY_START_MINUTE
  const at = (d: number, m: number) => d * workday + Math.min(Math.max(m, DAY_START_MINUTE), DAY_END_MINUTE) - DAY_START_MINUTE
  return Math.max(0, at(toDay, toMinute) - at(fromDay, fromMinute))
}

// --- Lumber market -------------------------------------------------------------------------------------

export type Species = 'pine' | 'cedar'

export interface SpeciesSpec {
  name: string
  /** The long-run price the market drifts back toward, per board foot. */
  basePricePerBf: number
  /** Standard deviation of the daily move, as a fraction of the current price. */
  volatility: number
}

export const SPECIES: Record<Species, SpeciesSpec> = {
  pine: { name: 'Pine', basePricePerBf: 0.9, volatility: 0.03 },
  cedar: { name: 'Cedar', basePricePerBf: 1.6, volatility: 0.045 },
}

export const LUMBER_BUNDLE_BF = 500

/** Fraction of the gap back to the base price that closes each day. */
export const PRICE_REVERSION = 0.15

/** Prices never leave this band, as multiples of the base price. */
export const PRICE_BOUNDS = [0.55, 1.8] as const

export interface MarketEvent {
  headline: string
  /** Which species it moves; undefined means the whole market. */
  species?: Species
  /** One-off price shock, e.g. 0.18 = +18%. */
  shift: number
}

/** Chance that a given day opens with a market-moving headline. */
export const MARKET_EVENT_CHANCE = 0.07

export const MARKET_EVENTS: readonly MarketEvent[] = [
  { headline: 'Wildfire season closes western forests', shift: 0.18 },
  { headline: 'Rail car shortage backs up lumber shipments', shift: 0.1 },
  { headline: 'Housing starts slump as builders cancel orders', shift: -0.12 },
  { headline: 'Mill strike ends and the backlog floods the market', shift: -0.1 },
  { headline: 'Pine beetle outbreak hits southern stands', species: 'pine', shift: 0.2 },
  { headline: 'Mild winter keeps pine loggers working', species: 'pine', shift: -0.12 },
  { headline: 'Deck-building boom drives up cedar demand', species: 'cedar', shift: 0.2 },
  { headline: 'Cedar export tariff lifted', species: 'cedar', shift: -0.15 },
]

/** Standard normal sample (Box–Muller). */
function gaussian(random: () => number): number {
  const u = 1 - random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

/**
 * Rolls a new day's prices: a mean-reverting random walk around each species' base price, plus the occasional
 * headline that shocks one species or the whole market.
 */
export function rollMarketDay(
  previous: Partial<Record<Species, number>>,
  random: () => number = Math.random,
): { prices: Record<Species, number>; event: MarketEvent | null } {
  const event = random() < MARKET_EVENT_CHANCE ? MARKET_EVENTS[Math.floor(random() * MARKET_EVENTS.length)] : null
  const prices = {} as Record<Species, number>
  for (const species of Object.keys(SPECIES) as Species[]) {
    const { basePricePerBf: base, volatility } = SPECIES[species]
    const prev = previous[species] ?? base
    let price = prev + PRICE_REVERSION * (base - prev) + prev * volatility * gaussian(random)
    if (event && (!event.species || event.species === species)) price *= 1 + event.shift
    price = Math.min(base * PRICE_BOUNDS[1], Math.max(base * PRICE_BOUNDS[0], price))
    prices[species] = Math.round(price * 1000) / 1000
  }
  return { prices, event }
}

// --- Mills ---------------------------------------------------------------------------------------------

export type MillId = 'riverbend' | 'cascade' | 'northfork'

export interface MillSpec {
  name: string
  description: string
  species: readonly Species[]
  /** The mill's list price as a multiple of the market price. */
  priceFactor: number
  /** Flat charge per delivery; hauling it in your own truck avoids it. */
  deliveryFee: number
  /** Truck time from order to the yard gate, in working minutes. */
  deliveryMinutes: readonly [number, number]
  /** One-way drive from the yard for a pickup, in working minutes. */
  haulMinutes: number
  startingReputation: number
}

export const MILLS: Record<MillId, MillSpec> = {
  riverbend: {
    name: 'Riverbend Sawmill',
    description: 'Small pine mill up the highway. Already knows your name.',
    species: ['pine'],
    priceFactor: 0.97,
    deliveryFee: 140,
    deliveryMinutes: [240, 300],
    haulMinutes: 70,
    startingReputation: 10,
  },
  cascade: {
    name: 'Cascade Timber Co.',
    description: 'Regional supplier that stocks everything, at a markup, until you prove yourself.',
    species: ['pine', 'cedar'],
    priceFactor: 1.05,
    deliveryFee: 220,
    deliveryMinutes: [240, 330],
    haulMinutes: 90,
    startingReputation: 0,
  },
  northfork: {
    name: 'North Fork Cedar',
    description: 'Specialty cedar mill. A long haul, but the best cedar price once they trust you.',
    species: ['cedar'],
    priceFactor: 0.96,
    deliveryFee: 260,
    deliveryMinutes: [300, 360],
    haulMinutes: 140,
    startingReputation: 0,
  },
}

/** One truckload: the most a single mill order can carry. */
export const MAX_ORDER_BUNDLES = 12

export const MAX_REPUTATION_DISCOUNT = 0.2

export function reputationDiscount(reputation: number): number {
  return (reputation / 100) * MAX_REPUTATION_DISCOUNT
}

/** Final Cost = Market Price × (1 − (Reputation / 100) × 0.20), applied to the mill's list price. */
export function millPricePerBf(marketPrice: number, mill: MillSpec, reputation: number): number {
  return marketPrice * mill.priceFactor * (1 - reputationDiscount(reputation))
}

/** Reputation earned per board foot delivered: +1 per 1,000 bf. */
export const REPUTATION_PER_BF = 1 / 1000
/** Lost when you turn a mill's truck away at the gate. */
export const REPUTATION_REFUSAL_PENALTY = 3
/** A mill starts forgetting you after this many days without a delivery... */
export const REPUTATION_GRACE_DAYS = 10
/** ...at this much per day. */
export const REPUTATION_DECAY_PER_DAY = 0.5

// --- Contracts -----------------------------------------------------------------------------------------

export type ContractKind = 'toll' | 'purchase'

export interface ContractKindSpec {
  name: string
  description: string
  /** Order size, in lumber bundles. */
  bundles: readonly [number, number]
  /** Days of slack on top of the time a small yard needs for the volume. */
  slackDays: readonly [number, number]
  /** Toll: the staining fee. Purchase: the premium over the market price of the wood. Per board foot. */
  ratePerBf: readonly [number, number]
  /** Charged if the deadline is missed, as a fraction of the payout. */
  penaltyRate: number
}

export const CONTRACT_KINDS: Record<ContractKind, ContractKindSpec> = {
  toll: {
    name: 'Toll',
    description: 'The customer drops off their own lumber; you stain it and hand back the same volume.',
    bundles: [1, 6],
    slackDays: [1, 2],
    ratePerBf: [0.55, 0.8],
    penaltyRate: 0.5,
  },
  purchase: {
    name: 'Purchase',
    description: 'You source the lumber from a mill and sell it back stained. More capital, more margin.',
    bundles: [2, 10],
    slackDays: [2, 4],
    ratePerBf: [0.85, 1.25],
    penaltyRate: 0.25,
  },
}

/** Customer truck time for toll drop-offs, in working minutes. */
export const TOLL_DROPOFF_MINUTES = [60, 120] as const

/** Rough daily output of a starting yard; sets how many days a contract of a given size allows. */
export const CONTRACT_BF_PER_DAY = 400

/** Days allowed from acceptance to deadline for a given volume. */
export function contractLeadDays(boardFeet: number, slackDays: number): number {
  return Math.ceil(boardFeet / CONTRACT_BF_PER_DAY) + slackDays
}

export const CONTRACT_BOARD_MAX = 6
export const NEW_OFFERS_PER_DAY = [1, 3] as const
/** Offers stay on the board for this many days, including the day they appear. */
export const OFFER_SHELF_DAYS = 2

export const CUSTOMERS = [
  'Hillcrest Fence Co.',
  'Lakeside Decks',
  'Summit Outdoor Living',
  'Ironwood Builders',
  'Prairie Fence & Gate',
  'Blue Heron Landscaping',
  'Maple Street Homes',
  'Tri-County Fencing',
  'Redtail Construction',
  'Oak Hollow Pergolas',
  'Keystone Supply',
  'Westfield Home Center',
] as const


/** One-way drive to a customer's site, in working minutes, for delivering an order yourself. */
export const CUSTOMER_ROUTE_MINUTES = [40, 150] as const

/** Customers pay freight when you truck the order to them: a flat rate per board foot plus a rate per hour of route. */
export const FREIGHT_PER_BF = 0.08
export const FREIGHT_PER_BF_HOUR = 0.03

export function freightAllowance(boardFeet: number, routeMinutes: number): number {
  return Math.round((boardFeet * (FREIGHT_PER_BF + (FREIGHT_PER_BF_HOUR * routeMinutes) / 60)) / 10) * 10
}

// --- Real estate ---------------------------------------------------------------------------------------

export type PropertyType = 'gravel_lot' | 'acreage' | 'production_annex'
export type Tenure = 'lease' | 'own'

export interface PropertySpec {
  name: string
  description: string
  /** Storage lots hold stacked lumber only; production space extends the yard floor, machinery included. */
  zone: 'storage' | 'production'
  sqFt: number
  price: number
  leasePerDay: number
}

export const PROPERTIES: Record<PropertyType, PropertySpec> = {
  gravel_lot: {
    name: 'Gravel storage lot',
    description: 'Fenced gravel pad across the road. Lumber only: no power or zoning for machinery.',
    zone: 'storage',
    sqFt: 3000,
    price: 24000,
    leasePerDay: 70,
  },
  acreage: {
    name: 'Undeveloped acreage',
    description: 'Cheap open ground at the edge of town. Room for a lot of stacks, if you have the crew to move them.',
    zone: 'storage',
    sqFt: 10000,
    price: 52000,
    leasePerDay: 150,
  },
  production_annex: {
    name: 'Commercial annex',
    description: 'Zoned commercial building beside the yard. Adds production floor for stations and racks.',
    zone: 'production',
    sqFt: 2000,
    price: 90000,
    leasePerDay: 340,
  },
}

/** Signing a lease costs this many days of rent up front, on top of the nightly rent. */
export const LEASE_SIGNING_DAYS = 5
/** Owned property pays this fraction of its purchase price in tax every night. */
export const PROPERTY_TAX_PER_DAY = 0.0003
/** Selling returns this fraction of the purchase price. */
export const PROPERTY_RESALE = 0.85

// --- Warehouse & fleet crew ----------------------------------------------------------------------------

export type CrewRole = 'forklift_driver' | 'logistics_manager' | 'driver' | 'cdl_driver'
export type License = 'standard' | 'cdl'

export interface CrewRoleSpec {
  name: string
  description: string
  dailyWage: number
  /** Recruiting cost, paid when hiring. */
  hiringFee: number
  /** Which vehicles they can drive, if any. */
  license?: License
  maxCount?: number
}

/** Storage-lot floor one forklift driver keeps in use. Lot space beyond the crew's reach sits empty. */
export const FORKLIFT_COVERAGE_SQFT = 5000

export const CREW_ROLES: Record<CrewRole, CrewRoleSpec> = {
  forklift_driver: {
    name: 'Forklift driver',
    description: `Works the storage lots. Each one keeps up to ${FORKLIFT_COVERAGE_SQFT.toLocaleString('en-US')} sq ft of lot space in use.`,
    dailyWage: 150,
    hiringFee: 250,
  },
  logistics_manager: {
    name: 'Logistics manager',
    description: 'Runs preventive maintenance and dispatch: 40% fewer breakdowns, and roadside repairs take half as long.',
    dailyWage: 280,
    hiringFee: 1500,
    maxCount: 1,
  },
  driver: {
    name: 'Driver',
    description: 'Standard license. Drives heavy-duty pickups.',
    dailyWage: 165,
    hiringFee: 300,
    license: 'standard',
  },
  cdl_driver: {
    name: 'CDL driver',
    description: 'Commercial license. Drives anything in the fleet, and costs like it.',
    dailyWage: 290,
    hiringFee: 900,
    license: 'cdl',
  },
}

/** Whether a driver holding `license` may drive a vehicle that requires `required`. */
export function canDrive(license: License | undefined, required: License): boolean {
  return license === 'cdl' || (license === 'standard' && required === 'standard')
}

export const LOGISTICS_MANAGER_BREAKDOWN_FACTOR = 0.6
export const LOGISTICS_MANAGER_REPAIR_FACTOR = 0.5

// --- Fleet ---------------------------------------------------------------------------------------------

export type VehicleType = 'pickup' | 'flatbed' | 'semi'

export interface VehicleSpec {
  name: string
  description: string
  price: number
  capacityBundles: number
  license: License
  insurancePerDay: number
  fuelPerHour: number
  /** Drive time as a multiple of a pickup's; heavy trucks are slower on the road. */
  speedFactor: number
  /** Chance of a breakdown per hour on the road, in perfect condition. */
  breakdownPerHour: number
  /** Condition lost per hour on the road. */
  wearPerHour: number
  repairMinutes: readonly [number, number]
  repairCost: readonly [number, number]
}

export const VEHICLES: Record<VehicleType, VehicleSpec> = {
  pickup: {
    name: 'Heavy-duty pickup',
    description: 'Tows a four-bundle gooseneck trailer. Cheap to run, any licensed driver, lots of trips.',
    price: 16000,
    capacityBundles: 4,
    license: 'standard',
    insurancePerDay: 14,
    fuelPerHour: 14,
    speedFactor: 1,
    breakdownPerHour: 0.004,
    wearPerHour: 0.5,
    repairMinutes: [90, 180],
    repairCost: [250, 700],
  },
  flatbed: {
    name: 'Flatbed truck',
    description: 'Six bundles strapped down. Needs a CDL driver and real insurance.',
    price: 42000,
    capacityBundles: 6,
    license: 'cdl',
    insurancePerDay: 38,
    fuelPerHour: 24,
    speedFactor: 1.15,
    breakdownPerHour: 0.006,
    wearPerHour: 0.6,
    repairMinutes: [120, 240],
    repairCost: [700, 2000],
  },
  semi: {
    name: 'Semi-truck',
    description: 'A full 53-foot trailer: more than a mill truck carries. Expensive when it sits, worse when it breaks.',
    price: 88000,
    capacityBundles: 16,
    license: 'cdl',
    insurancePerDay: 75,
    fuelPerHour: 38,
    speedFactor: 1.3,
    breakdownPerHour: 0.008,
    wearPerHour: 0.7,
    repairMinutes: [180, 360],
    repairCost: [1500, 4500],
  },
}

/** Time to load or unload at the far end of a trip, in working minutes. */
export const LOAD_MINUTES = 30
/** Time a scheduled service keeps a vehicle in the shop, in working minutes. */
export const SERVICE_MINUTES = 120

/** One-way drive time for this vehicle on a route a pickup covers in `pickupMinutes`. */
export function vehicleDriveMinutes(spec: VehicleSpec, pickupMinutes: number): number {
  return Math.round(pickupMinutes * spec.speedFactor)
}

/** Fuel for a round trip of `driveMinutes` each way. */
export function tripFuelCost(spec: VehicleSpec, driveMinutes: number): number {
  return Math.round(spec.fuelPerHour * ((2 * driveMinutes) / 60))
}

/** Per-minute breakdown chance on the road. Wear multiplies it: ×1 in perfect condition, ×5 when worn out. */
export function breakdownChancePerMinute(spec: VehicleSpec, condition: number, hasLogisticsManager: boolean): number {
  const manager = hasLogisticsManager ? LOGISTICS_MANAGER_BREAKDOWN_FACTOR : 1
  return (spec.breakdownPerHour / 60) * (1 + (100 - condition) / 25) * manager
}

/** A scheduled service restores condition to 100; the bill grows with the wear it fixes. */
export function serviceCost(spec: VehicleSpec, condition: number): number {
  return Math.round(100 + spec.price * 0.0006 * (100 - condition))
}

export function vehicleResale(spec: VehicleSpec, condition: number): number {
  return Math.round(spec.price * (0.4 + (0.3 * condition) / 100))
}

// --- Capitalization & solvency -------------------------------------------------------------------------

export type Capitalization = 'bootstrapped' | 'bank_backed'

export interface CapitalizationSpec {
  name: string
  description: string
  /** Cash on hand on day 1, loan proceeds included. */
  cash: number
  loan: number
  /** Annual interest rate on the outstanding balance. */
  loanRate: number
  /** The loan is repaid in equal nightly principal installments over this many days. */
  loanTermDays: number
}

export const CAPITALIZATIONS: Record<Capitalization, CapitalizationSpec> = {
  bootstrapped: {
    name: 'Bootstrapped',
    description: 'Your own savings. Less room for mistakes, but nobody to answer to.',
    cash: 50000,
    loan: 0,
    loanRate: 0,
    loanTermDays: 0,
  },
  bank_backed: {
    name: 'Bank-backed',
    description: 'Twice the capital to grow fast, and a loan payment due every night whether the yard is busy or not.',
    cash: 100000,
    loan: 50000,
    loanRate: 0.24,
    loanTermDays: 120,
  },
}

/** One night's loan charge: interest on the balance, plus the fixed principal installment (never more than is owed). */
export function loanPayment(balance: number, annualRate: number, installment: number): { interest: number; principal: number } {
  return {
    interest: Math.round(((balance * annualRate) / 365) * 100) / 100,
    principal: Math.min(balance, installment),
  }
}

/** Closing this many nights in a row with negative cash puts the company into bankruptcy. */
export const INSOLVENCY_GRACE_NIGHTS = 3

/** Whether the moment (day, minute) has been reached by now. */
export function isReached(day: number, minute: number, nowDay: number, nowMinute: number): boolean {
  return day < nowDay || (day === nowDay && minute <= nowMinute)
}
