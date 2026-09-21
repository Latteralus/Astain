import { useState } from 'react'
import { KeyRound, Landmark } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { SpaceBar } from '@/components/SpaceBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatMoney, formatMoneyWhole, formatSqFt } from '@/lib/utils'
import { runAction, useGameStore } from '@/store/gameStore'
import {
  FORKLIFT_COVERAGE_SQFT,
  LEASE_SIGNING_DAYS,
  PROPERTIES,
  PROPERTY_RESALE,
  PROPERTY_TAX_PER_DAY,
  type PropertySpec,
  type PropertyType,
} from '../../electron/rules'
import type { GameState, Property } from '../../electron/types'

function ZoneBadge({ spec }: { spec: PropertySpec }) {
  return spec.zone === 'production' ? <Badge>Production</Badge> : <Badge variant="outline">Storage only</Badge>
}

function nightlyCost(p: Property) {
  const spec = PROPERTIES[p.type]
  return p.tenure === 'lease' ? spec.leasePerDay : p.pricePaid * PROPERTY_TAX_PER_DAY
}

function ReleaseDialog({ property, onClose }: { property: Property | null; onClose: () => void }) {
  const spec = property && PROPERTIES[property.type]
  const selling = property?.tenure === 'own'
  return (
    <Dialog open={!!property} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {selling ? 'Sell' : 'End the lease on'} the {spec?.name.toLowerCase()}?
          </DialogTitle>
          <DialogDescription>
            {selling
              ? `Property sells for ${Math.round(PROPERTY_RESALE * 100)}% of what you paid.`
              : 'The signing fee is not refunded. Rent stops tonight.'}{' '}
            Anything stacked there has to fit elsewhere first.
          </DialogDescription>
        </DialogHeader>
        {selling && property && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm tabular-nums">
            <dt>Paid</dt>
            <dd className="text-right">{formatMoneyWhole(property.pricePaid)}</dd>
            <dt className="font-medium">Sale price</dt>
            <dd className="text-right font-medium">{formatMoneyWhole(property.pricePaid * PROPERTY_RESALE)}</dd>
          </dl>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (property && (await runAction(() => window.api.releaseProperty(property.id)))) onClose()
            }}
          >
            {selling ? 'Sell' : 'End lease'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SitesTable({ game }: { game: GameState }) {
  const [releasing, setReleasing] = useState<Property | null>(null)
  const homeSqFt = game.space.totalSqFt - game.properties.reduce((s, p) => s + (PROPERTIES[p.type].zone === 'production' ? PROPERTIES[p.type].sqFt : 0), 0)

  return (
    <Panel title="Your sites">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Site</TableHead>
            <TableHead>Zoning</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead>Held</TableHead>
            <TableHead className="text-right">Per night</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">Home yard</TableCell>
            <TableCell>
              <Badge>Production</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatSqFt(homeSqFt)}</TableCell>
            <TableCell className="text-muted-foreground">Leased since day 1</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">Rent in fixed costs</TableCell>
            <TableCell />
          </TableRow>
          {game.properties.map((p) => {
            const spec = PROPERTIES[p.type]
            return (
              <TableRow key={p.id}>
                <TableCell className="font-medium">
                  {spec.name} #{p.id}
                </TableCell>
                <TableCell>
                  <ZoneBadge spec={spec} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatSqFt(spec.sqFt)}</TableCell>
                <TableCell className="tabular-nums">
                  {p.tenure === 'own' ? 'Owned' : 'Leased'} since day {p.acquiredDay}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(nightlyCost(p))}
                  <div className="text-xs text-muted-foreground">{p.tenure === 'own' ? 'property tax' : 'rent'}</div>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setReleasing(p)}>
                    {p.tenure === 'own' ? 'Sell' : 'End lease'}
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ReleaseDialog property={releasing} onClose={() => setReleasing(null)} />
    </Panel>
  )
}

export function PropertiesScreen({ game }: { game: GameState }) {
  const setScreen = useGameStore((s) => s.setScreen)
  const { lotSqFt, lotUsableSqFt } = game.space
  const forklifts = game.crew.filter((c) => c.role === 'forklift_driver').length
  const neededForklifts = Math.ceil(lotSqFt / FORKLIFT_COVERAGE_SQFT)

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <SitesTable game={game} />
        <Panel
          title="Space"
          description="Stacked lumber goes to the storage lots first, keeping the production floor clear for machinery."
        >
          <SpaceBar space={game.space} />
          {lotSqFt > 0 && lotUsableSqFt < lotSqFt && (
            <div className="mt-4 rounded-md border border-destructive/40 p-3 text-sm">
              <span className="font-medium text-destructive">{formatSqFt(lotSqFt - lotUsableSqFt)} of lot space is sitting idle.</span>{' '}
              Your {forklifts} forklift driver{forklifts === 1 ? '' : 's'} can work {formatSqFt(lotUsableSqFt)}; the lots need{' '}
              {neededForklifts}.{' '}
              <button className="underline" onClick={() => setScreen('staff')}>
                Hire forklift drivers
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title="Available sites"
        description={`Lease for a signing fee of ${LEASE_SIGNING_DAYS} days' rent, then rent every night. Or buy outright and pay a little property tax. Storage lots need forklift drivers: each one works ${formatSqFt(FORKLIFT_COVERAGE_SQFT)}.`}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {(Object.entries(PROPERTIES) as [PropertyType, PropertySpec][]).map(([type, spec]) => {
            const signing = spec.leasePerDay * LEASE_SIGNING_DAYS
            return (
              <Card key={type} className="gap-3 py-4 shadow-none">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2">
                    {spec.name} <ZoneBadge spec={spec} />
                  </CardTitle>
                  <CardDescription>{spec.description}</CardDescription>
                </CardHeader>
                <CardContent className="px-4">
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="text-right">{formatSqFt(spec.sqFt)}</dd>
                    <dt className="text-muted-foreground">Lease</dt>
                    <dd className="text-right">
                      {formatMoneyWhole(signing)} now + {formatMoneyWhole(spec.leasePerDay)}/night
                    </dd>
                    <dt className="text-muted-foreground">Buy</dt>
                    <dd className="text-right">
                      {formatMoneyWhole(spec.price)} + {formatMoney(spec.price * PROPERTY_TAX_PER_DAY)}/night tax
                    </dd>
                    {spec.zone === 'storage' && (
                      <>
                        <dt className="text-muted-foreground">Forklift drivers to work it</dt>
                        <dd className="text-right">{Math.ceil(spec.sqFt / FORKLIFT_COVERAGE_SQFT)}</dd>
                      </>
                    )}
                  </dl>
                </CardContent>
                <CardFooter className="mt-auto flex justify-end gap-2 px-4">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={game.cash < signing}
                    onClick={() => runAction(() => window.api.acquireProperty(type, 'lease'))}
                  >
                    <KeyRound /> Lease
                  </Button>
                  <Button size="sm" disabled={game.cash < spec.price} onClick={() => runAction(() => window.api.acquireProperty(type, 'own'))}>
                    <Landmark /> Buy
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
