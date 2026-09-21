import { useState } from 'react'
import { formatMoney } from '@/lib/utils'

const W = 300
const H = 72
const PAD_Y = 6

/**
 * One species' daily price as a thin line, with its long-run base price as a dashed reference.
 * Hovering shows the day and price under the cursor.
 */
export function PriceChart({ points, basePrice, label }: { points: { day: number; price: number }[]; basePrice: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) {
    return <div className="flex h-18 items-center text-xs text-muted-foreground">The chart fills in as the days go by.</div>
  }

  const prices = points.map((p) => p.price)
  const lo = Math.min(basePrice, ...prices)
  const hi = Math.max(basePrice, ...prices)
  const span = hi - lo || 1
  const x = (i: number) => (i / (points.length - 1)) * W
  const y = (price: number) => PAD_Y + (1 - (price - lo) / span) * (H - PAD_Y * 2)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join('')
  const active = hover !== null ? points[hover] : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-18 w-full overflow-visible text-foreground"
        role="img"
        aria-label={`${label} price over the last ${points.length} days, from ${formatMoney(prices[0])} to ${formatMoney(prices.at(-1)!)} per board foot`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setHover(Math.round(((e.clientX - rect.left) / rect.width) * (points.length - 1)))
        }}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={0}
          x2={W}
          y1={y(basePrice)}
          y2={y(basePrice)}
          className="stroke-muted-foreground/50"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-border" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* The marker lives outside the stretched SVG so it stays round. */}
      {active && hover !== null && (
        <>
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(active.price) / H) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md border bg-popover px-2 py-0.5 text-xs whitespace-nowrap shadow-sm tabular-nums"
            style={{ left: `${Math.min(85, Math.max(15, (x(hover) / W) * 100))}%` }}
          >
            Day {active.day} · {formatMoney(active.price)}
          </div>
        </>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>Day {points[0].day}</span>
        <span>Dashed: long-run {formatMoney(basePrice)}</span>
        <span>Day {points.at(-1)!.day}</span>
      </div>
    </div>
  )
}
