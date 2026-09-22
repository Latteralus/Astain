import { useEffect, useState } from 'react'
import { Check, PackageCheck, Truck, X } from 'lucide-react'
import { NativeSelect } from '@/components/NativeSelect'
import { Panel } from '@/components/Panel'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  cheapestMill,
  contractCoverage,
  driverFree,
  dueLabel,
  etaLabel,
  outboundProgress,
  projectedFreeSqFt,
  transitProgress,
  tripPlan,
  vehicleCapacityBf,
  vehicleLabel,
  whenLabel,
} from '@/lib/game'
import { cn, formatBf, formatMoney, formatMoneyWhole, formatSqFt } from '@/lib/utils'
import { runAction } from '@/store/gameStore'
import { CONTRACT_KINDS, floorSqFt, SPECIES, vehicleDriveMinutes, VEHICLES } from '../../electron/rules'
import type { Contract, ContractStatus, GameState } from '../../electron/types'

function KindBadge({ contract }: { contract: Contract }) {
  return (
    <Badge variant={contract.kind === 'purchase' ? 'default' : 'outline'} title={CONTRACT_KINDS[contract.kind].description}>
      {CONTRACT_KINDS[contract.kind].name}
    </Badge>
  )
}

function Order({ contract }: { contract: Contract }) {
  return (
    <span className="tabular-nums">
      {formatBf(contract.boardFeet)} {SPECIES[contract.species].name.toLowerCase()}
    </span>
  )
}

/** Payout less the lumber a purchase contract needs, bought at today's cheapest landed mill price. */
function estimatedMargin(game: GameState, c: Contract) {
  if (c.kind === 'toll') return c.payout
  const mill = cheapestMill(game, c.species)
  return mill ? c.payout - c.boardFeet * mill.pricePerBf : null
}

function OffersPanel({ game }: { game: GameState }) {
  const offers = game.contracts.filter((c) => c.status === 'offered')
  const freeSqFt = projectedFreeSqFt(game)

  return (
    <Panel
      title="Offers"
      description="New offers come in each morning and stay on the board for two days. The deadline clock starts when you accept."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Order</TableHead>
            <TableHead className="text-right">Payout</TableHead>
            <TableHead className="text-right" title="Toll: the whole fee. Purchase: payout less lumber at today's cheapest mill.">
              Margin before waste
            </TableHead>
            <TableHead className="text-right">Time allowed</TableHead>
            <TableHead className="text-right">Penalty</TableHead>
            <TableHead>Offer ends</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {offers.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No offers on the board. More arrive tomorrow morning.
              </TableCell>
            </TableRow>
          )}
          {offers.map((c) => {
            const margin = estimatedMargin(game, c)
            const dropoffSqFt = floorSqFt(c.boardFeet)
            const noRoom = c.kind === 'toll' && dropoffSqFt > freeSqFt
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.customer}
                  {noRoom && (
                    <div className="text-xs font-normal text-destructive">
                      Drop-off needs {formatSqFt(dropoffSqFt)}; only {formatSqFt(Math.max(0, freeSqFt))} will be free
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <KindBadge contract={c} />
                </TableCell>
                <TableCell>
                  <Order contract={c} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoneyWhole(c.payout)}
                  <div className="text-xs text-muted-foreground">{formatMoney(c.payout / c.boardFeet)}/bf</div>
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', margin !== null && margin < 0 && 'text-destructive')}>
                  {margin === null ? '—' : formatMoneyWhole(margin)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.leadDays} days</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatMoneyWhole(c.penalty)}
                  {c.kind === 'toll' && <div className="text-xs">+ their lumber</div>}
                </TableCell>
                <TableCell className="tabular-nums">{c.offerExpiresDay === game.day ? 'Today' : `Day ${c.offerExpiresDay}`}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => runAction(() => window.api.acceptContract(c.id))}>
                      <Check /> Accept
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Decline ${c.customer}`}
                      onClick={() => runAction(() => window.api.declineContract(c.id))}
                    >
                      <X />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

interface ActiveStatus {
  text: string
  ready: boolean
  /** Solid part of the bar, 0–100: truck progress, or finished stock. */
  done: number
  /** Lighter part after it, 0–100: wood still drying on the racks. */
  pending: number
}

/** Where an order stands, and what its progress bar shows at that stage. */
function activeStatus(game: GameState, c: Contract, coverage: ReturnType<typeof contractCoverage>): ActiveStatus {
  if (c.status === 'shipping') {
    const trip = game.trips.find((t) => t.contractId === c.id && t.status === 'outbound')
    return {
      text: trip ? `On your truck, arriving ${whenLabel(game, trip.legEndsDay, trip.legEndsMinute)}` : 'On your truck',
      ready: false,
      done: trip ? outboundProgress(game, trip) : 100,
      pending: 0,
    }
  }
  if (c.kind === 'toll' && !c.materialReceived) {
    const truck = game.deliveries.find((d) => d.contractId === c.id && d.status === 'in_transit')
    return truck
      ? { text: `Customer's lumber on the way, arriving ${etaLabel(game, truck)}`, ready: false, done: transitProgress(game, truck), pending: 0 }
      : { text: "Waiting on customer's lumber", ready: false, done: 0, pending: 0 }
  }
  const { finishedBf, dryingBf } = coverage.get(c.id) ?? { finishedBf: 0, dryingBf: 0 }
  const done = (finishedBf / c.boardFeet) * 100
  const pending = (dryingBf / c.boardFeet) * 100
  if (finishedBf + 1e-6 >= c.boardFeet) return { text: 'Ready to deliver', ready: true, done: 100, pending: 0 }
  const short = c.boardFeet - finishedBf - dryingBf
  const name = SPECIES[c.species].name.toLowerCase()
  const parts = [`${formatBf(finishedBf)} finished`]
  if (dryingBf > 0) parts.push(`${formatBf(dryingBf)} drying`)
  if (short > 1e-6) parts.push(`${formatBf(short)} ${name} to stain`)
  return { text: parts.join(' · '), ready: false, done, pending }
}

/** A progress bar with an optional second, lighter segment for work that's under way but not done. */
function StageBar({ done, pending }: { done: number; pending: number }) {
  return (
    <div className="relative flex h-1.5 w-full overflow-hidden rounded-full bg-primary/20" role="progressbar" aria-valuenow={Math.round(done)}>
      <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, done)}%` }} />
      <div className="h-full bg-primary/45 transition-all" style={{ width: `${Math.min(100 - Math.min(100, done), pending)}%` }} />
    </div>
  )
}

/** Picks one of your trucks to deliver the order, for the customer's freight allowance. */
function ShipControl({ game, contract, ready }: { game: GameState; contract: Contract; ready: boolean }) {
  const [pick, setPick] = useState<number | null>(null)
  if (game.vehicles.length === 0) return null
  const fits = game.vehicles.filter((v) => v.status === 'idle' && vehicleCapacityBf(v) >= contract.boardFeet)
  const vehicle = fits.find((v) => v.id === pick) ?? fits[0]
  if (!vehicle) {
    const bigEnough = game.vehicles.some((v) => vehicleCapacityBf(v) >= contract.boardFeet)
    return (
      <div className="text-xs text-muted-foreground">
        {bigEnough ? 'Your trucks are all out' : `No truck in the fleet carries ${formatBf(contract.boardFeet)}`}
      </div>
    )
  }

  const spec = VEHICLES[vehicle.type]
  const { arrive } = tripPlan(game, vehicleDriveMinutes(spec, contract.routeMinutes))
  const late = contract.dueDay !== null && arrive.day > contract.dueDay
  const noDriver = !driverFree(game, spec.license)

  return (
    <div className="space-y-1">
      <div className="flex justify-end gap-1">
        {fits.length > 1 && (
          <NativeSelect aria-label="Truck" value={vehicle.id} onChange={(e) => setPick(Number(e.target.value))}>
            {fits.map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleLabel(v)}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || noDriver}
          title={`${vehicleLabel(vehicle)}: ${formatMoneyWhole(contract.freight)} freight on arrival`}
          onClick={() => runAction(() => window.api.shipContract(contract.id, vehicle.id))}
        >
          <Truck /> Ship +{formatMoneyWhole(contract.freight)}
        </Button>
      </div>
      <div className={cn('text-right text-xs', late || noDriver ? 'text-destructive' : 'text-muted-foreground')}>
        {noDriver
          ? spec.license === 'cdl'
            ? 'No CDL driver free'
            : 'No driver free'
          : `${fits.length === 1 ? `${vehicleLabel(vehicle)} arrives` : 'Arrives'} ${whenLabel(game, arrive.day, arrive.minute)}${late ? ': late, penalty deducted' : ''}`}
      </div>
    </div>
  )
}

function ActivePanel({ game }: { game: GameState }) {
  const active = game.contracts.filter((c) => c.status === 'active' || c.status === 'shipping')
  const coverage = contractCoverage(game)

  return (
    <Panel
      title="Active contracts"
      description="Deliver by 8:00 PM on the due day, or the penalty is charged overnight. Contracts for the same species draw on the same finished stock. The customer can collect the order, or you can ship it in your own truck for freight; a shipment that arrives after the deadline has the penalty deducted."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Order</TableHead>
            <TableHead className="w-64">Progress</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="text-right">Payout</TableHead>
            <TableHead className="text-right">Penalty</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {active.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                No active contracts. Accept an offer to put the yard to work.
              </TableCell>
            </TableRow>
          )}
          {active.map((c) => {
            const status = activeStatus(game, c, coverage)
            const shipping = c.status === 'shipping'
            const dueToday = c.dueDay === game.day && !shipping
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.customer}</TableCell>
                <TableCell>
                  <KindBadge contract={c} />
                </TableCell>
                <TableCell>
                  <Order contract={c} />
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">{status.text}</div>
                    <StageBar done={status.done} pending={status.pending} />
                  </div>
                </TableCell>
                <TableCell className={cn('tabular-nums', dueToday && 'font-medium text-destructive')}>
                  {c.dueDay !== null ? dueLabel(game.day, c.dueDay) : '—'}
                  <div className="text-xs font-normal text-muted-foreground">Day {c.dueDay}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoneyWhole(c.payout)}
                  <div className="text-xs text-muted-foreground">+{formatMoneyWhole(c.freight)} if shipped</div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoneyWhole(c.penalty)}</TableCell>
                <TableCell className="text-right">
                  {shipping ? (
                    <Badge variant="outline">
                      <Truck /> Shipping
                    </Badge>
                  ) : (
                    <div className="space-y-2">
                      <Button size="sm" disabled={!status.ready} onClick={() => runAction(() => window.api.deliverContract(c.id))}>
                        <PackageCheck /> Customer pickup
                      </Button>
                      <ShipControl game={game} contract={c} ready={status.ready} />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

const RESULT: Record<ContractStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  offered: { label: 'Offered', variant: 'outline' },
  active: { label: 'Active', variant: 'outline' },
  shipping: { label: 'Shipping', variant: 'outline' },
  completed: { label: 'Delivered', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'secondary' },
  declined: { label: 'Declined', variant: 'secondary' },
}

function HistoryPanel({ game }: { game: GameState }) {
  const [history, setHistory] = useState<Contract[]>([])
  const openIds = game.contracts.map((c) => c.id).join(',')

  // A contract leaves the open list when it resolves, and the board turns over each day.
  useEffect(() => {
    window.api.getContractHistory().then(setHistory)
  }, [openIds, game.day])

  const taken = history.filter((c) => c.status === 'completed' || c.status === 'failed')

  return (
    <Panel title="History" description={`${taken.filter((c) => c.status === 'completed').length} delivered, ${taken.filter((c) => c.status === 'failed').length} failed.`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Payout</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                Nothing yet.
              </TableCell>
            </TableRow>
          )}
          {history.map((c) => (
            <TableRow key={c.id} className={cn((c.status === 'expired' || c.status === 'declined') && 'text-muted-foreground')}>
              <TableCell className="font-medium">{c.customer}</TableCell>
              <TableCell>
                <KindBadge contract={c} />
              </TableCell>
              <TableCell>
                <Order contract={c} />
              </TableCell>
              <TableCell>
                <Badge variant={RESULT[c.status].variant}>{RESULT[c.status].label}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">Day {c.resolvedDay}</TableCell>
              <TableCell className="text-right tabular-nums">{c.status === 'completed' ? formatMoneyWhole(c.payout) : '—'}</TableCell>
              <TableCell className="text-muted-foreground">{c.note ?? ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

export function ContractsScreen({ game }: { game: GameState }) {
  const active = game.contracts.filter((c) => c.status === 'active' || c.status === 'shipping')
  const offers = game.contracts.filter((c) => c.status === 'offered')
  const dueToday = active.filter((c) => c.status === 'active' && c.dueDay === game.day)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Active contracts" value={String(active.length)} detail={`${formatBf(active.reduce((s, c) => s + c.boardFeet, 0))} to deliver`} />
        <StatCard label="Payout pending" value={formatMoneyWhole(active.reduce((s, c) => s + c.payout, 0))} />
        <StatCard
          label="Due today"
          value={String(dueToday.length)}
          detail={dueToday.length > 0 ? `${formatMoneyWhole(dueToday.reduce((s, c) => s + c.penalty, 0))} in penalties at risk` : undefined}
          negative={dueToday.length > 0}
        />
        <StatCard label="Offers on the board" value={String(offers.length)} />
      </div>
      <ActivePanel game={game} />
      <OffersPanel game={game} />
      <HistoryPanel game={game} />
    </div>
  )
}
