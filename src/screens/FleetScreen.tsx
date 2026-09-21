import { useState } from 'react'
import { ShoppingCart, Wrench } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { StatCard } from '@/components/StatCard'
import { TripsTable } from '@/components/TripsTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { driverFree, VEHICLE_STATUS, vehicleCapacityBf, vehicleLabel, whenLabel } from '@/lib/game'
import { cn, formatBf, formatMoneyWhole, formatPct } from '@/lib/utils'
import { runAction, useGameStore } from '@/store/gameStore'
import {
  breakdownChancePerMinute,
  CREW_ROLES,
  LUMBER_BUNDLE_BF,
  serviceCost,
  vehicleResale,
  VEHICLES,
  type VehicleSpec,
  type VehicleType,
} from '../../electron/rules'
import type { GameState, Vehicle } from '../../electron/types'

/** Chance of at least one breakdown over a full working day on the road. */
function dailyBreakdownRisk(spec: VehicleSpec, condition: number, manager: boolean) {
  return 1 - (1 - breakdownChancePerMinute(spec, condition, manager)) ** 600
}

function SellDialog({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const spec = vehicle && VEHICLES[vehicle.type]
  const resale = spec ? vehicleResale(spec, vehicle.condition) : 0
  return (
    <Dialog open={!!vehicle} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sell {vehicle && vehicleLabel(vehicle)}?</DialogTitle>
          <DialogDescription>
            Used trucks sell for 40–70% of the sticker price, depending on condition. Its insurance stops tonight.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm tabular-nums">
          <dt>Paid</dt>
          <dd className="text-right">{formatMoneyWhole(vehicle?.purchasePrice ?? 0)}</dd>
          <dt>Condition</dt>
          <dd className="text-right">{Math.round(vehicle?.condition ?? 0)}/100</dd>
          <dt className="font-medium">Sale price</dt>
          <dd className="text-right font-medium">{formatMoneyWhole(resale)}</dd>
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (vehicle && (await runAction(() => window.api.sellVehicle(vehicle.id)))) onClose()
            }}
          >
            Sell for {formatMoneyWhole(resale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Catalog({ game, manager }: { game: GameState; manager: boolean }) {
  return (
    <Panel
      title="Buy vehicles"
      description="Your own trucks skip the mills' delivery fees, and customers pay freight when you deliver their orders. Every vehicle pays insurance nightly, whether it moves or not."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {(Object.entries(VEHICLES) as [VehicleType, VehicleSpec][]).map(([type, spec]) => (
          <Card key={type} className="gap-3 py-4 shadow-none">
            <CardHeader className="px-4">
              <CardTitle>{spec.name}</CardTitle>
              <CardDescription>{spec.description}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
                <dt className="text-muted-foreground">Capacity</dt>
                <dd className="text-right">
                  {spec.capacityBundles} bundles ({formatBf(spec.capacityBundles * LUMBER_BUNDLE_BF)})
                </dd>
                <dt className="text-muted-foreground">Driver</dt>
                <dd className="text-right">{spec.license === 'cdl' ? 'CDL driver' : 'Any driver'}</dd>
                <dt className="text-muted-foreground">Insurance</dt>
                <dd className="text-right">{formatMoneyWhole(spec.insurancePerDay)}/night</dd>
                <dt className="text-muted-foreground">Fuel</dt>
                <dd className="text-right">{formatMoneyWhole(spec.fuelPerHour)}/h on the road</dd>
                <dt className="text-muted-foreground">Speed</dt>
                <dd className="text-right">{spec.speedFactor === 1 ? 'Quickest' : `${formatPct(spec.speedFactor - 1)} slower`}</dd>
                <dt className="text-muted-foreground">Breakdown risk, new</dt>
                <dd className="text-right">{formatPct(dailyBreakdownRisk(spec, 100, manager))}/day driven</dd>
              </dl>
            </CardContent>
            <CardFooter className="mt-auto flex items-center justify-between px-4">
              <span className="font-semibold tabular-nums">{formatMoneyWhole(spec.price)}</span>
              <Button size="sm" disabled={game.cash < spec.price} onClick={() => runAction(() => window.api.buyVehicle(type))}>
                <ShoppingCart /> {game.cash < spec.price ? 'Not enough cash' : 'Buy'}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </Panel>
  )
}

function statusDetail(game: GameState, v: Vehicle) {
  if (v.status === 'in_shop' && v.shopUntilDay !== null) return `Ready ${whenLabel(game, v.shopUntilDay, v.shopUntilMinute!)}`
  if (v.status === 'idle' && !driverFree(game, VEHICLES[v.type].license)) {
    return VEHICLES[v.type].license === 'cdl' ? 'No CDL driver free' : 'No driver free'
  }
  return null
}

function FleetTable({ game, manager }: { game: GameState; manager: boolean }) {
  const [selling, setSelling] = useState<Vehicle | null>(null)

  return (
    <Panel
      title="Your fleet"
      description="Every hour on the road wears a vehicle down, and a worn truck breaks down up to five times as often. A service puts it back to 100."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Vehicle</TableHead>
            <TableHead>Capacity</TableHead>
            <TableHead className="w-40">Condition</TableHead>
            <TableHead className="text-right">Breakdown risk</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {game.vehicles.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No vehicles yet. The mills deliver for a fee until you buy one.
              </TableCell>
            </TableRow>
          )}
          {game.vehicles.map((v) => {
            const spec = VEHICLES[v.type]
            const risk = dailyBreakdownRisk(spec, v.condition, manager)
            const service = serviceCost(spec, v.condition)
            const detail = statusDetail(game, v)
            const canService = v.status === 'idle' && v.condition < 99.5
            return (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  {vehicleLabel(v)}
                  <div className="text-xs font-normal text-muted-foreground tabular-nums">
                    Bought day {v.purchasedDay}
                    {v.breakdowns > 0 && ` · ${v.breakdowns} breakdown${v.breakdowns === 1 ? '' : 's'}`}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{formatBf(vehicleCapacityBf(v))}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className={cn('w-7 text-right tabular-nums', v.condition < 50 && 'text-destructive')}>
                      {Math.floor(v.condition)}
                    </span>
                    <Progress value={v.condition} className="h-1.5 w-20" />
                  </div>
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', risk > 0.15 && 'text-destructive')}>
                  {formatPct(risk)}/day
                </TableCell>
                <TableCell>
                  <Badge variant={VEHICLE_STATUS[v.status].variant}>{VEHICLE_STATUS[v.status].label}</Badge>
                  {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canService || game.cash < service}
                      title={v.condition >= 99.5 ? 'Already in top shape' : undefined}
                      onClick={() => runAction(() => window.api.serviceVehicle(v.id))}
                    >
                      <Wrench /> Service {canService && formatMoneyWhole(service)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={v.status === 'on_trip' || v.status === 'broken_down'}
                      onClick={() => setSelling(v)}
                    >
                      Sell
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <SellDialog vehicle={selling} onClose={() => setSelling(null)} />
    </Panel>
  )
}

export function FleetScreen({ game }: { game: GameState }) {
  const setScreen = useGameStore((s) => s.setScreen)
  const manager = game.crew.some((c) => c.role === 'logistics_manager')
  const drivers = game.crew.filter((c) => CREW_ROLES[c.role].license)
  const onRoad = game.vehicles.filter((v) => v.status === 'on_trip' || v.status === 'broken_down').length
  const insurance = game.vehicles.reduce((sum, v) => sum + VEHICLES[v.type].insurancePerDay, 0)
  const driverWages = drivers.reduce((sum, c) => sum + c.dailyWage, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Vehicles" value={String(game.vehicles.length)} detail={`${onRoad} on the road`} />
        <StatCard
          label="Drivers free"
          value={`${drivers.filter((c) => c.tripId === null).length} of ${drivers.length}`}
          detail={`${drivers.filter((c) => c.role === 'cdl_driver').length} with a CDL`}
        />
        <StatCard label="Fleet cost per night" value={formatMoneyWhole(insurance + driverWages)} detail="Insurance and driver wages" />
        <StatCard
          label="Logistics manager"
          value={manager ? 'On staff' : 'None'}
          detail={manager ? '40% fewer breakdowns, faster repairs' : 'Hire one on the Staff screen'}
        />
      </div>

      <Panel
        title="Runs"
        description="Send trucks from the Lumber market (hauls) and Contracts (deliveries) screens. Trucks only drive during working hours."
        action={
          <button className="text-xs text-muted-foreground underline" onClick={() => setScreen('staff')}>
            Hire drivers
          </button>
        }
      >
        <TripsTable game={game} />
      </Panel>

      <FleetTable game={game} manager={manager} />
      <Catalog game={game} manager={manager} />
    </div>
  )
}
