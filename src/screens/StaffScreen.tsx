import { useState } from 'react'
import { Megaphone, UserMinus, UserPlus } from 'lucide-react'
import { NativeSelect } from '@/components/NativeSelect'
import { Panel } from '@/components/Panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { equipmentLabel, stations, STATUS_LABELS, STATUS_VARIANTS, vehicleLabel, workerOutput } from '@/lib/game'
import { formatBf, formatMoneyWhole, formatPct } from '@/lib/utils'
import { runAction } from '@/store/gameStore'
import {
  CREW_ROLES,
  FORKLIFT_COVERAGE_SQFT,
  JOB_POSTINGS,
  xpRequired,
  type CrewRole,
  type CrewRoleSpec,
  type JobPostingSpec,
  type JobPostingTier,
} from '../../electron/rules'
import type { ActionResult, CrewMember, GameState } from '../../electron/types'

/** Anyone on the payroll who can be let go: a stainer or a crew member. */
interface Firing {
  name: string
  dailyWage: number
  severance: number
  fire: () => Promise<ActionResult>
}

function FireDialog({ employee, cash, onClose }: { employee: Firing | null; cash: number; onClose: () => void }) {
  const short = employee ? employee.severance > cash : false
  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Let {employee?.name} go?</DialogTitle>
          <DialogDescription>
            Severance is due immediately. Keeping an idle worker costs {formatMoneyWhole(employee?.dailyWage ?? 0)} a night;
            letting them go costs {formatMoneyWhole(employee?.severance ?? 0)} today.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm tabular-nums">
          <dt>Daily wage</dt>
          <dd className="text-right">{formatMoneyWhole(employee?.dailyWage ?? 0)}</dd>
          <dt className="font-medium">Severance</dt>
          <dd className="text-right font-medium text-destructive">-{formatMoneyWhole(employee?.severance ?? 0)}</dd>
          <dt>Cash afterwards</dt>
          <dd className="text-right">{formatMoneyWhole(cash - (employee?.severance ?? 0))}</dd>
        </dl>
        {short && <p className="text-sm text-destructive">You can't cover this severance right now.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep them
          </Button>
          <Button
            variant="destructive"
            disabled={short}
            onClick={async () => {
              if (employee && (await runAction(employee.fire))) onClose()
            }}
          >
            <UserMinus /> Pay severance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right tabular-nums">{value}</span>
      <Progress value={value} className="h-1.5 w-14" />
    </div>
  )
}

function crewStatus(game: GameState, c: CrewMember) {
  if (c.tripId !== null) {
    const trip = game.trips.find((t) => t.id === c.tripId)
    const vehicle = trip && game.vehicles.find((v) => v.id === trip.vehicleId)
    return { label: vehicle ? `Driving ${vehicleLabel(vehicle)}` : 'On a run', variant: 'default' as const }
  }
  if (c.role === 'forklift_driver') {
    const needed = Math.ceil(game.space.lotSqFt / FORKLIFT_COVERAGE_SQFT)
    const rank = game.crew.filter((o) => o.role === 'forklift_driver').findIndex((o) => o.id === c.id)
    return rank < needed ? { label: 'Working the lots', variant: 'default' as const } : { label: 'Idle: no lot to work', variant: 'destructive' as const }
  }
  if (c.role === 'logistics_manager') return { label: 'Dispatching', variant: 'default' as const }
  return { label: 'In the yard', variant: 'outline' as const }
}

function CrewPanel({ game, onFire }: { game: GameState; onFire: (f: Firing) => void }) {
  return (
    <Panel
      title="Warehouse & fleet crew"
      description="Crew are hired through an agency at a set wage: the fee is paid up front, wages every night, and severance applies if you let them go."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(Object.entries(CREW_ROLES) as [CrewRole, CrewRoleSpec][]).map(([role, spec]) => {
          const full = spec.maxCount !== undefined && game.crew.filter((c) => c.role === role).length >= spec.maxCount
          return (
            <Card key={role} className="gap-3 py-4 shadow-none">
              <CardHeader className="px-4">
                <CardTitle>{spec.name}</CardTitle>
                <CardDescription>{spec.description}</CardDescription>
              </CardHeader>
              <CardContent className="px-4 text-sm text-muted-foreground tabular-nums">
                {formatMoneyWhole(spec.dailyWage)}/day · {formatMoneyWhole(spec.hiringFee)} to hire
              </CardContent>
              <CardFooter className="mt-auto flex justify-end px-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={full || game.cash < spec.hiringFee}
                  onClick={() => runAction(() => window.api.hireCrew(role))}
                >
                  <UserPlus /> {full ? 'Already on staff' : 'Hire'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <Table className="mt-6">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Hired</TableHead>
            <TableHead className="text-right">Wage</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {game.crew.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No crew yet. Storage lots need forklift drivers; trucks need drivers.
              </TableCell>
            </TableRow>
          )}
          {game.crew.map((c) => {
            const status = crewStatus(game, c)
            return (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{CREW_ROLES[c.role].name}</TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">Day {c.hiredDay}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoneyWhole(c.dailyWage)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={c.tripId !== null}
                    title={c.tripId !== null ? 'Out on a run' : undefined}
                    onClick={() => onFire({ ...c, fire: () => window.api.fireCrew(c.id) })}
                  >
                    Fire
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Panel>
  )
}

export function StaffScreen({ game }: { game: GameState }) {
  const [firing, setFiring] = useState<Firing | null>(null)

  return (
    <div className="space-y-6">
      <Panel title="Stainers" description="Wages are paid every night, whether or not there was work.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Speed</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Station</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead className="text-right">Waste</TableHead>
              <TableHead className="text-right">Wage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {game.employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  Nobody on staff. Post a job below.
                </TableCell>
              </TableRow>
            )}
            {game.employees.map((e) => {
              const output = workerOutput(game, e)
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2" title={`${Math.floor(e.xp)} / ${xpRequired(e.level)} XP`}>
                      <span className="tabular-nums">{e.level}</span>
                      <Progress value={(e.xp / xpRequired(e.level)) * 100} className="h-1.5 w-12" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Stat value={e.speed} />
                  </TableCell>
                  <TableCell>
                    <Stat value={e.quality} />
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Station for ${e.name}`}
                      value={e.stationId ?? ''}
                      onChange={(ev) => {
                        const id = Number(ev.target.value)
                        runAction(() => window.api.assignStation(e.id, id || null))
                      }}
                    >
                      <option value="">Unassigned</option>
                      {stations(game).map((s) => {
                        const holder = game.employees.find((other) => other.stationId === s.id && other.id !== e.id)
                        return (
                          <option key={s.id} value={s.id}>
                            {equipmentLabel(s)}
                            {holder ? ` (replaces ${holder.name})` : ''}
                          </option>
                        )
                      })}
                    </NativeSelect>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{output ? `${formatBf(output.bfPerHour)}/h` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{output ? formatPct(output.waste) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoneyWhole(e.dailyWage)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setFiring({ ...e, fire: () => window.api.fireEmployee(e.id) })}>
                      Fire
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Job market" description="A posting costs money up front and brings in applicants for three days.">
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.entries(JOB_POSTINGS) as [JobPostingTier, JobPostingSpec][]).map(([tier, posting]) => (
            <Card key={tier} className="gap-3 py-4 shadow-none">
              <CardHeader className="px-4">
                <CardTitle>{posting.name}</CardTitle>
                <CardDescription>{posting.description}</CardDescription>
              </CardHeader>
              <CardContent className="px-4 text-sm text-muted-foreground tabular-nums">
                {posting.candidates} applicants · skill {posting.statRange[0]}–{posting.statRange[1]}
              </CardContent>
              <CardFooter className="mt-auto flex items-center justify-between px-4">
                <span className="font-semibold tabular-nums">{formatMoneyWhole(posting.cost)}</span>
                <Button size="sm" variant="outline" disabled={game.cash < posting.cost} onClick={() => runAction(() => window.api.postJob(tier))}>
                  <Megaphone /> Post
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Applicant</TableHead>
              <TableHead>Speed</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead className="text-right">Wage</TableHead>
              <TableHead className="text-right">Available until</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {game.candidates.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No applicants. Post a job to find some.
                </TableCell>
              </TableRow>
            )}
            {game.candidates.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <Stat value={c.speed} />
                </TableCell>
                <TableCell>
                  <Stat value={c.quality} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoneyWhole(c.dailyWage)}/day</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.expiresDay === game.day ? 'Today only' : `Day ${c.expiresDay}`}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" onClick={() => runAction(() => window.api.hireCandidate(c.id))}>
                    <UserPlus /> Hire
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <CrewPanel game={game} onFire={setFiring} />

      <FireDialog employee={firing} cash={game.cash} onClose={() => setFiring(null)} />
    </div>
  )
}
