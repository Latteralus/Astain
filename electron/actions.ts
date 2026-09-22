// Player commands. Each validates against the authoritative database state; the renderer is never trusted.
import type { DbManager, NewCandidate, VehicleRow } from './database/dbManager'
import { availableDriver, dispatchTrip, vehicleName, vehicleStates } from './fleet'
import { marketPrice } from './market'
import {
  addWorkingMinutes,
  CANDIDATE_SHELF_DAYS,
  CREW_ROLES,
  dailyWage,
  EQUIPMENT,
  EQUIPMENT_RESALE,
  FORKLIFT_COVERAGE_SQFT,
  JOB_POSTINGS,
  LEASE_SIGNING_DAYS,
  LUMBER_BUNDLE_BF,
  MAX_ORDER_BUNDLES,
  MILLS,
  millPricePerBf,
  PROPERTIES,
  PROPERTY_RESALE,
  SERVICE_MINUTES,
  serviceCost,
  SEVERANCE_MULTIPLIER_RANGE,
  SPECIES,
  TOLL_DROPOFF_MINUTES,
  tripFuelCost,
  vehicleDriveMinutes,
  vehicleResale,
  VEHICLES,
  type CrewRole,
  type EquipmentType,
  type JobPostingTier,
  type License,
  type MillId,
  type PropertyType,
  type Species,
  type Tenure,
  type VehicleType,
} from './rules'
import { spaceSummary } from './simulation'
import type { ActionResult, Contract } from './types'

const OK: ActionResult = { ok: true }
const fail = (error: string): ActionResult => ({ ok: false, error })

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const sqft = (n: number) => `${Math.floor(n).toLocaleString('en-US')} sq ft`

function requireCash(db: DbManager, amount: number, what: string): ActionResult | null {
  const { cash } = db.getCompany()
  return cash < amount ? fail(`Not enough cash for ${what}: needs ${money.format(amount)}, you have ${money.format(cash)}.`) : null
}

export function buyEquipment(db: DbManager, type: EquipmentType): ActionResult {
  if (!Object.hasOwn(EQUIPMENT, type)) return fail('Unknown equipment.')
  const spec = EQUIPMENT[type]
  const cashError = requireCash(db, spec.price, `a ${spec.name.toLowerCase()}`)
  if (cashError) return cashError
  // Machinery needs the production floor; storage lots don't count.
  const { yardFreeSqFt } = spaceSummary(db)
  if (spec.footprintSqFt > yardFreeSqFt) {
    return fail(
      `Not enough production floor: a ${spec.name.toLowerCase()} needs ${sqft(spec.footprintSqFt)}, only ${sqft(yardFreeSqFt)} is free.`,
    )
  }
  db.postTransaction(-spec.price, `Purchased ${spec.name.toLowerCase()}`, 'capital')
  db.addEquipment(type, db.getCompany().day)
  return OK
}

/**
 * Sells a station or rack for half its list price. A station's operator is left unassigned; a rack can only go if
 * the wood drying on the racks still fits on the ones that are left.
 */
export function sellEquipment(db: DbManager, equipmentId: number): ActionResult {
  const item = db.getEquipment().find((e) => e.id === equipmentId)
  if (!item) return fail('That equipment is no longer in the yard.')
  const spec = EQUIPMENT[item.type]
  if (spec.kind === 'rack') {
    const { rackUsedBf, rackCapacityBf } = spaceSummary(db)
    const left = rackCapacityBf - spec.capacityBf
    if (rackUsedBf > left + 1e-6) {
      return fail(`Can't sell a drying rack while ${bf(rackUsedBf)} is drying: the other racks only hold ${bf(left)}. Wait for it to dry.`)
    }
  } else {
    const operator = db.getOperator(item.id)
    if (operator) {
      db.setStation(operator.id, null)
      db.setStatus(operator.id, 'unassigned')
    }
  }
  db.postTransaction(Math.round(spec.price * EQUIPMENT_RESALE), `Sold ${spec.name.toLowerCase()}`, 'capital')
  db.removeEquipment(item.id)
  return OK
}

/** Puts a worker on a station (bumping its current operator to unassigned), or takes them off with `null`. */
export function assignStation(db: DbManager, employeeId: number, equipmentId: number | null): ActionResult {
  const employee = db.getEmployee(employeeId)
  if (!employee) return fail('That employee no longer works here.')
  if (equipmentId === null) {
    db.setStation(employeeId, null)
    db.setStatus(employeeId, 'unassigned')
    return OK
  }
  const item = db.getEquipment().find((e) => e.id === equipmentId)
  if (!item || EQUIPMENT[item.type].kind !== 'station') return fail('Workers can only be assigned to a staining station.')
  const current = db.getOperator(equipmentId)
  if (current && current.id !== employeeId) {
    db.setStation(current.id, null)
    db.setStatus(current.id, 'unassigned')
  }
  db.setStation(employeeId, equipmentId)
  return OK
}

const between = ([lo, hi]: readonly [number, number], random: () => number) => lo + Math.floor(random() * (hi - lo + 1))
const bf = (n: number) => `${Math.round(n).toLocaleString('en-US')} bf`

/**
 * Orders raw lumber from a mill. The delivery fee is paid now and the wood cash-on-delivery: the truck reaches
 * the gate 4–6 working hours later and is turned away if the floor can't hold the load or the company can't pay
 * (see processDeliveries). The price is locked in at order time.
 *
 * With a vehicle, one of your own trucks drives out and hauls it instead: no delivery fee, the lumber is paid for
 * at the mill counter, and the truck waits at the gate rather than being turned away (see processTrips).
 */
export function orderLumber(
  db: DbManager,
  millId: MillId,
  species: Species,
  bundles: number,
  vehicleId: number | null = null,
  random = Math.random,
): ActionResult {
  if (!Object.hasOwn(MILLS, millId)) return fail('Unknown mill.')
  const spec = MILLS[millId]
  if (!spec.species.includes(species)) return fail(`${spec.name} doesn't sell ${species}.`)
  if (vehicleId !== null) return haulLumber(db, millId, species, bundles, vehicleId)
  if (!Number.isInteger(bundles) || bundles < 1 || bundles > MAX_ORDER_BUNDLES) {
    return fail(`Orders run from 1 to ${MAX_ORDER_BUNDLES} bundles (one truckload).`)
  }
  const mill = db.getMill(millId)!
  const boardFeet = bundles * LUMBER_BUNDLE_BF
  const goodsCost = Math.round(boardFeet * millPricePerBf(marketPrice(db, species), spec, mill.reputation) * 100) / 100
  const cashError = requireCash(db, goodsCost + spec.deliveryFee, `${bf(boardFeet)} of ${SPECIES[species].name.toLowerCase()}`)
  if (cashError) return cashError

  const { day, minute } = db.getCompany()
  const eta = addWorkingMinutes(day, minute, between(spec.deliveryMinutes, random))
  db.postTransaction(-spec.deliveryFee, `Delivery fee: ${spec.name}`)
  db.addDelivery({
    kind: 'mill_order',
    species,
    board_feet: boardFeet,
    mill: millId,
    contract_id: null,
    goods_cost: goodsCost,
    ordered_day: day,
    ordered_minute: minute,
    eta_day: eta.day,
    eta_minute: eta.minute,
  })
  return OK
}

/** A vehicle that is parked at the yard and ready to go, or the reason it isn't. */
function readyVehicle(db: DbManager, vehicleId: number): VehicleRow | ActionResult {
  const vehicle = db.getVehicle(vehicleId)
  if (!vehicle) return fail('That vehicle is no longer in the fleet.')
  const status = vehicleStates(db).find((v) => v.id === vehicleId)!.status
  if (status === 'in_shop') return fail(`${vehicleName(vehicle)} is in the shop.`)
  if (status !== 'idle') return fail(`${vehicleName(vehicle)} is already out on a run.`)
  return vehicle
}

function noDriver(license: License): ActionResult {
  return fail(license === 'cdl' ? 'No CDL driver is free to take it out.' : 'No driver is free to take it out.')
}

function haulLumber(db: DbManager, millId: MillId, species: Species, bundles: number, vehicleId: number): ActionResult {
  const mill = MILLS[millId]
  const vehicle = readyVehicle(db, vehicleId)
  if ('ok' in vehicle) return vehicle
  const spec = VEHICLES[vehicle.type]
  if (!Number.isInteger(bundles) || bundles < 1 || bundles > spec.capacityBundles) {
    return fail(`A ${spec.name.toLowerCase()} carries 1 to ${spec.capacityBundles} bundles.`)
  }
  const driver = availableDriver(db, spec.license)
  if (!driver) return noDriver(spec.license)

  const boardFeet = bundles * LUMBER_BUNDLE_BF
  const reputation = db.getMill(millId)!.reputation
  const goodsCost = Math.round(boardFeet * millPricePerBf(marketPrice(db, species), mill, reputation) * 100) / 100
  const driveMinutes = vehicleDriveMinutes(spec, mill.haulMinutes)
  const fuelCost = tripFuelCost(spec, driveMinutes)
  const cashError = requireCash(db, goodsCost + fuelCost, `${bf(boardFeet)} of ${SPECIES[species].name.toLowerCase()} and fuel`)
  if (cashError) return cashError

  db.postTransaction(-goodsCost, `Lumber: ${bf(boardFeet)} ${SPECIES[species].name.toLowerCase()} from ${mill.name} (own haul)`)
  dispatchTrip(db, {
    kind: 'mill_pickup',
    vehicle,
    driver,
    species,
    boardFeet,
    mill: millId,
    contractId: null,
    goodsCost,
    fuelCost,
    driveMinutes,
  })
  return OK
}

function openOffer(db: DbManager, contractId: number): Contract | ActionResult {
  const contract = db.getContract(contractId)
  if (!contract || contract.status !== 'offered') return fail('That offer is no longer on the board.')
  return contract
}

/** Takes an offer. A toll customer then sends their lumber over, arriving 1–2 working hours later. */
export function acceptContract(db: DbManager, contractId: number, random = Math.random): ActionResult {
  const contract = openOffer(db, contractId)
  if ('ok' in contract) return contract
  const { day, minute } = db.getCompany()
  db.acceptContract(contract.id, day)
  if (contract.kind === 'toll') {
    const eta = addWorkingMinutes(day, minute, between(TOLL_DROPOFF_MINUTES, random))
    db.addDelivery({
      kind: 'toll_dropoff',
      species: contract.species,
      board_feet: contract.boardFeet,
      mill: null,
      contract_id: contract.id,
      goods_cost: 0,
      ordered_day: day,
      ordered_minute: minute,
      eta_day: eta.day,
      eta_minute: eta.minute,
    })
  }
  return OK
}

export function declineContract(db: DbManager, contractId: number): ActionResult {
  const contract = openOffer(db, contractId)
  if ('ok' in contract) return contract
  db.resolveContract(contract.id, 'declined', db.getCompany().day)
  return OK
}

/** Hands the finished order to the customer's truck and books the payout. */
export function deliverContract(db: DbManager, contractId: number): ActionResult {
  const contract = db.getContract(contractId)
  if (!contract || contract.status !== 'active') return fail('That contract is not open.')
  if (contract.kind === 'toll' && !contract.materialReceived) return fail(`${contract.customer}'s lumber hasn't arrived yet.`)
  const name = SPECIES[contract.species].name.toLowerCase()
  const finished = db.getStock(contract.species, 'finished')
  if (finished + 1e-6 < contract.boardFeet) {
    return fail(`Not enough finished ${name}: the order is ${bf(contract.boardFeet)}, you have ${bf(finished)}.`)
  }
  db.adjustInventory(contract.species, 'finished', -contract.boardFeet)
  db.postTransaction(contract.payout, `Contract: ${contract.customer} (${bf(contract.boardFeet)} ${name})`)
  db.resolveContract(contract.id, 'completed', db.getCompany().day)
  return OK
}

/** Loads a finished order onto one of your trucks. The customer pays payout plus freight when it arrives. */
export function shipContract(db: DbManager, contractId: number, vehicleId: number): ActionResult {
  const contract = db.getContract(contractId)
  if (!contract || contract.status !== 'active') return fail('That contract is not open.')
  if (contract.kind === 'toll' && !contract.materialReceived) return fail(`${contract.customer}'s lumber hasn't arrived yet.`)
  const name = SPECIES[contract.species].name.toLowerCase()
  const finished = db.getStock(contract.species, 'finished')
  if (finished + 1e-6 < contract.boardFeet) {
    return fail(`Not enough finished ${name}: the order is ${bf(contract.boardFeet)}, you have ${bf(finished)}.`)
  }
  const vehicle = readyVehicle(db, vehicleId)
  if ('ok' in vehicle) return vehicle
  const spec = VEHICLES[vehicle.type]
  const capacity = spec.capacityBundles * LUMBER_BUNDLE_BF
  if (contract.boardFeet > capacity) {
    return fail(`The order is ${bf(contract.boardFeet)}; a ${spec.name.toLowerCase()} carries ${bf(capacity)}.`)
  }
  const driver = availableDriver(db, spec.license)
  if (!driver) return noDriver(spec.license)
  const driveMinutes = vehicleDriveMinutes(spec, contract.routeMinutes)
  const fuelCost = tripFuelCost(spec, driveMinutes)
  const cashError = requireCash(db, fuelCost, 'fuel')
  if (cashError) return cashError

  db.adjustInventory(contract.species, 'finished', -contract.boardFeet)
  db.setContractStatus(contract.id, 'shipping')
  dispatchTrip(db, {
    kind: 'contract_delivery',
    vehicle,
    driver,
    species: contract.species,
    boardFeet: contract.boardFeet,
    mill: null,
    contractId: contract.id,
    goodsCost: 0,
    fuelCost,
    driveMinutes,
  })
  return OK
}

const FIRST_NAMES = ['Marcus', 'Tina', 'Ray', 'Luis', 'Janelle', 'Cody', 'Priya', 'Hank', 'Rosa', 'Terrell', 'Amber', 'Wes', 'Keisha', 'Bo', 'Nadia', 'Glen', 'Yolanda', 'Travis', 'Mei', 'Duane']
const LAST_NAMES = ['Hollis', 'Garza', 'Pruitt', 'Okafor', 'Brennan', 'Tran', 'McCall', 'Reyes', 'Lindqvist', 'Boone', 'Castillo', 'Dunn', 'Iverson', 'Patel', 'Crowe', 'Mercer', 'Abbott', 'Ngata']

export function postJob(db: DbManager, tier: JobPostingTier, random = Math.random): ActionResult {
  if (!Object.hasOwn(JOB_POSTINGS, tier)) return fail('Unknown job posting.')
  const posting = JOB_POSTINGS[tier]
  const cashError = requireCash(db, posting.cost, 'the job posting')
  if (cashError) return cashError

  const { day } = db.getCompany()
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  db.postTransaction(-posting.cost, `Job posting: ${posting.name}`)
  for (let i = 0; i < posting.candidates; i++) {
    const speed = between(posting.statRange, random)
    const quality = between(posting.statRange, random)
    const candidate: NewCandidate = {
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      speed,
      quality,
      daily_wage: dailyWage(speed, quality),
      severance_multiplier: between(SEVERANCE_MULTIPLIER_RANGE, random),
      expires_day: day + CANDIDATE_SHELF_DAYS - 1,
    }
    db.addCandidate(candidate)
  }
  return OK
}

export function hireCandidate(db: DbManager, candidateId: number): ActionResult {
  const candidate = db.getCandidate(candidateId)
  if (!candidate) return fail('That applicant has taken another job.')
  db.hire(candidate, db.getCompany().day)
  db.removeCandidate(candidateId)
  return OK
}

export function fireEmployee(db: DbManager, employeeId: number): ActionResult {
  const employee = db.getEmployee(employeeId)
  if (!employee) return fail('That employee no longer works here.')
  const severance = Math.round(employee.daily_wage * employee.severance_multiplier)
  const cashError = requireCash(db, severance, `${employee.name}'s severance`)
  if (cashError) return cashError
  db.postTransaction(-severance, `Severance: ${employee.name}`)
  db.fire(employeeId, db.getCompany().day)
  return OK
}

// --- Financing -----------------------------------------------------------------------------------------

/** Pays down the loan early, capped at what's owed. The nightly installment stays the same, so the loan ends sooner. */
export function repayLoan(db: DbManager, amount: number): ActionResult {
  const { loan_balance: balance } = db.getCompany()
  if (balance <= 0) return fail('There is no loan to repay.')
  if (!Number.isFinite(amount) || amount <= 0) return fail('Enter an amount to repay.')
  const payment = Math.round(Math.min(amount, balance) * 100) / 100
  const cashError = requireCash(db, payment, 'the repayment')
  if (cashError) return cashError
  db.postTransaction(-payment, payment >= balance ? 'Loan repaid in full' : 'Loan repayment', 'capital')
  db.setLoanBalance(balance - payment)
  return OK
}

// --- Real estate ---------------------------------------------------------------------------------------

/** Leases (signing fee now, rent every night) or buys (price now, property tax every night) another site. */
export function acquireProperty(db: DbManager, type: PropertyType, tenure: Tenure): ActionResult {
  if (!Object.hasOwn(PROPERTIES, type)) return fail('Unknown property.')
  if (tenure !== 'lease' && tenure !== 'own') return fail('Lease or buy?')
  const spec = PROPERTIES[type]
  const cost = tenure === 'own' ? spec.price : spec.leasePerDay * LEASE_SIGNING_DAYS
  const cashError = requireCash(db, cost, tenure === 'own' ? `the ${spec.name.toLowerCase()}` : 'the lease signing fee')
  if (cashError) return cashError
  db.postTransaction(-cost, tenure === 'own' ? `Bought ${spec.name.toLowerCase()}` : `Lease signed: ${spec.name.toLowerCase()}`, 'capital')
  db.addProperty(type, tenure, tenure === 'own' ? spec.price : 0, db.getCompany().day)
  return OK
}

/** How much the room for stacked lumber would shrink, or why the site can't be given up. */
function spaceAfterLosing(db: DbManager, lostProductionSqFt: number, lostLotSqFt: number, lostForklifts: number): string | null {
  const s = spaceSummary(db)
  const forklifts = db.getCrew().filter((c) => c.role === 'forklift_driver').length - lostForklifts
  const lotUsable = Math.min(s.lotSqFt - lostLotSqFt, forklifts * FORKLIFT_COVERAGE_SQFT)
  const available = s.availableSqFt - lostProductionSqFt
  const free = s.freeSqFt - lostProductionSqFt - (s.lotUsableSqFt - lotUsable)
  if (available < 0) return `the equipment wouldn't fit: ${sqft(-available)} over.`
  if (free < -1e-6) return `${sqft(-free)} of stacked lumber would have nowhere to go. Use or sell it first.`
  return null
}

/** Ends a lease (no refund) or sells an owned site at a discount. The stock and equipment must still fit afterwards. */
export function releaseProperty(db: DbManager, propertyId: number): ActionResult {
  const property = db.getProperties().find((p) => p.id === propertyId)
  if (!property) return fail('You no longer hold that property.')
  const spec = PROPERTIES[property.type]
  const blocked =
    spec.zone === 'production' ? spaceAfterLosing(db, spec.sqFt, 0, 0) : spaceAfterLosing(db, 0, spec.sqFt, 0)
  if (blocked) return fail(`Can't give up the ${spec.name.toLowerCase()}: ${blocked}`)
  if (property.tenure === 'own') {
    db.postTransaction(Math.round(property.pricePaid * PROPERTY_RESALE), `Sold ${spec.name.toLowerCase()}`, 'capital')
  }
  db.releaseProperty(property.id, db.getCompany().day)
  return OK
}

// --- Crew ----------------------------------------------------------------------------------------------

export function hireCrew(db: DbManager, role: CrewRole, random = Math.random): ActionResult {
  if (!Object.hasOwn(CREW_ROLES, role)) return fail('Unknown role.')
  const spec = CREW_ROLES[role]
  if (spec.maxCount !== undefined && db.getCrew().filter((c) => c.role === role).length >= spec.maxCount) {
    return fail(`You already have a ${spec.name.toLowerCase()}.`)
  }
  const cashError = requireCash(db, spec.hiringFee, 'the hiring fee')
  if (cashError) return cashError
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
  db.postTransaction(-spec.hiringFee, `Hiring fee: ${spec.name.toLowerCase()}`)
  db.hireCrew({
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    role,
    daily_wage: spec.dailyWage,
    severance_multiplier: between(SEVERANCE_MULTIPLIER_RANGE, random),
    hired_day: db.getCompany().day,
  })
  return OK
}

export function fireCrew(db: DbManager, crewId: number): ActionResult {
  const member = db.getCrewMember(crewId)
  if (!member) return fail('They no longer work here.')
  if (db.getOpenTrips().some((t) => t.driverId === crewId)) return fail(`${member.name} is out on a run. Wait until they're back.`)
  if (member.role === 'forklift_driver') {
    const blocked = spaceAfterLosing(db, 0, 0, 1)
    if (blocked) return fail(`Without ${member.name} the storage lots can't be worked: ${blocked}`)
  }
  const severance = Math.round(member.daily_wage * member.severance_multiplier)
  const cashError = requireCash(db, severance, `${member.name}'s severance`)
  if (cashError) return cashError
  db.postTransaction(-severance, `Severance: ${member.name}`)
  db.fireCrew(crewId, db.getCompany().day)
  return OK
}

// --- Fleet ---------------------------------------------------------------------------------------------

export function buyVehicle(db: DbManager, type: VehicleType): ActionResult {
  if (!Object.hasOwn(VEHICLES, type)) return fail('Unknown vehicle.')
  const spec = VEHICLES[type]
  const cashError = requireCash(db, spec.price, `a ${spec.name.toLowerCase()}`)
  if (cashError) return cashError
  db.postTransaction(-spec.price, `Purchased ${spec.name.toLowerCase()}`, 'capital')
  db.addVehicle(type, spec.price, db.getCompany().day)
  return OK
}

export function sellVehicle(db: DbManager, vehicleId: number): ActionResult {
  const vehicle = db.getVehicle(vehicleId)
  if (!vehicle) return fail('That vehicle is no longer in the fleet.')
  const status = vehicleStates(db).find((v) => v.id === vehicleId)!.status
  if (status === 'on_trip' || status === 'broken_down') return fail(`${vehicleName(vehicle)} is out on a run.`)
  const spec = VEHICLES[vehicle.type]
  db.postTransaction(vehicleResale(spec, vehicle.condition), `Sold ${vehicleName(vehicle).toLowerCase()}`, 'capital')
  db.sellVehicle(vehicleId, db.getCompany().day)
  return OK
}

/** Restores condition to 100. The vehicle is off the road for a couple of working hours. */
export function serviceVehicle(db: DbManager, vehicleId: number): ActionResult {
  const vehicle = readyVehicle(db, vehicleId)
  if ('ok' in vehicle) return vehicle
  if (vehicle.condition >= 99.5) return fail(`${vehicleName(vehicle)} is already in top shape.`)
  const cost = serviceCost(VEHICLES[vehicle.type], vehicle.condition)
  const cashError = requireCash(db, cost, 'the service')
  if (cashError) return cashError
  const { day, minute } = db.getCompany()
  db.postTransaction(-cost, `Service: ${vehicleName(vehicle)}`)
  db.setVehicleCondition(vehicle.id, 100)
  db.setVehicleShop(vehicle.id, addWorkingMinutes(day, minute, SERVICE_MINUTES))
  return OK
}
