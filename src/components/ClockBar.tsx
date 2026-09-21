import { Moon, Pause, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatClock } from '@/lib/utils'
import { useGameStore } from '@/store/gameStore'
import { DAY_END_MINUTE, DAY_START_MINUTE, type GameState } from '../../electron/types'

const WORKDAY_MINUTES = DAY_END_MINUTE - DAY_START_MINUTE
const HOUR_MARKS = Array.from({ length: WORKDAY_MINUTES / 60 + 1 }, (_, i) => DAY_START_MINUTE + i * 60)

export function ClockBar({ game }: { game: GameState }) {
  const setGame = useGameStore((s) => s.setGame)
  const dayProgress = ((game.minute - DAY_START_MINUTE) / WORKDAY_MINUTES) * 100
  const minutesLeft = DAY_END_MINUTE - game.minute

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold tabular-nums">{formatClock(game.minute)}</span>
          <Badge variant="secondary">Day {game.day}</Badge>
          {game.phase === 'paused' && <Badge variant="outline">Paused</Badge>}
          {game.phase === 'eod' && (
            <Badge variant="outline">
              <Moon /> Closed for the night
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {game.phase !== 'eod' && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {Math.floor(minutesLeft / 60)}h {minutesLeft % 60}m until close
            </span>
          )}
          {game.phase === 'running' && (
            <Button size="sm" variant="outline" onClick={async () => setGame(await window.api.pause())}>
              <Pause /> Pause
            </Button>
          )}
          {game.phase === 'paused' && (
            <Button size="sm" onClick={async () => setGame(await window.api.resume())}>
              <Play /> Resume
            </Button>
          )}
        </div>
      </div>

      <Progress value={dayProgress} />
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground tabular-nums">
        {HOUR_MARKS.map((m, i) => (
          <span
            key={m}
            className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
            style={{ left: `${(i * 60 * 100) / WORKDAY_MINUTES}%` }}
          >
            {formatClock(m).replace(':00', '')}
          </span>
        ))}
      </div>
    </section>
  )
}
