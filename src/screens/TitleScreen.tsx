import { useEffect, useState, type FormEvent } from 'react'
import { Panel } from '@/components/Panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatMoneyWhole, formatPct } from '@/lib/utils'
import { runAction, useGameStore } from '@/store/gameStore'
import { CAPITALIZATIONS, INSOLVENCY_GRACE_NIGHTS, loanPayment, type Capitalization } from '../../electron/rules'
import type { SaveSummary } from '../../electron/types'

const lastPlayedFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

function CapitalizationOption({
  id,
  selected,
  onSelect,
}: {
  id: Capitalization
  selected: boolean
  onSelect: () => void
}) {
  const spec = CAPITALIZATIONS[id]
  const installment = spec.loanTermDays > 0 ? spec.loan / spec.loanTermDays : 0
  const firstNight = loanPayment(spec.loan, spec.loanRate, installment)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{spec.name}</span>
        <span className="text-lg font-semibold tabular-nums">{formatMoneyWhole(spec.cash)}</span>
      </div>
      <p className="text-sm text-muted-foreground">{spec.description}</p>
      <div className="text-xs text-muted-foreground tabular-nums">
        {spec.loan > 0
          ? `${formatMoneyWhole(spec.loan)} loan at ${formatPct(spec.loanRate)} APR, repaid over ${spec.loanTermDays} days: ` +
            `about ${formatMoneyWhole(firstNight.interest + firstNight.principal)} a night at first.`
          : 'No debt.'}
      </div>
    </button>
  )
}

function NewCareer({ onStart }: { onStart: (name: string, capitalization: Capitalization) => Promise<void> }) {
  const [name, setName] = useState('')
  const [capitalization, setCapitalization] = useState<Capitalization>('bootstrapped')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await onStart(name, capitalization)
    setBusy(false)
  }

  return (
    <Panel
      title="New career"
      description={`Fixed costs come due every night. Close ${INSOLVENCY_GRACE_NIGHTS} nights in a row overdrawn and the bank forecloses.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Company name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Cedar Ridge Finishing"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(CAPITALIZATIONS) as Capitalization[]).map((id) => (
            <CapitalizationOption key={id} id={id} selected={capitalization === id} onSelect={() => setCapitalization(id)} />
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            Open the yard
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function SaveList({
  saves,
  onLoad,
  onDelete,
}: {
  saves: SaveSummary[]
  onLoad: (save: SaveSummary) => void
  onDelete: (save: SaveSummary) => void
}) {
  return (
    <Panel title="Careers" description="Every career saves itself as you play.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead className="text-right">Day</TableHead>
            <TableHead className="text-right">Cash</TableHead>
            <TableHead>Financing</TableHead>
            <TableHead>Last played</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {saves.map((save, i) => (
            <TableRow key={save.id}>
              <TableCell className="font-medium">
                <span className="mr-2">{save.companyName}</span>
                {save.bankrupt && <Badge variant="destructive">Bankrupt</Badge>}
                {!save.compatible && <Badge variant="outline">Can't open</Badge>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{save.compatible ? save.day : '—'}</TableCell>
              <TableCell className={cn('text-right tabular-nums', save.cash < 0 && 'text-destructive')}>
                {save.compatible ? formatMoneyWhole(save.cash) : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {save.capitalization ? CAPITALIZATIONS[save.capitalization].name : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{lastPlayedFormat.format(save.lastPlayed)}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant={i === 0 ? 'default' : 'outline'} disabled={!save.compatible} onClick={() => onLoad(save)}>
                    {i === 0 && !save.bankrupt ? 'Continue' : 'Load'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(save)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  )
}

export function TitleScreen() {
  const syncGame = useGameStore((s) => s.syncGame)
  const [saves, setSaves] = useState<SaveSummary[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SaveSummary | null>(null)

  const refresh = () => window.api.listSaves().then(setSaves)
  useEffect(() => {
    refresh()
  }, [])

  async function start(name: string, capitalization: Capitalization) {
    if (await runAction(() => window.api.newGame(name, capitalization))) await syncGame()
  }

  async function load(save: SaveSummary) {
    if (await runAction(() => window.api.loadGame(save.id))) await syncGame()
  }

  async function remove(save: SaveSummary) {
    setConfirmDelete(null)
    await runAction(() => window.api.deleteSave(save.id))
    await refresh()
  }

  return (
    <div className="h-screen overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-12">
        <header>
          <h1 className="text-3xl font-semibold">AStain</h1>
          <p className="text-muted-foreground">Lumber staining &amp; logistics</p>
        </header>
        {saves && saves.length > 0 && <SaveList saves={saves} onLoad={load} onDelete={setConfirmDelete} />}
        {saves && <NewCareer onStart={start} />}
      </div>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.companyName}?</DialogTitle>
            <DialogDescription>
              The whole career is removed from this computer: {confirmDelete?.compatible ? `day ${confirmDelete.day}, ` : ''}
              its ledger and its history. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => confirmDelete && remove(confirmDelete)}>
              Delete career
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
