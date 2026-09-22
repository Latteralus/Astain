import { TrendingUp } from 'lucide-react'
import { DeliveriesTable } from '@/components/DeliveriesTable'
import { Panel } from '@/components/Panel'
import { SpaceBar } from '@/components/SpaceBar'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBf, formatSqFt } from '@/lib/utils'
import { useGameStore } from '@/store/gameStore'
import { floorSqFt, SPECIES, type Species } from '../../electron/rules'
import type { GameState, InventoryState } from '../../electron/types'

const STATES: InventoryState[] = ['raw', 'drying', 'finished']

export function InventoryScreen({ game }: { game: GameState }) {
  const setScreen = useGameStore((s) => s.setScreen)

  const bf = (s: Species, state: InventoryState) =>
    game.inventory.find((i) => i.species === s && i.state === state)?.boardFeet ?? 0
  const total = (state: InventoryState) => game.inventory.filter((i) => i.state === state).reduce((sum, i) => sum + i.boardFeet, 0)
  const rows = (Object.keys(SPECIES) as Species[]).filter((s) => STATES.some((state) => bf(s, state) > 0))
  // Finished stock already spoken for by accepted contracts.
  const committed = (s: Species) =>
    game.contracts.filter((c) => c.status === 'active' && c.species === s).reduce((sum, c) => sum + c.boardFeet, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Panel title="Stock" description="Raw and finished lumber sit on the floor. Stained wood dries on the racks for a few hours before it's stacked as finished.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Species</TableHead>
                <TableHead className="text-right">Raw</TableHead>
                <TableHead className="text-right">On racks</TableHead>
                <TableHead className="text-right">Finished</TableHead>
                <TableHead className="text-right">Owed to contracts</TableHead>
                <TableHead className="text-right">Floor used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    The yard is empty.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((s) => (
                <TableRow key={s}>
                  <TableCell className="font-medium">{SPECIES[s].name}</TableCell>
                  {STATES.map((state) => (
                    <TableCell key={state} className="text-right tabular-nums">
                      {formatBf(bf(s, state))}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatBf(committed(s))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSqFt(floorSqFt(bf(s, 'raw') + bf(s, 'finished')))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {STATES.map((state) => (
                  <TableCell key={state} className="text-right tabular-nums">
                    {formatBf(total(state))}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatBf((Object.keys(SPECIES) as Species[]).reduce((sum, s) => sum + committed(s), 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatSqFt(game.space.inventorySqFt)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Panel>

        <Panel title="Space">
          <SpaceBar space={game.space} />
        </Panel>
      </div>

      <Panel
        title="Inbound trucks"
        description="Raw lumber comes from the mills, 4–6 working hours after you order. Each load needs its floor space free when it arrives."
        action={
          <Button size="sm" variant="outline" onClick={() => setScreen('market')}>
            <TrendingUp /> Order lumber
          </Button>
        }
      >
        <DeliveriesTable game={game} />
      </Panel>
    </div>
  )
}
