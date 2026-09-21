import { Truck, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tripBackAt, tripDestination, tripProgress, tripRepairing, vehicleLabel, whenLabel } from '@/lib/game'
import { formatBf, formatClock } from '@/lib/utils'
import { SPECIES } from '../../electron/rules'
import type { GameState, Trip } from '../../electron/types'

function stage(game: GameState, t: Trip): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (t.status === 'completed') return { label: 'Back in the yard', variant: 'secondary' }
  if (t.status === 'waiting') return { label: 'Waiting at the gate', variant: 'destructive' }
  if (tripRepairing(game, t)) return { label: 'Broken down', variant: 'destructive' }
  if (t.status === 'returning') return { label: t.kind === 'mill_pickup' ? 'Hauling it home' : 'Heading back', variant: 'default' }
  return { label: t.kind === 'mill_pickup' ? 'Driving to the mill' : 'Out for delivery', variant: 'outline' }
}

/** Runs by the company's own vehicles, today's included. `compact` drops the driver and stage columns. */
export function TripsTable({ game, compact = false }: { game: GameState; compact?: boolean }) {
  const trips = compact ? game.trips.filter((t) => t.status !== 'completed') : game.trips

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vehicle</TableHead>
          {!compact && <TableHead>Driver</TableHead>}
          <TableHead>Run</TableHead>
          {!compact && <TableHead>Stage</TableHead>}
          <TableHead className={compact ? 'w-36' : 'w-48'}>Back at the yard</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trips.length === 0 && (
          <TableRow>
            <TableCell colSpan={compact ? 3 : 5} className="text-center text-muted-foreground">
              {game.vehicles.length === 0 ? 'No vehicles in the fleet.' : 'The whole fleet is parked.'}
            </TableCell>
          </TableRow>
        )}
        {trips.map((t) => {
          const vehicle = game.vehicles.find((v) => v.id === t.vehicleId)
          const driver = game.crew.find((c) => c.id === t.driverId)
          const back = tripBackAt(t)
          const s = stage(game, t)
          const load = `${formatBf(t.boardFeet)} ${SPECIES[t.species].name.toLowerCase()}`
          return (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {tripRepairing(game, t) ? (
                    <Wrench className="size-3.5 text-destructive" />
                  ) : (
                    <Truck className="size-3.5 text-muted-foreground" />
                  )}
                  {vehicle ? vehicleLabel(vehicle) : `Vehicle #${t.vehicleId}`}
                </span>
              </TableCell>
              {!compact && <TableCell>{driver?.name ?? '—'}</TableCell>}
              <TableCell className="tabular-nums">
                {t.kind === 'mill_pickup' ? `Haul ${load} from ` : `Deliver ${load} to `}
                {tripDestination(game, t)}
                {t.breakdowns > 0 && (
                  <span className="text-xs text-destructive">
                    {' '}
                    ({t.breakdowns} breakdown{t.breakdowns === 1 ? '' : 's'})
                  </span>
                )}
              </TableCell>
              {!compact && (
                <TableCell>
                  <Badge variant={s.variant}>{s.label}</Badge>
                </TableCell>
              )}
              <TableCell className="tabular-nums">
                {t.status === 'completed' ? (
                  <span className="text-muted-foreground">{t.completedMinute !== null ? formatClock(t.completedMinute) : '—'}</span>
                ) : t.status === 'waiting' ? (
                  <span className="text-xs text-destructive">Needs floor space to unload</span>
                ) : (
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {tripRepairing(game, t) && `Repair done ${whenLabel(game, t.repairUntilDay!, t.repairUntilMinute!)} · `}
                      {whenLabel(game, back.day, back.minute)}
                    </div>
                    <Progress value={tripProgress(game, t)} className="h-1.5" />
                  </div>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
