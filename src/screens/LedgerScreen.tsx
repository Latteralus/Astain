import { useEffect, useState } from 'react'
import { Panel } from '@/components/Panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn, formatBf, formatClock, formatMoney, formatMoneyWhole, formatPct } from '@/lib/utils'
import { runAction } from '@/store/gameStore'
import { loanPayment } from '../../electron/rules'
import type { EodReport, GameState, LedgerCategory, LedgerEntry } from '../../electron/types'

const CATEGORY_LABELS: Record<LedgerCategory, string> = {
  operating: 'Operating',
  capital: 'Capital',
  overnight: 'Overnight',
}

const REPAY_STEPS = [5000, 10000]

function LoanPanel({ game }: { game: GameState }) {
  const tonight = loanPayment(game.loanBalance, game.loanRate, game.loanInstallment)
  const nightsLeft = game.loanInstallment > 0 ? Math.ceil(game.loanBalance / game.loanInstallment) : null
  const closed = game.phase === 'eod'
  return (
    <Panel
      title="Bank loan"
      description="Paid every night, busy or not. Paying down early keeps the nightly installment the same and ends the loan sooner."
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Balance</dt>
          <dt className="text-muted-foreground">Rate</dt>
          <dt className="text-muted-foreground">Tonight</dt>
          <dt className="text-muted-foreground">Paid off in</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoneyWhole(game.loanBalance)}</dd>
          <dd className="text-lg font-semibold tabular-nums">{formatPct(game.loanRate)} APR</dd>
          <dd className="text-lg font-semibold tabular-nums" title="Principal installment plus interest">
            {formatMoney(tonight.principal + tonight.interest)}
          </dd>
          <dd className="text-lg font-semibold tabular-nums">{nightsLeft === null ? '—' : `${nightsLeft} nights`}</dd>
        </dl>
        <div className="flex gap-2">
          {REPAY_STEPS.filter((step) => step < game.loanBalance).map((step) => (
            <Button
              key={step}
              size="sm"
              variant="outline"
              disabled={closed || game.cash < step}
              onClick={() => runAction(() => window.api.repayLoan(step))}
            >
              Repay {formatMoneyWhole(step)}
            </Button>
          ))}
          <Button
            size="sm"
            disabled={closed || game.cash < game.loanBalance}
            onClick={() => runAction(() => window.api.repayLoan(game.loanBalance))}
          >
            Pay it all off
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function Money({ amount, className }: { amount: number; className?: string }) {
  return <span className={cn('tabular-nums', amount < 0 && 'text-destructive', className)}>{formatMoney(amount)}</span>
}

export function LedgerScreen({ game }: { game: GameState }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [history, setHistory] = useState<EodReport[]>([])

  // Every transaction moves cash, so a cash change is the cue to refetch.
  useEffect(() => {
    window.api.getLedger().then(setEntries)
    window.api.getReportHistory().then(setHistory)
  }, [game.cash, game.day])

  return (
    <div className="space-y-6">
      {game.loanBalance > 0 && <LoanPanel game={game} />}
      <Panel title="Daily results" description="One row per closed day.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Operating</TableHead>
              <TableHead className="text-right">Capital</TableHead>
              <TableHead className="text-right">Overnight</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Stained</TableHead>
              <TableHead className="text-right">Ruined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No days closed yet.
                </TableCell>
              </TableRow>
            )}
            {history.map((r) => (
              <TableRow key={r.day}>
                <TableCell className="font-medium">Day {r.day}</TableCell>
                <TableCell className="text-right"><Money amount={r.openingCash} /></TableCell>
                <TableCell className="text-right"><Money amount={r.revenue} /></TableCell>
                <TableCell className="text-right"><Money amount={r.operatingExpenses} /></TableCell>
                <TableCell className="text-right"><Money amount={r.capitalSpending} /></TableCell>
                <TableCell className="text-right">
                  <Money amount={r.overnightItems.reduce((sum, i) => sum + i.amount, 0)} />
                </TableCell>
                <TableCell className="text-right"><Money amount={r.netChange} className="font-medium" /></TableCell>
                <TableCell className="text-right"><Money amount={r.endingCash} /></TableCell>
                <TableCell className="text-right tabular-nums">{formatBf(r.production.stainedBf)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBf(r.production.wastedBf)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Transactions" description="The most recent 500 entries.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No transactions yet.
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  Day {e.day}, {formatClock(e.minute)}
                </TableCell>
                <TableCell>{e.memo}</TableCell>
                <TableCell>
                  <Badge variant="outline">{CATEGORY_LABELS[e.category]}</Badge>
                </TableCell>
                <TableCell className="text-right"><Money amount={e.amount} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  )
}
