import fs from 'node:fs'
import Database from 'better-sqlite3'
import schema from './schema.sql?raw'
import {
  CAPITALIZATIONS,
  MILLS,
  type Capitalization,
  type ContractKind,
  type CrewRole,
  type EquipmentType,
  type MillId,
  type PropertyType,
  type Species,
  type Tenure,
  type VehicleType,
} from '../rules'
import type {
  Candidate,
  Contract,
  ContractStatus,
  DryingBatch,
  Delivery,
  DeliveryKind,
  DeliveryStatus,
  EmployeeStatus,
  EodReport,
  EquipmentItem,
  InventoryItem,
  InventoryState,
  LedgerCategory,
  LedgerEntry,
  MarketHistoryPoint,
  MarketNews,
  ProductionTotals,
  Property,
  Trip,
  TripKind,
  TripStatus,
} from '../types'

/**
 * Bump whenever schema.sql changes shape, and add a MIGRATIONS entry that upgrades the previous version's tables.
 * New tables need no migration: schema.sql creates them. Only changes to existing tables do (ALTER TABLE).
 */
export const SCHEMA_VERSION = 7

/** SQL that upgrades a save from version N to N + 1, keyed by N. Saves older than the first key can't be upgraded. */
const MIGRATIONS: Record<number, string> = {
  5: `
    ALTER TABLE company ADD COLUMN name TEXT NOT NULL DEFAULT 'AStain Co.';
    ALTER TABLE company ADD COLUMN capitalization TEXT NOT NULL DEFAULT 'bootstrapped';
    ALTER TABLE company ADD COLUMN loan_installment REAL NOT NULL DEFAULT 0;
    ALTER TABLE company ADD COLUMN insolvent_nights INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE company ADD COLUMN bankrupt_day INTEGER;
    ALTER TABLE daily_reports ADD COLUMN insolvent_nights INTEGER NOT NULL DEFAULT 0;
  `,
  // v7 only adds tables (drying_batches, daily_drying), which schema.sql creates. Wood already on the racks gets a
  // batch from reconcileDrying() when the save is opened.
  6: '',
}

/** Whether a save written with schema `version` can be opened by this build, upgrading it if needed. */
export function canOpenVersion(version: number): boolean {
  if (version === SCHEMA_VERSION) return true
  if (version > SCHEMA_VERSION) return false
  for (let v = version; v < SCHEMA_VERSION; v++) if (!(v in MIGRATIONS)) return false
  return true
}

export interface CompanyRow {
  cash: number
  day: number
  minute: number
  loan_balance: number
  loan_rate: number
  yard_sq_ft: number
  name: string
  capitalization: Capitalization
  loan_installment: number
  insolvent_nights: number
  bankrupt_day: number | null
}

export interface NewGameOptions {
  companyName: string
  capitalization: Capitalization
}

export interface FixedCostRow {
  label: string
  daily_amount: number
}

export interface EmployeeRow {
  id: number
  name: string
  level: number
  xp: number
  speed: number
  quality: number
  daily_wage: number
  severance_multiplier: number
  hired_day: number
  station_id: number | null
  status: EmployeeStatus
}

export interface CandidateRow {
  id: number
  name: string
  speed: number
  quality: number
  daily_wage: number
  severance_multiplier: number
  expires_day: number
}

export type NewCandidate = Omit<CandidateRow, 'id'>

export interface MillRow {
  mill: MillId
  reputation: number
  delivered_bf: number
  last_delivery_day: number | null
}

export interface NewContractOffer {
  customer: string
  kind: ContractKind
  species: Species
  board_feet: number
  payout: number
  penalty: number
  offered_day: number
  offer_expires_day: number
  lead_days: number
  route_minutes: number
  freight: number
}

export interface CrewRow {
  id: number
  name: string
  role: CrewRole
  daily_wage: number
  severance_multiplier: number
  hired_day: number
}

export interface VehicleRow {
  id: number
  type: VehicleType
  condition: number
  purchase_price: number
  purchased_day: number
  shop_until_day: number | null
  shop_until_minute: number | null
  breakdowns: number
}

export interface NewTrip {
  kind: TripKind
  vehicle_id: number
  driver_id: number
  species: Species
  board_feet: number
  mill: MillId | null
  contract_id: number | null
  goods_cost: number
  fuel_cost: number
  drive_minutes: number
  departed_day: number
  departed_minute: number
  leg_ends_day: number
  leg_ends_minute: number
}

export interface NewDelivery {
  kind: DeliveryKind
  species: Species
  board_feet: number
  mill: MillId | null
  contract_id: number | null
  goods_cost: number
  ordered_day: number
  ordered_minute: number
  eta_day: number
  eta_minute: number
}

const CONTRACT_COLUMNS = `id, customer, kind, species, board_feet AS boardFeet, payout, penalty, status,
  offered_day AS offeredDay, offer_expires_day AS offerExpiresDay, lead_days AS leadDays, accepted_day AS acceptedDay,
  due_day AS dueDay, material_received AS materialReceived, route_minutes AS routeMinutes, freight,
  resolved_day AS resolvedDay, note`

const DELIVERY_COLUMNS = `id, kind, species, board_feet AS boardFeet, mill, contract_id AS contractId, goods_cost AS goodsCost,
  status, ordered_day AS orderedDay, ordered_minute AS orderedMinute, eta_day AS etaDay, eta_minute AS etaMinute,
  resolved_day AS resolvedDay, resolved_minute AS resolvedMinute`

const TRIP_COLUMNS = `id, kind, vehicle_id AS vehicleId, driver_id AS driverId, species, board_feet AS boardFeet, mill,
  contract_id AS contractId, goods_cost AS goodsCost, fuel_cost AS fuelCost, drive_minutes AS driveMinutes, status,
  departed_day AS departedDay, departed_minute AS departedMinute, leg_ends_day AS legEndsDay,
  leg_ends_minute AS legEndsMinute, repair_until_day AS repairUntilDay, repair_until_minute AS repairUntilMinute,
  breakdowns, completed_day AS completedDay, completed_minute AS completedMinute`

/** SQLite has no boolean type; turn the 0/1 flag back into one. */
const toContract = (row: Contract): Contract => ({ ...row, materialReceived: !!row.materialReceived })

export interface DailyReportRow {
  day: number
  opening_cash: number
  revenue: number
  operating_expenses: number
  capital_spending: number
  overnight_costs: number
  ending_cash: number
  stained_bf: number
  wasted_bf: number
  dried_bf: number
  stuck_on_racks_bf: number
  insolvent_nights: number
}

const NEW_GAME = {
  yardSqFt: 2500,
  fixedCosts: [
    { label: 'Rent', daily_amount: 250 },
    { label: 'Utilities', daily_amount: 60 },
    { label: 'Insurance', daily_amount: 40 },
  ],
  // The yard comes with a brush bench and two racks, but no lumber and no staff: the first hire and the first
  // order are the player's to make.
  equipment: ['brush_bench', 'drying_rack', 'drying_rack'] as EquipmentType[],
}

const DEFAULT_NEW_GAME: NewGameOptions = { companyName: 'AStain Co.', capitalization: 'bootstrapped' }

/**
 * Opens a save, upgrading an older schema in place through MIGRATIONS. A copy of the original is kept beside it as
 * `<file>.v<N>.bak` first. A save that can't be upgraded (too old, or written by a newer build) is renamed to the
 * same `.bak` name and a new game starts in its place, so the player never crashes on a missing column.
 */
function openSave(filePath: string): Database.Database {
  let db = new Database(filePath)
  const version = db.pragma('user_version', { simple: true }) as number
  const hasTables = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'company'`).get()
  if (!hasTables || version === SCHEMA_VERSION) return db

  const backup = `${filePath}.v${version}.bak`
  if (canOpenVersion(version)) {
    // VACUUM INTO writes a consistent single-file copy even with an open WAL.
    if (!fs.existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup)
    db.transaction(() => {
      for (let v = version; v < SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
    })()
    console.info(`Save ${filePath} upgraded from schema v${version} to v${SCHEMA_VERSION}.`)
    return db
  }

  db.close()
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(filePath + suffix)) fs.renameSync(filePath + suffix, backup + suffix)
  }
  console.warn(`Save ${filePath} used schema v${version}, which this build can't open; moved aside and starting a new game.`)
  db = new Database(filePath)
  return db
}

export class DbManager {
  private db: Database.Database
  private statements = new Map<string, Database.Statement>()

  /** A prepared statement, compiled once per connection. The simulation runs these thousands of times a day. */
  private sql(source: string): Database.Statement {
    let statement = this.statements.get(source)
    if (!statement) {
      statement = this.db.prepare(source)
      this.statements.set(source, statement)
    }
    return statement
  }

  /** Opens the save at `filePath`, or starts a new company there with `newGame` if the file is empty. */
  constructor(filePath: string, newGame: NewGameOptions = DEFAULT_NEW_GAME) {
    this.db = openSave(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(schema)
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
    this.transaction(() => {
      const capital = CAPITALIZATIONS[newGame.capitalization]
      const created = this
        .sql(
          `INSERT OR IGNORE INTO company (id, cash, yard_sq_ft, name, capitalization, loan_balance, loan_rate, loan_installment)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          capital.cash,
          NEW_GAME.yardSqFt,
          newGame.companyName,
          newGame.capitalization,
          capital.loan,
          capital.loanRate,
          capital.loanTermDays > 0 ? Math.round((capital.loan / capital.loanTermDays) * 100) / 100 : 0,
        )
      if (created.changes === 0) return
      const insertCost = this.sql('INSERT INTO fixed_costs (label, daily_amount) VALUES (?, ?)')
      for (const cost of NEW_GAME.fixedCosts) insertCost.run(cost.label, cost.daily_amount)
      for (const type of NEW_GAME.equipment) this.addEquipment(type, 1)
      const insertMill = this.sql('INSERT INTO mill_relations (mill, reputation) VALUES (?, ?)')
      for (const [id, spec] of Object.entries(MILLS)) insertMill.run(id, spec.startingReputation)
    })
    this.reconcileDrying()
  }

  /**
   * Keeps the drying batches in step with the 'drying' inventory total. Wood racked before batches existed (older
   * saves) gets a batch that is ready now.
   */
  private reconcileDrying(): void {
    this.transaction(() => {
      const { day, minute } = this.getCompany()
      for (const item of this.getInventory()) {
        if (item.state !== 'drying') continue
        const batched = this.getDryingBatches().filter((b) => b.species === item.species).reduce((s, b) => s + b.boardFeet, 0)
        if (item.boardFeet - batched > 1e-6) this.addDryingBatch(item.species, item.boardFeet - batched, day, minute)
      }
    })
  }

  /** Runs `fn` atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  // --- Company & clock ---------------------------------------------------------------------------------

  getCompany(): CompanyRow {
    return this.sql('SELECT * FROM company WHERE id = 1').get() as CompanyRow
  }

  setClock(day: number, minute: number): void {
    this.sql('UPDATE company SET day = ?, minute = ? WHERE id = 1').run(day, minute)
  }

  /** Records the night's solvency: consecutive nights in the red, and the day the bank foreclosed, if it has. */
  setSolvency(insolventNights: number, bankruptDay: number | null): void {
    this.sql('UPDATE company SET insolvent_nights = ?, bankrupt_day = ? WHERE id = 1').run(insolventNights, bankruptDay)
  }

  setLoanBalance(balance: number): void {
    this.sql('UPDATE company SET loan_balance = ? WHERE id = 1').run(Math.max(0, Math.round(balance * 100) / 100))
  }

  getFixedCosts(): FixedCostRow[] {
    return this.sql('SELECT label, daily_amount FROM fixed_costs ORDER BY id').all() as FixedCostRow[]
  }

  // --- Ledger ------------------------------------------------------------------------------------------

  /** Records a cash movement in the ledger and applies it to the company balance atomically. */
  postTransaction(amount: number, memo: string, category: LedgerCategory = 'operating'): void {
    this.transaction(() => {
      const { day, minute } = this.getCompany()
      this
        .sql('INSERT INTO ledger (day, minute, amount, category, memo) VALUES (?, ?, ?, ?, ?)')
        .run(day, minute, amount, category, memo)
      this.sql('UPDATE company SET cash = cash + ? WHERE id = 1').run(amount)
    })
  }

  getLedger(limit = 500): LedgerEntry[] {
    return this.sql('SELECT * FROM ledger ORDER BY id DESC LIMIT ?').all(limit) as LedgerEntry[]
  }

  /** Sums the day's ledger by category: revenue and operating expenses are split by sign. */
  getLedgerTotals(day: number) {
    return this
      .sql(
        `SELECT
           COALESCE(SUM(CASE WHEN category = 'operating' AND amount > 0 THEN amount END), 0) AS revenue,
           COALESCE(SUM(CASE WHEN category = 'operating' AND amount < 0 THEN amount END), 0) AS operatingExpenses,
           COALESCE(SUM(CASE WHEN category = 'capital' THEN amount END), 0) AS capital,
           COALESCE(SUM(CASE WHEN category = 'overnight' THEN amount END), 0) AS overnight,
           COALESCE(SUM(amount), 0) AS net
         FROM ledger WHERE day = ?`,
      )
      .get(day) as { revenue: number; operatingExpenses: number; capital: number; overnight: number; net: number }
  }

  // --- Inventory ---------------------------------------------------------------------------------------

  getInventory(): InventoryItem[] {
    return this
      .sql(
        `SELECT species, state, board_feet AS boardFeet FROM inventory WHERE board_feet > 0.0001 ORDER BY species, state`,
      )
      .all() as InventoryItem[]
  }

  getStock(species: Species, state: InventoryState): number {
    const row = this.sql('SELECT board_feet FROM inventory WHERE species = ? AND state = ?').get(species, state) as
      | { board_feet: number }
      | undefined
    return row?.board_feet ?? 0
  }

  adjustInventory(species: Species, state: InventoryState, deltaBf: number): void {
    this
      .sql(
        `INSERT INTO inventory (species, state, board_feet) VALUES (@species, @state, MAX(0, @delta))
         ON CONFLICT (species, state) DO UPDATE SET board_feet = MAX(0, board_feet + @delta)`,
      )
      .run({ species, state, delta: deltaBf })
  }

  // --- Drying ------------------------------------------------------------------------------------------

  /** Racked wood by the moment it will be dry, earliest first. */
  getDryingBatches(): DryingBatch[] {
    return this.sql(
      `SELECT species, board_feet AS boardFeet, ready_day AS readyDay, ready_minute AS readyMinute FROM drying_batches
       WHERE board_feet > 0.0001 ORDER BY ready_day, ready_minute, species`,
    ).all() as DryingBatch[]
  }

  addDryingBatch(species: Species, boardFeet: number, readyDay: number, readyMinute: number): void {
    this.sql(
      `INSERT INTO drying_batches (species, board_feet, ready_day, ready_minute) VALUES (@species, @bf, @day, @minute)
       ON CONFLICT (species, ready_day, ready_minute) DO UPDATE SET board_feet = board_feet + excluded.board_feet`,
    ).run({ species, bf: boardFeet, day: readyDay, minute: readyMinute })
  }

  /** Takes `boardFeet` off one batch, deleting it once empty. */
  takeFromDryingBatch(b: DryingBatch, boardFeet: number): void {
    this.sql(
      `UPDATE drying_batches SET board_feet = MAX(0, board_feet - @bf)
       WHERE species = @species AND ready_day = @day AND ready_minute = @minute`,
    ).run({ bf: boardFeet, species: b.species, day: b.readyDay, minute: b.readyMinute })
    this.sql('DELETE FROM drying_batches WHERE board_feet <= 0.0001').run()
  }

  logDried(day: number, boardFeet: number): void {
    this.sql(
      `INSERT INTO daily_drying (day, dried_bf) VALUES (?, ?)
       ON CONFLICT (day) DO UPDATE SET dried_bf = dried_bf + excluded.dried_bf`,
    ).run(day, boardFeet)
  }

  getDriedToday(day: number): number {
    return (this.sql('SELECT dried_bf FROM daily_drying WHERE day = ?').get(day) as { dried_bf: number } | undefined)?.dried_bf ?? 0
  }

  // --- Equipment ---------------------------------------------------------------------------------------

  getEquipment(): EquipmentItem[] {
    return this
      .sql('SELECT id, type, purchased_day AS purchasedDay FROM equipment ORDER BY id')
      .all() as EquipmentItem[]
  }

  /** Removes a piece of equipment for good (it was sold). Its operator must already be off it. */
  removeEquipment(id: number): void {
    this.sql('DELETE FROM equipment WHERE id = ?').run(id)
  }

  /** Forces everything written so far into the main save file, so nothing depends on the write-ahead log. */
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)')
  }

  addEquipment(type: EquipmentType, day: number): number {
    return Number(this.sql('INSERT INTO equipment (type, purchased_day) VALUES (?, ?)').run(type, day).lastInsertRowid)
  }

  // --- Employees ---------------------------------------------------------------------------------------

  getEmployees(): EmployeeRow[] {
    return this.sql('SELECT * FROM employees WHERE fired_day IS NULL ORDER BY id').all() as EmployeeRow[]
  }

  getEmployee(id: number): EmployeeRow | undefined {
    return this.sql('SELECT * FROM employees WHERE id = ? AND fired_day IS NULL').get(id) as EmployeeRow | undefined
  }

  hire(c: NewCandidate, day: number): number {
    return Number(
      this
        .sql(
          `INSERT INTO employees (name, speed, quality, daily_wage, severance_multiplier, hired_day)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(c.name, c.speed, c.quality, c.daily_wage, c.severance_multiplier, day).lastInsertRowid,
    )
  }

  fire(id: number, day: number): void {
    this.sql(`UPDATE employees SET fired_day = ?, station_id = NULL, status = 'unassigned' WHERE id = ?`).run(day, id)
  }

  setStation(employeeId: number, stationId: number | null): void {
    this.sql('UPDATE employees SET station_id = ? WHERE id = ?').run(stationId, employeeId)
  }

  /** The active employee operating a station, if any. */
  getOperator(stationId: number): EmployeeRow | undefined {
    return this.sql('SELECT * FROM employees WHERE station_id = ? AND fired_day IS NULL').get(stationId) as
      | EmployeeRow
      | undefined
  }

  setStatus(employeeId: number, status: EmployeeStatus): void {
    this.sql('UPDATE employees SET status = ? WHERE id = ?').run(status, employeeId)
  }

  setAllStatuses(status: EmployeeStatus): void {
    this
      .sql(`UPDATE employees SET status = CASE WHEN station_id IS NULL THEN 'unassigned' ELSE ? END WHERE fired_day IS NULL`)
      .run(status)
  }

  updateProgress(id: number, p: { level: number; xp: number; speed: number; quality: number }): void {
    this
      .sql('UPDATE employees SET level = ?, xp = ?, speed = ?, quality = ? WHERE id = ?')
      .run(p.level, p.xp, p.speed, p.quality, id)
  }

  // --- Candidates --------------------------------------------------------------------------------------

  getCandidates(): Candidate[] {
    return this
      .sql(
        `SELECT id, name, speed, quality, daily_wage AS dailyWage, expires_day AS expiresDay FROM candidates ORDER BY id`,
      )
      .all() as Candidate[]
  }

  getCandidate(id: number): CandidateRow | undefined {
    return this.sql('SELECT * FROM candidates WHERE id = ?').get(id) as CandidateRow | undefined
  }

  addCandidate(c: NewCandidate): void {
    this
      .sql(
        `INSERT INTO candidates (name, speed, quality, daily_wage, severance_multiplier, expires_day)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(c.name, c.speed, c.quality, c.daily_wage, c.severance_multiplier, c.expires_day)
  }

  removeCandidate(id: number): void {
    this.sql('DELETE FROM candidates WHERE id = ?').run(id)
  }

  /** Drops candidates whose last available day is before `day`. */
  expireCandidates(day: number): void {
    this.sql('DELETE FROM candidates WHERE expires_day < ?').run(day)
  }

  // --- Market ------------------------------------------------------------------------------------------

  /** Prices for one day, keyed by species; empty if the day hasn't opened yet. */
  getPrices(day: number): Partial<Record<Species, number>> {
    const rows = this.sql('SELECT species, price_per_bf FROM market_prices WHERE day = ?').all(day) as {
      species: Species
      price_per_bf: number
    }[]
    return Object.fromEntries(rows.map((r) => [r.species, r.price_per_bf]))
  }

  setPrice(day: number, species: Species, price: number): void {
    this.sql('INSERT OR REPLACE INTO market_prices (day, species, price_per_bf) VALUES (?, ?, ?)').run(day, species, price)
  }

  getPriceHistory(sinceDay: number): MarketHistoryPoint[] {
    return this
      .sql('SELECT day, species, price_per_bf AS price FROM market_prices WHERE day >= ? ORDER BY day, species')
      .all(sinceDay) as MarketHistoryPoint[]
  }

  addNews(day: number, headline: string): void {
    this.sql('INSERT OR REPLACE INTO market_news (day, headline) VALUES (?, ?)').run(day, headline)
  }

  getNews(sinceDay: number): MarketNews[] {
    return this.sql('SELECT day, headline FROM market_news WHERE day >= ? ORDER BY day DESC').all(sinceDay) as MarketNews[]
  }

  // --- Mills -------------------------------------------------------------------------------------------

  getMills(): MillRow[] {
    return this.sql('SELECT * FROM mill_relations ORDER BY rowid').all() as MillRow[]
  }

  getMill(id: MillId): MillRow | undefined {
    return this.sql('SELECT * FROM mill_relations WHERE mill = ?').get(id) as MillRow | undefined
  }

  updateMill(row: MillRow): void {
    this
      .sql(
        `UPDATE mill_relations SET reputation = @reputation, delivered_bf = @delivered_bf,
           last_delivery_day = @last_delivery_day WHERE mill = @mill`,
      )
      .run({ ...row, reputation: Math.min(100, Math.max(0, row.reputation)) })
  }

  // --- Deliveries --------------------------------------------------------------------------------------

  addDelivery(d: NewDelivery): number {
    return Number(
      this
        .sql(
          `INSERT INTO deliveries (kind, species, board_feet, mill, contract_id, goods_cost, ordered_day, ordered_minute,
             eta_day, eta_minute)
           VALUES (@kind, @species, @board_feet, @mill, @contract_id, @goods_cost, @ordered_day, @ordered_minute,
             @eta_day, @eta_minute)`,
        )
        .run(d).lastInsertRowid,
    )
  }

  /** Trucks still on the road, plus those that reached the gate on `day`. */
  getDeliveries(day: number): Delivery[] {
    return this
      .sql(
        `SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE status = 'in_transit' OR resolved_day = ?
         ORDER BY status = 'in_transit' DESC, eta_day, eta_minute, id`,
      )
      .all(day) as Delivery[]
  }

  getInTransit(): Delivery[] {
    return this
      .sql(`SELECT ${DELIVERY_COLUMNS} FROM deliveries WHERE status = 'in_transit' ORDER BY eta_day, eta_minute, id`)
      .all() as Delivery[]
  }

  /** In-transit trucks whose ETA is at or before the given moment, earliest first. */
  getArrivals(day: number, minute: number): Delivery[] {
    return this
      .sql(
        `SELECT ${DELIVERY_COLUMNS} FROM deliveries
         WHERE status = 'in_transit' AND (eta_day < @day OR (eta_day = @day AND eta_minute <= @minute))
         ORDER BY eta_day, eta_minute, id`,
      )
      .all({ day, minute }) as Delivery[]
  }

  resolveDelivery(id: number, status: DeliveryStatus, day: number, minute: number): void {
    this
      .sql('UPDATE deliveries SET status = ?, resolved_day = ?, resolved_minute = ? WHERE id = ?')
      .run(status, day, minute, id)
  }

  // --- Contracts ---------------------------------------------------------------------------------------

  addContractOffer(c: NewContractOffer): void {
    this
      .sql(
        `INSERT INTO contracts (customer, kind, species, board_feet, payout, penalty, offered_day, offer_expires_day, lead_days,
           route_minutes, freight)
         VALUES (@customer, @kind, @species, @board_feet, @payout, @penalty, @offered_day, @offer_expires_day, @lead_days,
           @route_minutes, @freight)`,
      )
      .run(c)
  }

  getContract(id: number): Contract | undefined {
    const row = this.sql(`SELECT ${CONTRACT_COLUMNS} FROM contracts WHERE id = ?`).get(id) as Contract | undefined
    return row && toContract(row)
  }

  getContracts(statuses: ContractStatus[]): Contract[] {
    const placeholders = statuses.map(() => '?').join(', ')
    return (
      this
        .sql(
          `SELECT ${CONTRACT_COLUMNS} FROM contracts WHERE status IN (${placeholders})
           ORDER BY status = 'offered', COALESCE(due_day, offer_expires_day), id`,
        )
        .all(...statuses) as Contract[]
    ).map(toContract)
  }

  getContractHistory(limit = 100): Contract[] {
    return (
      this
        .sql(
          `SELECT ${CONTRACT_COLUMNS} FROM contracts WHERE status NOT IN ('offered', 'active', 'shipping')
           ORDER BY resolved_day DESC, id DESC LIMIT ?`,
        )
        .all(limit) as Contract[]
    ).map(toContract)
  }

  countOffers(): number {
    return (this.sql(`SELECT COUNT(*) AS n FROM contracts WHERE status = 'offered'`).get() as { n: number }).n
  }

  acceptContract(id: number, day: number): void {
    this
      .sql(`UPDATE contracts SET status = 'active', accepted_day = @day, due_day = @day + lead_days WHERE id = @id`)
      .run({ id, day })
  }

  setContractStatus(id: number, status: ContractStatus): void {
    this.sql('UPDATE contracts SET status = ? WHERE id = ?').run(status, id)
  }

  markMaterialReceived(id: number): void {
    this.sql('UPDATE contracts SET material_received = 1 WHERE id = ?').run(id)
  }

  resolveContract(id: number, status: ContractStatus, day: number, note: string | null = null): void {
    this.sql('UPDATE contracts SET status = ?, resolved_day = ?, note = ? WHERE id = ?').run(status, day, note, id)
  }

  /** Withdraws offers still on the board after their last day. */
  expireOffers(day: number): void {
    this
      .sql(`UPDATE contracts SET status = 'expired', resolved_day = @day WHERE status = 'offered' AND offer_expires_day <= @day`)
      .run({ day })
  }

  // --- Properties --------------------------------------------------------------------------------------

  getProperties(): Property[] {
    return this
      .sql(
        `SELECT id, type, tenure, price_paid AS pricePaid, acquired_day AS acquiredDay FROM properties
         WHERE released_day IS NULL ORDER BY id`,
      )
      .all() as Property[]
  }

  addProperty(type: PropertyType, tenure: Tenure, pricePaid: number, day: number): number {
    return Number(
      this
        .sql('INSERT INTO properties (type, tenure, price_paid, acquired_day) VALUES (?, ?, ?, ?)')
        .run(type, tenure, pricePaid, day).lastInsertRowid,
    )
  }

  releaseProperty(id: number, day: number): void {
    this.sql('UPDATE properties SET released_day = ? WHERE id = ?').run(day, id)
  }

  // --- Crew --------------------------------------------------------------------------------------------

  getCrew(): CrewRow[] {
    return this.sql('SELECT * FROM crew WHERE fired_day IS NULL ORDER BY id').all() as CrewRow[]
  }

  getCrewMember(id: number): CrewRow | undefined {
    return this.sql('SELECT * FROM crew WHERE id = ? AND fired_day IS NULL').get(id) as CrewRow | undefined
  }

  hireCrew(c: Omit<CrewRow, 'id'>): number {
    return Number(
      this
        .sql('INSERT INTO crew (name, role, daily_wage, severance_multiplier, hired_day) VALUES (?, ?, ?, ?, ?)')
        .run(c.name, c.role, c.daily_wage, c.severance_multiplier, c.hired_day).lastInsertRowid,
    )
  }

  fireCrew(id: number, day: number): void {
    this.sql('UPDATE crew SET fired_day = ? WHERE id = ?').run(day, id)
  }

  // --- Vehicles ----------------------------------------------------------------------------------------

  getVehicles(): VehicleRow[] {
    return this.sql('SELECT * FROM vehicles WHERE sold_day IS NULL ORDER BY id').all() as VehicleRow[]
  }

  getVehicle(id: number): VehicleRow | undefined {
    return this.sql('SELECT * FROM vehicles WHERE id = ? AND sold_day IS NULL').get(id) as VehicleRow | undefined
  }

  addVehicle(type: VehicleType, price: number, day: number): number {
    return Number(
      this.sql('INSERT INTO vehicles (type, purchase_price, purchased_day) VALUES (?, ?, ?)').run(type, price, day)
        .lastInsertRowid,
    )
  }

  sellVehicle(id: number, day: number): void {
    this.sql('UPDATE vehicles SET sold_day = ? WHERE id = ?').run(day, id)
  }

  setVehicleCondition(id: number, condition: number): void {
    this.sql('UPDATE vehicles SET condition = ? WHERE id = ?').run(Math.min(100, Math.max(0, condition)), id)
  }

  setVehicleShop(id: number, until: { day: number; minute: number } | null): void {
    this
      .sql('UPDATE vehicles SET shop_until_day = ?, shop_until_minute = ? WHERE id = ?')
      .run(until?.day ?? null, until?.minute ?? null, id)
  }

  countVehicleBreakdown(id: number): void {
    this.sql('UPDATE vehicles SET breakdowns = breakdowns + 1 WHERE id = ?').run(id)
  }

  // --- Trips -------------------------------------------------------------------------------------------

  addTrip(t: NewTrip): number {
    return Number(
      this
        .sql(
          `INSERT INTO trips (kind, vehicle_id, driver_id, species, board_feet, mill, contract_id, goods_cost, fuel_cost,
             drive_minutes, departed_day, departed_minute, leg_ends_day, leg_ends_minute)
           VALUES (@kind, @vehicle_id, @driver_id, @species, @board_feet, @mill, @contract_id, @goods_cost, @fuel_cost,
             @drive_minutes, @departed_day, @departed_minute, @leg_ends_day, @leg_ends_minute)`,
        )
        .run(t).lastInsertRowid,
    )
  }

  /** Trips under way. */
  getOpenTrips(): Trip[] {
    return this
      .sql(`SELECT ${TRIP_COLUMNS} FROM trips WHERE status != 'completed' ORDER BY leg_ends_day, leg_ends_minute, id`)
      .all() as Trip[]
  }

  /** Trips under way, plus those finished on `day`. */
  getTrips(day: number): Trip[] {
    return this
      .sql(
        `SELECT ${TRIP_COLUMNS} FROM trips WHERE status != 'completed' OR completed_day = ?
         ORDER BY status = 'completed', leg_ends_day, leg_ends_minute, id`,
      )
      .all(day) as Trip[]
  }

  setTripLeg(id: number, status: TripStatus, endsAt: { day: number; minute: number }): void {
    this
      .sql('UPDATE trips SET status = ?, leg_ends_day = ?, leg_ends_minute = ? WHERE id = ?')
      .run(status, endsAt.day, endsAt.minute, id)
  }

  /** Records a roadside breakdown: the truck sits until `repairUntil`, and its leg now ends at `legEnds`. */
  breakDownTrip(id: number, repairUntil: { day: number; minute: number }, legEnds: { day: number; minute: number }): void {
    this
      .sql(
        `UPDATE trips SET breakdowns = breakdowns + 1, repair_until_day = ?, repair_until_minute = ?,
           leg_ends_day = ?, leg_ends_minute = ? WHERE id = ?`,
      )
      .run(repairUntil.day, repairUntil.minute, legEnds.day, legEnds.minute, id)
  }

  completeTrip(id: number, day: number, minute: number): void {
    this
      .sql(`UPDATE trips SET status = 'completed', completed_day = ?, completed_minute = ? WHERE id = ?`)
      .run(day, minute, id)
  }

  // --- Production log ----------------------------------------------------------------------------------

  logProduction(day: number, employeeId: number, stainedBf: number, wastedBf: number): void {
    this
      .sql(
        `INSERT INTO production_log (day, employee_id, stained_bf, wasted_bf) VALUES (?, ?, ?, ?)
         ON CONFLICT (day, employee_id) DO UPDATE SET
           stained_bf = stained_bf + excluded.stained_bf,
           wasted_bf = wasted_bf + excluded.wasted_bf`,
      )
      .run(day, employeeId, stainedBf, wastedBf)
  }

  getProductionTotals(day: number): ProductionTotals {
    return this
      .sql(
        `SELECT COALESCE(SUM(stained_bf), 0) AS stainedBf, COALESCE(SUM(wasted_bf), 0) AS wastedBf
         FROM production_log WHERE day = ?`,
      )
      .get(day) as ProductionTotals
  }

  // --- Daily reports -----------------------------------------------------------------------------------

  saveReport(r: DailyReportRow): void {
    this
      .sql(
        `INSERT INTO daily_reports (day, opening_cash, revenue, operating_expenses, capital_spending, overnight_costs,
           ending_cash, stained_bf, wasted_bf, dried_bf, stuck_on_racks_bf, insolvent_nights)
         VALUES (@day, @opening_cash, @revenue, @operating_expenses, @capital_spending, @overnight_costs,
           @ending_cash, @stained_bf, @wasted_bf, @dried_bf, @stuck_on_racks_bf, @insolvent_nights)`,
      )
      .run(r)
  }

  getReport(day: number): EodReport | null {
    const row = this.sql('SELECT * FROM daily_reports WHERE day = ?').get(day) as DailyReportRow | undefined
    return row ? this.toReport(row) : null
  }

  getReportHistory(): EodReport[] {
    const rows = this.sql('SELECT * FROM daily_reports ORDER BY day DESC').all() as DailyReportRow[]
    return rows.map((row) => this.toReport(row))
  }

  private toReport(row: DailyReportRow): EodReport {
    const overnightItems = this
      .sql(`SELECT memo, amount FROM ledger WHERE day = ? AND category = 'overnight' ORDER BY id`)
      .all(row.day) as EodReport['overnightItems']
    return {
      day: row.day,
      openingCash: row.opening_cash,
      revenue: row.revenue,
      operatingExpenses: row.operating_expenses,
      capitalSpending: row.capital_spending,
      overnightItems,
      netChange: row.ending_cash - row.opening_cash,
      endingCash: row.ending_cash,
      insolventNights: row.insolvent_nights,
      production: {
        stainedBf: row.stained_bf,
        wastedBf: row.wasted_bf,
        driedBf: row.dried_bf,
        stuckOnRacksBf: row.stuck_on_racks_bf,
      },
    }
  }

  /** Writes a consistent copy of the whole save to `filePath`, which must not exist yet. */
  copyTo(filePath: string): void {
    this.sql('VACUUM INTO ?').run(filePath)
  }

  close(): void {
    this.db.close()
  }
}
