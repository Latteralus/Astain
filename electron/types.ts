// Types shared between the Electron main process and the React renderer.
import type {
  Capitalization,
  ContractKind,
  CrewRole,
  EquipmentType,
  JobPostingTier,
  MillId,
  PropertyType,
  Species,
  Tenure,
  VehicleType,
} from './rules'

export { DAY_END_MINUTE, DAY_START_MINUTE } from './rules'

export type GamePhase = 'running' | 'paused' | 'eod'

export type InventoryState = 'raw' | 'drying' | 'finished'

export interface InventoryItem {
  species: Species
  state: InventoryState
  boardFeet: number
}

/** Stained wood on the racks that will be dry at (readyDay, readyMinute). */
export interface DryingBatch {
  species: Species
  boardFeet: number
  readyDay: number
  /** Can run past 8:00 PM; wood still racked at closing dries overnight. */
  readyMinute: number
}

export interface EquipmentItem {
  id: number
  type: EquipmentType
  purchasedDay: number
}

export type EmployeeStatus = 'unassigned' | 'working' | 'no_raw' | 'racks_full' | 'off_shift'

export interface Employee {
  id: number
  name: string
  level: number
  xp: number
  speed: number
  quality: number
  dailyWage: number
  /** Cash owed immediately if fired. */
  severance: number
  hiredDay: number
  stationId: number | null
  status: EmployeeStatus
}

export interface Candidate {
  id: number
  name: string
  speed: number
  quality: number
  dailyWage: number
  expiresDay: number
}

export interface SpaceSummary {
  /** Production floor: the home yard plus any commercial annexes. */
  totalSqFt: number
  equipmentSqFt: number
  rackSqFt: number
  /** Total minus equipment and racks: the production floor left for stacked lumber. */
  availableSqFt: number
  /** Storage lots held, and how much of that the forklift crew can keep in use. */
  lotSqFt: number
  lotUsableSqFt: number
  /** All stacked lumber (raw and finished). It fills usable lot space first, then the yard floor. */
  inventorySqFt: number
  lotInventorySqFt: number
  yardInventorySqFt: number
  /** Production floor free for new equipment. */
  yardFreeSqFt: number
  /** Room left for more stacked lumber, across the yard and usable lots. */
  freeSqFt: number
  rackCapacityBf: number
  rackUsedBf: number
  /** Floor that trucks already on the road will need when they arrive. */
  inboundSqFt: number
}

export interface MarketQuote {
  species: Species
  /** Today's market price per board foot. */
  price: number
  /** Yesterday's price, or null on the first day. */
  previousPrice: number | null
}

export interface MarketHistoryPoint {
  day: number
  species: Species
  price: number
}

export interface MarketNews {
  day: number
  headline: string
}

export interface MillState {
  id: MillId
  /** 0–100. */
  reputation: number
  /** Current price discount from reputation, as a 0–1 fraction. */
  discount: number
  deliveredBf: number
  lastDeliveryDay: number | null
  /** Today's price per board foot after the reputation discount, for each species the mill sells. */
  prices: Partial<Record<Species, number>>
}

export type DeliveryKind = 'mill_order' | 'toll_dropoff'
export type DeliveryStatus = 'in_transit' | 'delivered' | 'refused' | 'cancelled'

export interface Delivery {
  id: number
  kind: DeliveryKind
  species: Species
  boardFeet: number
  mill: MillId | null
  contractId: number | null
  /** Mill orders: the lumber price locked in at order time, paid cash on delivery. 0 for toll drop-offs. */
  goodsCost: number
  status: DeliveryStatus
  orderedDay: number
  orderedMinute: number
  etaDay: number
  etaMinute: number
  resolvedDay: number | null
  resolvedMinute: number | null
}

export type ContractStatus = 'offered' | 'active' | 'shipping' | 'completed' | 'failed' | 'expired' | 'declined'

export interface Contract {
  id: number
  customer: string
  kind: ContractKind
  species: Species
  boardFeet: number
  payout: number
  /** Charged if the deadline is missed. Toll contracts also owe the customer's lumber back at market price. */
  penalty: number
  status: ContractStatus
  offeredDay: number
  /** Last day the offer can be accepted. */
  offerExpiresDay: number
  /** Days from acceptance to the deadline. */
  leadDays: number
  acceptedDay: number | null
  /** Deliver by 8:00 PM on this day. */
  dueDay: number | null
  /** Toll only: the customer's lumber has been dropped off. */
  materialReceived: boolean
  /** One-way drive to the customer, for a pickup, in working minutes. */
  routeMinutes: number
  /** Paid on top of the payout when you deliver the order in your own truck. */
  freight: number
  resolvedDay: number | null
  note: string | null
}

export interface Property {
  id: number
  type: PropertyType
  tenure: Tenure
  /** Owned property: what it cost. 0 for leases. */
  pricePaid: number
  acquiredDay: number
}

export interface CrewMember {
  id: number
  name: string
  role: CrewRole
  dailyWage: number
  /** Cash owed immediately if fired. */
  severance: number
  hiredDay: number
  /** Drivers: the trip they are out on. */
  tripId: number | null
}

export type VehicleStatus = 'idle' | 'on_trip' | 'broken_down' | 'in_shop'

export interface Vehicle {
  id: number
  type: VehicleType
  /** 0–100. Wear raises the breakdown chance. */
  condition: number
  purchasePrice: number
  purchasedDay: number
  status: VehicleStatus
  tripId: number | null
  /** In the shop for service until this moment. */
  shopUntilDay: number | null
  shopUntilMinute: number | null
  breakdowns: number
}

export type TripKind = 'mill_pickup' | 'contract_delivery'
export type TripStatus = 'outbound' | 'returning' | 'waiting' | 'completed'

export interface Trip {
  id: number
  kind: TripKind
  vehicleId: number
  driverId: number
  species: Species
  boardFeet: number
  mill: MillId | null
  contractId: number | null
  goodsCost: number
  fuelCost: number
  /** One way. */
  driveMinutes: number
  status: TripStatus
  departedDay: number
  departedMinute: number
  /** When the current leg finishes, repairs included. */
  legEndsDay: number
  legEndsMinute: number
  /** Broken down on the roadside until this moment. */
  repairUntilDay: number | null
  repairUntilMinute: number | null
  breakdowns: number
  completedDay: number | null
  completedMinute: number | null
}

export type NoticeTone = 'info' | 'warning'

export interface Notice {
  tone: NoticeTone
  text: string
}

export interface ProductionTotals {
  /** Good output that went onto the drying racks. */
  stainedBf: number
  wastedBf: number
}

export interface GameState {
  day: number
  /** Minutes since midnight. Working hours run 8:00 AM (480) to 8:00 PM (1200). */
  minute: number
  phase: GamePhase
  companyName: string
  cash: number
  loanBalance: number
  /** Annual rate. */
  loanRate: number
  /** Principal repaid each night, on top of the interest. */
  loanInstallment: number
  /** Consecutive nights closed with negative cash. Reaching INSOLVENCY_GRACE_NIGHTS is bankruptcy. */
  insolventNights: number
  /** The bank has foreclosed: the career is over and the save is read-only. */
  bankrupt: boolean
  space: SpaceSummary
  inventory: InventoryItem[]
  /** What's on the racks and when each lot will be dry. */
  drying: DryingBatch[]
  equipment: EquipmentItem[]
  employees: Employee[]
  candidates: Candidate[]
  today: ProductionTotals
  market: MarketQuote[]
  /** Today's market headline, if any. */
  headline: string | null
  mills: MillState[]
  /** Trucks on the road, plus any that arrived or were turned away today. */
  deliveries: Delivery[]
  /** Open offers and accepted contracts, including those on a truck to the customer. */
  contracts: Contract[]
  properties: Property[]
  crew: CrewMember[]
  vehicles: Vehicle[]
  /** Trips under way, plus any finished today. */
  trips: Trip[]
}

export interface EodLineItem {
  memo: string
  /** Negative = expense. */
  amount: number
}

export interface EodReport {
  day: number
  openingCash: number
  /** Income booked during working hours. */
  revenue: number
  /** Expenses booked during working hours (negative). */
  operatingExpenses: number
  /** Equipment, vehicle and property purchases and sales. */
  capitalSpending: number
  /** Payroll, rent, utilities, loan interest, etc. charged at 8:00 PM (negative amounts). */
  overnightItems: EodLineItem[]
  netChange: number
  endingCash: number
  /** Consecutive nights in the red, this one included; 0 if the day closed with cash in hand. */
  insolventNights: number
  production: ProductionTotals & {
    /** Moved from the racks to finished stock today, during the day and overnight. */
    driedBf: number
    /** Left on the racks because the floor had no room to stack it. */
    stuckOnRacksBf: number
  }
}

export type LedgerCategory = 'operating' | 'capital' | 'overnight'

export interface LedgerEntry {
  id: number
  day: number
  minute: number
  amount: number
  category: LedgerCategory
  memo: string
}

export type ActionResult = { ok: true } | { ok: false; error: string }

/** One career in the saves folder, as listed on the title menu. */
export interface SaveSummary {
  id: string
  companyName: string
  day: number
  cash: number
  capitalization: Capitalization | null
  bankrupt: boolean
  /** When the save was last written, in ms since the epoch. */
  lastPlayed: number
  /** False if the file was written by a newer build, is too old to upgrade, or is damaged. */
  compatible: boolean
}

export interface GameApi {
  /** Saves on disk, most recently played first. */
  listSaves: () => Promise<SaveSummary[]>
  /** Starts a new career in its own save file and makes it the loaded game. */
  newGame: (companyName: string, capitalization: Capitalization) => Promise<ActionResult>
  loadGame: (saveId: string) => Promise<ActionResult>
  deleteSave: (saveId: string) => Promise<ActionResult>
  /** Copies the loaded game into a new save file, as a checkpoint to come back to. Play continues in the original. */
  saveCopy: () => Promise<ActionResult>
  /** Makes sure everything played so far is written to the save file. */
  saveGame: () => Promise<ActionResult>
  /** Closes the loaded game (it's already saved) and returns to the title menu. */
  exitToMenu: () => Promise<void>
  /** The loaded game's state, or null on the title menu. */
  getState: () => Promise<GameState | null>
  /** The report for the day just closed, or null outside the end-of-day phase. */
  getEodReport: () => Promise<EodReport | null>
  getLedger: () => Promise<LedgerEntry[]>
  getReportHistory: () => Promise<EodReport[]>
  pause: () => Promise<GameState>
  resume: () => Promise<GameState>
  startNextDay: () => Promise<GameState>
  buyEquipment: (type: EquipmentType) => Promise<ActionResult>
  /** Sells a station or rack for half its list price. */
  sellEquipment: (equipmentId: number) => Promise<ActionResult>
  assignStation: (employeeId: number, equipmentId: number | null) => Promise<ActionResult>
  getMarketHistory: () => Promise<{ prices: MarketHistoryPoint[]; news: MarketNews[] }>
  /** Resolved contracts, newest first. */
  getContractHistory: () => Promise<Contract[]>
  /** With a vehicle, your own truck hauls it: no delivery fee, lumber paid at the mill. Without, the mill delivers. */
  orderLumber: (mill: MillId, species: Species, bundles: number, vehicleId: number | null) => Promise<ActionResult>
  acceptContract: (contractId: number) => Promise<ActionResult>
  declineContract: (contractId: number) => Promise<ActionResult>
  deliverContract: (contractId: number) => Promise<ActionResult>
  /** Loads the finished order onto one of your trucks; the customer pays payout plus freight on arrival. */
  shipContract: (contractId: number, vehicleId: number) => Promise<ActionResult>
  postJob: (tier: JobPostingTier) => Promise<ActionResult>
  hireCandidate: (candidateId: number) => Promise<ActionResult>
  fireEmployee: (employeeId: number) => Promise<ActionResult>
  acquireProperty: (type: PropertyType, tenure: Tenure) => Promise<ActionResult>
  /** Ends a lease or sells an owned property. */
  releaseProperty: (propertyId: number) => Promise<ActionResult>
  hireCrew: (role: CrewRole) => Promise<ActionResult>
  fireCrew: (crewId: number) => Promise<ActionResult>
  buyVehicle: (type: VehicleType) => Promise<ActionResult>
  sellVehicle: (vehicleId: number) => Promise<ActionResult>
  serviceVehicle: (vehicleId: number) => Promise<ActionResult>
  /** Pays down the loan early. */
  repayLoan: (amount: number) => Promise<ActionResult>
  onState: (listener: (state: GameState) => void) => () => void
  onEndOfDay: (listener: (report: EodReport) => void) => () => void
  /** Things that happen on their own: trucks arriving, loads refused, breakdowns. */
  onNotice: (listener: (notice: Notice) => void) => () => void
}
