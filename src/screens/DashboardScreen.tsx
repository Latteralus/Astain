import { DeliveriesTable } from '@/components/DeliveriesTable'
import { TripsTable } from '@/components/TripsTable'
import { Panel } from '@/components/Panel'
import { SpaceBar } from '@/components/SpaceBar'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dueLabel, equipmentLabel, stations, STATUS_LABELS, STATUS_VARIANTS, stock, workerOutput } from '@/lib/game'
import { cn, formatBf, formatMoney, formatMoneyWhole, formatPct } from '@/lib/utils'
import { useGameStore } from '@/store/gameStore'
import { SPECIES } from '../../electron/rules'
import type { GameState } from '../../electron/types'

function ContractsGlance({ game }: { game: GameState }) {
  const setScreen = useGameStore((s) => s.setScreen)
  const active = game.contracts.filter((c) => c.status === 'active' || c.status === 'shipping')
  const offers = game.contracts.filter((c) => c.status === 'offered').length

  return (
    <Panel
      title="Contracts"
      description={offers > 0 ? `${offers} offer${offers === 1 ? '' : 's'} waiting on the board.` : 'No new offers today.'}
      action={
        <button className="text-xs text-muted-foreground underline" onClick={() => setScreen('contracts')}>
          Open contracts
        </button>
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead className="text-right">Payout</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {active.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No active contracts.
              </TableCell>
            </TableRow>
          )}
          {active.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.customer}</TableCell>
              <TableCell className="tabular-nums">
                {formatBf(c.boardFeet)} {SPECIES[c.species].name.toLowerCase()}
              </TableCell>
              <TableCell className={cn(c.status === 'active' && c.dueDay === game.day && 'font-medium text-destructive')}>
                {c.status === 'shipping' ? 'On your truck' : c.dueDay !== null && dueLabel(game.day, c.dueDay)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatMoneyWhole(c.payout)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

export function DashboardScreen({ game }: { game: GameState }) {
  const setScreen = useGameStore((s) => s.setScreen)
  const processed = game.today.stainedBf + game.today.wastedBf
  const wasteRate = processed > 0 ? game.today.wastedBf / processed : 0
  const payroll = game.employees.reduce((sum, e) => sum + e.dailyWage, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Stained today" value={formatBf(game.today.stainedBf)} detail={`${formatBf(game.today.wastedBf)} ruined`} />
        <StatCard label="Waste rate today" value={processed > 0 ? formatPct(wasteRate) : '—'} negative={wasteRate > 0.25} />
        <StatCard label="Raw lumber" value={formatBf(stock(game, 'raw'))} detail={`${formatBf(stock(game, 'finished'))} finished`} />
        <StatCard label="Payroll per night" value={formatMoney(payroll)} detail={`${game.employees.length} on staff`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Panel title="Stations" description="Who is working where, and how well.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Waste</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stations(game).map((station) => {
                const operator = game.employees.find((e) => e.stationId === station.id)
                const output = operator && workerOutput(game, operator)
                return (
                  <TableRow key={station.id}>
                    <TableCell className="font-medium">{equipmentLabel(station)}</TableCell>
                    <TableCell>{operator?.name ?? <span className="text-muted-foreground">Empty</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{output ? `${formatBf(output.bfPerHour)}/h` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{output ? formatPct(output.waste) : '—'}</TableCell>
                    <TableCell>
                      {operator ? (
                        <Badge variant={STATUS_VARIANTS[operator.status]}>{STATUS_LABELS[operator.status]}</Badge>
                      ) : (
                        <button className="text-xs text-muted-foreground underline" onClick={() => setScreen('staff')}>
                          Assign staff
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Panel>

        <Panel title="Space" description="Deliveries and equipment are refused when the floor is full.">
          <SpaceBar space={game.space} />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ContractsGlance game={game} />
        <div className="space-y-6">
          <Panel title="Inbound trucks">
            <DeliveriesTable game={game} deliveries={game.deliveries.filter((d) => d.status === 'in_transit')} compact />
          </Panel>
          {game.vehicles.length > 0 && (
            <Panel
              title="Your trucks"
              action={
                <button className="text-xs text-muted-foreground underline" onClick={() => setScreen('fleet')}>
                  Open fleet
                </button>
              }
            >
              <TripsTable game={game} compact />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
