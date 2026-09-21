import { ShoppingCart } from 'lucide-react'
import { NativeSelect } from '@/components/NativeSelect'
import { Panel } from '@/components/Panel'
import { SpaceBar } from '@/components/SpaceBar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { equipmentLabel } from '@/lib/game'
import { formatBf, formatMoneyWhole, formatPct, formatSqFt } from '@/lib/utils'
import { runAction } from '@/store/gameStore'
import { EQUIPMENT, type EquipmentSpec, type EquipmentType } from '../../electron/rules'
import type { GameState } from '../../electron/types'

function specLine(spec: EquipmentSpec) {
  return spec.kind === 'station'
    ? `Up to ${formatBf(spec.maxBfPerHour)}/h · ${spec.wasteFactor === 1 ? 'full' : `${formatPct(spec.wasteFactor)} of the`} operator's waste`
    : `Holds ${formatBf(spec.capacityBf)} while drying`
}

export function YardScreen({ game }: { game: GameState }) {
  return (
    <div className="space-y-6">
      <Panel
        title="Yard floor"
        description="Available storage is the production floor minus equipment and drying racks. Stacked lumber uses the rest, after any storage lots. Buy a commercial annex on the Real estate screen for more production floor."
      >
        <SpaceBar space={game.space} />
      </Panel>

      <Panel title="Buy equipment">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(Object.entries(EQUIPMENT) as [EquipmentType, EquipmentSpec][]).map(([type, spec]) => {
            const blocked =
              game.cash < spec.price
                ? 'Not enough cash'
                : spec.footprintSqFt > game.space.yardFreeSqFt
                  ? 'No floor space'
                  : null
            return (
              <Card key={type} className="gap-3 py-4 shadow-none">
                <CardHeader className="px-4">
                  <CardTitle>{spec.name}</CardTitle>
                  <CardDescription>{spec.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 px-4 text-sm tabular-nums">
                  <div>{specLine(spec)}</div>
                  <div className="text-muted-foreground">Footprint {formatSqFt(spec.footprintSqFt)}</div>
                </CardContent>
                <CardFooter className="mt-auto flex items-center justify-between px-4">
                  <span className="font-semibold tabular-nums">{formatMoneyWhole(spec.price)}</span>
                  <Button size="sm" disabled={!!blocked} onClick={() => runAction(() => window.api.buyEquipment(type))}>
                    <ShoppingCart /> {blocked ?? 'Buy'}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </Panel>

      <Panel title="Owned equipment">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Capability</TableHead>
              <TableHead className="text-right">Footprint</TableHead>
              <TableHead className="text-right">Bought</TableHead>
              <TableHead>Operator</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {game.equipment.map((item) => {
              const spec = EQUIPMENT[item.type]
              const operator = game.employees.find((e) => e.stationId === item.id)
              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{equipmentLabel(item)}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{specLine(spec)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSqFt(spec.footprintSqFt)}</TableCell>
                  <TableCell className="text-right tabular-nums">Day {item.purchasedDay}</TableCell>
                  <TableCell>
                    {spec.kind === 'station' ? (
                      <NativeSelect
                        aria-label={`Operator for ${equipmentLabel(item)}`}
                        value={operator?.id ?? ''}
                        onChange={(e) => {
                          const id = Number(e.target.value)
                          if (id) runAction(() => window.api.assignStation(id, item.id))
                          else if (operator) runAction(() => window.api.assignStation(operator.id, null))
                        }}
                      >
                        <option value="">Empty</option>
                        {game.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}
