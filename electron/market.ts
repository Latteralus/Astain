// Phase 4: the outside economy. Daily lumber prices, contract offers, mill reputation, and the trucks in between.
import type { DbManager, NewContractOffer } from './database/dbManager'
import {
  CONTRACT_BOARD_MAX,
  CONTRACT_KINDS,
  contractLeadDays,
  CUSTOMER_ROUTE_MINUTES,
  CUSTOMERS,
  floorSqFt,
  freightAllowance,
  LUMBER_BUNDLE_BF,
  MILLS,
  millPricePerBf,
  NEW_OFFERS_PER_DAY,
  OFFER_SHELF_DAYS,
  REPUTATION_DECAY_PER_DAY,
  REPUTATION_GRACE_DAYS,
  REPUTATION_PER_BF,
  REPUTATION_REFUSAL_PENALTY,
  reputationDiscount,
  rollMarketDay,
  SPECIES,
  type ContractKind,
  type Species,
} from './rules'
import { spaceSummary } from './simulation'
import type { Contract, Delivery, MillState, Notice } from './types'

type Random = () => number

const bf = (n: number) => `${Math.round(n).toLocaleString('en-US')} bf`
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const pick = <T>(list: readonly T[], random: Random) => list[Math.floor(random() * list.length)]
const between = ([lo, hi]: readonly [number, number], random: Random) => lo + Math.floor(random() * (hi - lo + 1))
const within = ([lo, hi]: readonly [number, number], random: Random) => lo + random() * (hi - lo)
const roundTo = (n: number, step: number) => Math.round(n / step) * step

/** Today's market price for a species. Falls back to the base price if the day somehow hasn't opened. */
export function marketPrice(db: DbManager, species: Species, day = db.getCompany().day): number {
  return db.getPrices(day)[species] ?? SPECIES[species].basePricePerBf
}

export function millStates(db: DbManager): MillState[] {
  const { day } = db.getCompany()
  const prices = db.getPrices(day)
  return db.getMills().map((row) => {
    const spec = MILLS[row.mill]
    return {
      id: row.mill,
      reputation: row.reputation,
      discount: reputationDiscount(row.reputation),
      deliveredBf: row.delivered_bf,
      lastDeliveryDay: row.last_delivery_day,
      prices: Object.fromEntries(
        spec.species.map((s) => [s, millPricePerBf(prices[s] ?? SPECIES[s].basePricePerBf, spec, row.reputation)]),
      ),
    }
  })
}

// --- Contract generation -------------------------------------------------------------------------------

/** Procedurally builds one offer, priced off today's market. */
export function generateOffer(kind: ContractKind, species: Species, price: number, day: number, random: Random): NewContractOffer {
  const spec = CONTRACT_KINDS[kind]
  const boardFeet = between(spec.bundles, random) * LUMBER_BUNDLE_BF
  const rate = within(spec.ratePerBf, random)
  // Toll customers pay for the staining only; purchase customers pay for the wood as well.
  const perBf = kind === 'toll' ? rate : price + rate
  const payout = roundTo(boardFeet * perBf, 10)
  const routeMinutes = roundTo(between(CUSTOMER_ROUTE_MINUTES, random), 5)
  return {
    customer: pick(CUSTOMERS, random),
    kind,
    species,
    board_feet: boardFeet,
    payout,
    penalty: roundTo(payout * spec.penaltyRate, 10),
    offered_day: day,
    offer_expires_day: day + OFFER_SHELF_DAYS - 1,
    lead_days: contractLeadDays(boardFeet, between(spec.slackDays, random)),
    route_minutes: routeMinutes,
    freight: freightAllowance(boardFeet, routeMinutes),
  }
}

function postOffers(db: DbManager, day: number, count: number, random: Random) {
  const room = Math.max(0, CONTRACT_BOARD_MAX - db.countOffers())
  for (let i = 0; i < Math.min(count, room); i++) {
    const kind: ContractKind = random() < 0.5 ? 'toll' : 'purchase'
    // Pine is the everyday fence picket; cedar orders are rarer.
    const species: Species = random() < 0.75 ? 'pine' : 'cedar'
    db.addContractOffer(generateOffer(kind, species, marketPrice(db, species, day), day, random))
  }
}

// --- Day boundaries ------------------------------------------------------------------------------------

/**
 * Opens the morning of `day`: rolls the market and posts new contract offers. Idempotent, since the price rows
 * double as the "already opened" marker, so it is safe to call again after a crash or reload.
 */
export function openDay(db: DbManager, day: number, random: Random = Math.random): void {
  db.transaction(() => {
    if (Object.keys(db.getPrices(day)).length > 0) return
    const { prices, event } = rollMarketDay(db.getPrices(day - 1), random)
    for (const [species, price] of Object.entries(prices)) db.setPrice(day, species as Species, price)
    if (event) db.addNews(day, event.headline)
    // A new company opens to a full board so there's something to take on day one.
    postOffers(db, day, day === 1 ? 3 : between(NEW_OFFERS_PER_DAY, random), random)
  })
}

/**
 * The market's part of closing a day: missed deadlines are penalized, stale offers are withdrawn, and mills you
 * haven't bought from in a while start to forget you. Runs inside closeDay's transaction.
 */
export function settleMarketDay(db: DbManager, day: number): void {
  for (const contract of db.getContracts(['active'])) {
    if (contract.dueDay !== null && contract.dueDay <= day) failContract(db, contract, day, 'Missed the deadline', 'overnight')
  }
  db.expireOffers(day)

  for (const mill of db.getMills()) {
    if (mill.last_delivery_day === null || day - mill.last_delivery_day < REPUTATION_GRACE_DAYS) continue
    if (mill.reputation > 0) db.updateMill({ ...mill, reputation: mill.reputation - REPUTATION_DECAY_PER_DAY })
  }
}

/**
 * Charges the penalty and closes the contract. A toll customer whose lumber is already in the yard is also owed
 * its replacement at today's market price.
 */
function failContract(db: DbManager, contract: Contract, day: number, reason: string, category: 'operating' | 'overnight') {
  let penalty = contract.penalty
  if (contract.kind === 'toll' && contract.materialReceived) {
    penalty += contract.boardFeet * marketPrice(db, contract.species, day)
  }
  db.postTransaction(-penalty, `Contract penalty: ${contract.customer} (${reason.toLowerCase()})`, category)
  db.resolveContract(contract.id, 'failed', day, reason)
  // A drop-off still on the road turns around.
  for (const d of db.getInTransit()) {
    if (d.contractId === contract.id) db.resolveDelivery(d.id, 'cancelled', day, db.getCompany().minute)
  }
}

// --- Delivery state machine ----------------------------------------------------------------------------

function sourceName(d: Delivery, db: DbManager): string {
  if (d.mill) return MILLS[d.mill].name
  return (d.contractId !== null && db.getContract(d.contractId)?.customer) || 'Customer'
}

/**
 * Moves every truck whose ETA has come from in_transit to delivered or refused. A load is refused when the
 * yard floor can't hold it, or (for mill orders, which are cash on delivery) the company can't pay for it.
 * A refused mill load costs the delivery fee already paid and some reputation; a refused toll drop-off fails
 * its contract.
 */
export function processDeliveries(db: DbManager): Notice[] {
  const { day, minute } = db.getCompany()
  const notices: Notice[] = []
  for (const d of db.getArrivals(day, minute)) {
    const source = sourceName(d, db)
    const fits = floorSqFt(d.boardFeet) <= spaceSummary(db).freeSqFt + 1e-6
    const canPay = db.getCompany().cash >= d.goodsCost

    if (fits && canPay) {
      if (d.goodsCost > 0) {
        db.postTransaction(-d.goodsCost, `Lumber: ${bf(d.boardFeet)} ${SPECIES[d.species].name.toLowerCase()} from ${source}`)
      }
      db.adjustInventory(d.species, 'raw', d.boardFeet)
      db.resolveDelivery(d.id, 'delivered', day, minute)
      if (d.mill) {
        const mill = db.getMill(d.mill)!
        db.updateMill({
          ...mill,
          reputation: mill.reputation + d.boardFeet * REPUTATION_PER_BF,
          delivered_bf: mill.delivered_bf + d.boardFeet,
          last_delivery_day: day,
        })
      }
      if (d.contractId !== null) db.markMaterialReceived(d.contractId)
      notices.push({ tone: 'info', text: `${source} delivered ${bf(d.boardFeet)} of ${SPECIES[d.species].name.toLowerCase()}.` })
      continue
    }

    db.resolveDelivery(d.id, 'refused', day, minute)
    const reason = fits ? `couldn't pay ${money.format(d.goodsCost)} on delivery` : `no floor space for ${bf(d.boardFeet)}`
    if (d.mill) {
      const mill = db.getMill(d.mill)!
      db.updateMill({ ...mill, reputation: mill.reputation - REPUTATION_REFUSAL_PENALTY })
      notices.push({
        tone: 'warning',
        text: `${source}'s truck was turned away: ${reason}. Delivery fee lost, reputation −${REPUTATION_REFUSAL_PENALTY}.`,
      })
    } else if (d.contractId !== null) {
      const contract = db.getContract(d.contractId)
      if (contract?.status === 'active') failContract(db, contract, day, 'Drop-off refused: no floor space', 'operating')
      notices.push({
        tone: 'warning',
        text: `${source}'s drop-off was turned away: ${reason}. Contract failed, penalty ${money.format(contract?.penalty ?? 0)}.`,
      })
    }
  }
  return notices
}
