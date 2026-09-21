import { Progress } from '@/components/ui/progress'
import { cn, formatBf, formatSqFt } from '@/lib/utils'
import type { SpaceSummary } from '../../electron/types'

interface Segment {
  label: string
  sqFt: number
  className: string
  /** Legend dot, when the bar colour alone wouldn't show against the track. */
  swatch?: string
}

function Bar({ title, summary, total, segments }: { title: string; summary: string; total: number; segments: Segment[] }) {
  const pct = (sqFt: number) => `${total > 0 ? Math.max(0, (sqFt / total) * 100) : 0}%`
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">{summary}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div key={s.label} className={s.className} style={{ width: pct(s.sqFt) }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 tabular-nums">
            <span className={`size-2 rounded-full ${s.swatch ?? s.className}`} />
            {s.label} {formatSqFt(s.sqFt)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The production floor split into stations, racks, stacked lumber and free space; storage lots; and rack fill. */
export function SpaceBar({ space }: { space: SpaceSummary }) {
  const rackFill = space.rackCapacityBf > 0 ? (space.rackUsedBf / space.rackCapacityBf) * 100 : 0
  const yardFree = Math.max(0, space.yardFreeSqFt)
  const lotFree = Math.max(0, space.lotUsableSqFt - space.lotInventorySqFt)
  const lotIdle = space.lotSqFt - space.lotUsableSqFt

  return (
    <div className="space-y-4">
      <Bar
        title="Production floor"
        summary={`${formatSqFt(yardFree)} free of ${formatSqFt(space.totalSqFt)}`}
        total={space.totalSqFt}
        segments={[
          { label: 'Stations', sqFt: space.equipmentSqFt, className: 'bg-foreground/70' },
          { label: 'Drying racks', sqFt: space.rackSqFt, className: 'bg-foreground/45' },
          { label: 'Stacked lumber', sqFt: space.yardInventorySqFt, className: 'bg-foreground/25' },
          { label: 'Free', sqFt: yardFree, className: 'bg-transparent', swatch: 'bg-muted ring-1 ring-border' },
        ]}
      />
      {space.lotSqFt > 0 && (
        <Bar
          title="Storage lots"
          summary={`${formatSqFt(lotFree)} free of ${formatSqFt(space.lotSqFt)}`}
          total={space.lotSqFt}
          segments={[
            { label: 'Stacked lumber', sqFt: space.lotInventorySqFt, className: 'bg-foreground/25' },
            { label: 'Free', sqFt: lotFree, className: 'bg-transparent', swatch: 'bg-muted ring-1 ring-border' },
            ...(lotIdle > 0 ? [{ label: 'No forklift crew', sqFt: lotIdle, className: 'bg-destructive/30' }] : []),
          ]}
        />
      )}
      {space.inboundSqFt > 0 && (
        <div
          className={cn(
            'text-xs tabular-nums',
            space.inboundSqFt > space.freeSqFt ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          Loads on the road will need {formatSqFt(space.inboundSqFt)} when they arrive; {formatSqFt(Math.max(0, space.freeSqFt))} is
          free for lumber.
        </div>
      )}
      <div>
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium">Drying racks</span>
          <span className="text-muted-foreground tabular-nums">
            {formatBf(space.rackUsedBf)} of {formatBf(space.rackCapacityBf)}
          </span>
        </div>
        <Progress value={rackFill} />
      </div>
    </div>
  )
}
