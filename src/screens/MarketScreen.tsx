import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Newspaper, ShoppingCart } from 'lucide-react'
import { DeliveriesTable } from '@/components/DeliveriesTable'
import { NativeSelect } from '@/components/NativeSelect'
import { Panel } from '@/components/Panel'
import { PriceChart } from '@/components/PriceChart'
import { TripsTable } from '@/components/TripsTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { driverFree, projectedFreeSqFt, tripPlan, vehicleLabel, whenLabel } from '@/lib/game'
import { formatBf, formatMoney, formatMoneyWhole, formatPct, formatSqFt } from '@/lib/utils'
import { runAction } from '@/store/gameStore'
import {
  floorSqFt,
  LUMBER_BUNDLE_BF,
  MAX_ORDER_BUNDLES,
  MAX_REPUTATION_DISCOUNT,
  MILLS,
  SPECIES,
  tripFuelCost,
  vehicleDriveMinutes,
  VEHICLES,
  type Species,
} from '../../electron/rules'
import type { GameState, MarketHistoryPoint, MarketNews, MarketQuote, MillState } from '../../electron/types'

function Change({ quote }: { quote: MarketQuote }) {
  if (quote.previousPrice === null) return <span className="text-xs text-muted-foreground">Opening price</span>
  const change = (quote.price - quote.previousPrice) / quote.previousPrice
  const Icon = Math.abs(change) < 0.0005 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
      <Icon className="size-3.5" />
      {change > 0 ? '+' : ''}
      {formatPct(change)} since yesterday
    </span>
  )
}

function PricesPanel({ game, history }: { game: GameState; history: MarketHistoryPoint[] }) {
  return (
    <Panel title="Lumber prices" description="Raw lumber trades at a market price that moves every morning and drifts back toward its long-run level.">
      <div className="grid gap-6 md:grid-cols-2">
        {game.market.map((q) => (
          <div key={q.species} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-sm font-medium">{SPECIES[q.species].name}</div>
                <Change quote={q} />
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatMoney(q.price)}
                <span className="text-sm font-normal text-muted-foreground">/bf</span>
              </div>
            </div>
            <PriceChart
              label={SPECIES[q.species].name}
              points={history.filter((p) => p.species === q.species)}
              basePrice={SPECIES[q.species].basePricePerBf}
            />
          </div>
        ))}
      </div>
    </Panel>
  )
}

function MillCard({ game, mill }: { game: GameState; mill: MillState }) {
  const spec = MILLS[mill.id]
  const [species, setSpecies] = useState<Species>(spec.species[0])
  const [bundles, setBundles] = useState(4)
  const [haulWith, setHaulWith] = useState<number | null>(null)

  const parked = game.vehicles.filter((v) => v.status === 'idle')
  // The chosen truck may have left on another run since it was picked.
  const vehicle = parked.find((v) => v.id === haulWith)
  const vspec = vehicle && VEHICLES[vehicle.type]
  const maxBundles = vspec ? vspec.capacityBundles : MAX_ORDER_BUNDLES
  const loadBundles = Math.min(bundles, maxBundles)
  const driveMinutes = vspec ? vehicleDriveMinutes(vspec, spec.haulMinutes) : 0
  const fuel = vspec ? tripFuelCost(vspec, driveMinutes) : 0
  const back = vspec ? tripPlan(game, driveMinutes).back : null

  const pricePerBf = mill.prices[species] ?? 0
  const orderBf = loadBundles * LUMBER_BUNDLE_BF
  const goods = orderBf * pricePerBf
  const neededSqFt = floorSqFt(orderBf)
  const freeSqFt = projectedFreeSqFt(game)
  const blocked =
    game.cash < goods + (vspec ? fuel : spec.deliveryFee)
      ? 'Not enough cash'
      : vspec && !driverFree(game, vspec.license)
        ? vspec.license === 'cdl' ? 'No CDL driver free' : 'No driver free'
        : null
  const [minH, maxH] = spec.deliveryMinutes.map((m) => m / 60)

  return (
    <Card className="gap-3 py-4 shadow-none">
      <CardHeader className="px-4">
        <CardTitle>{spec.name}</CardTitle>
        <CardDescription>{spec.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground tabular-nums">
            <span>Reputation {Math.floor(mill.reputation)}/100</span>
            <span>
              {formatPct(mill.discount)} off (max {formatPct(MAX_REPUTATION_DISCOUNT)})
            </span>
          </div>
          <Progress value={mill.reputation} className="h-1.5" />
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatBf(mill.deliveredBf)} bought
            {mill.lastDeliveryDay !== null && ` · last delivery day ${mill.lastDeliveryDay}`}
          </div>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 tabular-nums">
          {spec.species.map((s) => (
            <div key={s} className="contents">
              <dt className="text-muted-foreground">{SPECIES[s].name}</dt>
              <dd className="text-right">{formatMoney(mill.prices[s] ?? 0)}/bf</dd>
            </div>
          ))}
          <dt className="text-muted-foreground">Delivery fee</dt>
          <dd className="text-right">{formatMoneyWhole(spec.deliveryFee)}</dd>
          <dt className="text-muted-foreground">Truck time</dt>
          <dd className="text-right">
            {minH}–{maxH} working hours
          </dd>
          <dt className="text-muted-foreground">Own-truck haul</dt>
          <dd className="text-right">
            {Math.round(spec.haulMinutes / 6) / 10}h each way for a pickup
          </dd>
        </dl>
      </CardContent>
      <CardFooter className="mt-auto flex-col items-stretch gap-3 border-t px-4 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Haul with</span>
            <NativeSelect value={vehicle?.id ?? ''} onChange={(e) => setHaulWith(Number(e.target.value) || null)}>
              <option value="">Mill truck</option>
              {parked.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleLabel(v)}
                </option>
              ))}
            </NativeSelect>
          </label>
          {spec.species.length > 1 && (
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Species</span>
              <NativeSelect value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
                {spec.species.map((s) => (
                  <option key={s} value={s}>
                    {SPECIES[s].name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Bundles ({formatBf(LUMBER_BUNDLE_BF)})</span>
            <input
              type="number"
              min={1}
              max={maxBundles}
              value={loadBundles}
              onChange={(e) => setBundles(Math.max(1, Math.min(maxBundles, Math.floor(Number(e.target.value)) || 1)))}
              className="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm tabular-nums shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <Button
            className="ml-auto"
            size="sm"
            disabled={!!blocked}
            onClick={() => runAction(() => window.api.orderLumber(mill.id, species, loadBundles, vehicle?.id ?? null))}
          >
            <ShoppingCart /> {blocked ?? (vehicle ? 'Send truck' : 'Order')}
          </Button>
        </div>
        <div className="text-xs tabular-nums">
          {vehicle && back ? (
            <div>
              {formatBf(orderBf)}: <span className="font-medium">{formatMoneyWhole(goods)}</span> at the mill +{' '}
              <span className="font-medium">{formatMoneyWhole(fuel)}</span> fuel, no delivery fee. Back{' '}
              {whenLabel(game, back.day, back.minute)}.
            </div>
          ) : (
            <div>
              {formatBf(orderBf)}: <span className="font-medium">{formatMoneyWhole(spec.deliveryFee)}</span> fee now,{' '}
              <span className="font-medium">{formatMoneyWhole(goods)}</span> on delivery
            </div>
          )}
          {neededSqFt > freeSqFt ? (
            <div className="text-destructive">
              Needs {formatSqFt(neededSqFt)} of floor; only {formatSqFt(Math.max(0, freeSqFt))} will be free after inbound trucks.{' '}
              {vehicle ? 'Your truck will wait at the gate' : 'It will be turned away'} unless you make room.
            </div>
          ) : (
            <div className="text-muted-foreground">Needs {formatSqFt(neededSqFt)} of floor on arrival</div>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}

function NewsPanel({ news }: { news: MarketNews[] }) {
  if (news.length === 0) return null
  return (
    <Panel title="Market news">
      <ul className="space-y-2 text-sm">
        {news.map((n) => (
          <li key={n.day} className="flex gap-3">
            <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Day {n.day}</span>
            {n.headline}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function MarketScreen({ game }: { game: GameState }) {
  const [history, setHistory] = useState<MarketHistoryPoint[]>([])
  const [news, setNews] = useState<MarketNews[]>([])

  useEffect(() => {
    window.api.getMarketHistory().then((h) => {
      setHistory(h.prices)
      setNews(h.news)
    })
  }, [game.day])

  return (
    <div className="space-y-6">
      {game.headline && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <Newspaper className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{game.headline}</span>
        </div>
      )}

      <PricesPanel game={game} history={history} />

      <Panel
        title="Mills"
        description="Every delivered board foot builds reputation, worth up to 20% off. Go ten days without buying and a mill starts to forget you. Turning a truck away costs reputation and the delivery fee. Send your own truck to skip the fee."
      >
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {game.mills.map((m) => (
            <MillCard key={m.id} game={game} mill={m} />
          ))}
        </div>
      </Panel>

      <Panel
        title="Inbound trucks"
        description="Trucks only drive during working hours. A mill's load that doesn't fit on the floor, or can't be paid for, is turned away at the gate."
      >
        <DeliveriesTable game={game} />
      </Panel>

      {game.vehicles.length > 0 && (
        <Panel title="Your trucks" description="Hauls and deliveries by your own fleet.">
          <TripsTable game={game} compact />
        </Panel>
      )}

      <NewsPanel news={news} />
    </div>
  )
}
