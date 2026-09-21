import { Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deliverySource, etaLabel, transitProgress } from '@/lib/game'
import { formatBf, formatClock, formatMoneyWhole } from '@/lib/utils'
import { SPECIES } from '../../electron/rules'
import type { Delivery, DeliveryStatus, GameState } from '../../electron/types'

const STATUS: Record<DeliveryStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  in_transit: { label: 'On the road', variant: 'outline' },
  delivered: { label: 'Unloaded', variant: 'secondary' },
  refused: { label: 'Turned away', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
}

/** Trucks heading for the yard, plus today's arrivals and refusals. `compact` drops the cost and status columns. */
export function DeliveriesTable({
  game,
  deliveries = game.deliveries,
  compact = false,
}: {
  game: GameState
  deliveries?: Delivery[]
  compact?: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>From</TableHead>
          <TableHead>Load</TableHead>
          {!compact && <TableHead className="text-right">Due on arrival</TableHead>}
          {!compact && <TableHead>Status</TableHead>}
          <TableHead className={compact ? 'w-36' : 'w-48'}>Arrival</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.length === 0 && (
          <TableRow>
            <TableCell colSpan={compact ? 3 : 5} className="text-center text-muted-foreground">
              No trucks on the road.
            </TableCell>
          </TableRow>
        )}
        {deliveries.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <Truck className="size-3.5 text-muted-foreground" />
                {deliverySource(game, d)}
              </span>
            </TableCell>
            <TableCell className="tabular-nums">
              {formatBf(d.boardFeet)} {SPECIES[d.species].name.toLowerCase()}
              {d.kind === 'toll_dropoff' && <span className="text-muted-foreground"> (customer's)</span>}
            </TableCell>
            {!compact && (
              <TableCell className="text-right tabular-nums">{d.goodsCost > 0 ? formatMoneyWhole(d.goodsCost) : '—'}</TableCell>
            )}
            {!compact && (
              <TableCell>
                <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
              </TableCell>
            )}
            <TableCell className="tabular-nums">
              {d.status === 'in_transit' ? (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{etaLabel(game, d)}</div>
                  <Progress value={transitProgress(game, d)} className="h-1.5" />
                </div>
              ) : (
                <span className="text-muted-foreground">{d.resolvedMinute !== null ? formatClock(d.resolvedMinute) : '—'}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
