import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, formatBf, formatMoney } from '@/lib/utils'
import { INSOLVENCY_GRACE_NIGHTS } from '../../electron/rules'
import type { EodReport } from '../../electron/types'

function Row({ label, amount, strong, indent }: { label: string; amount: number; strong?: boolean; indent?: boolean }) {
  return (
    <>
      <dt className={cn(strong && 'font-medium', indent && 'pl-4 text-muted-foreground')}>{label}</dt>
      <dd className={cn('text-right tabular-nums', strong && 'font-medium', amount < 0 && 'text-destructive')}>
        {formatMoney(amount)}
      </dd>
    </>
  )
}

function Divider() {
  return <div className="col-span-2 my-1 border-t" />
}

/** The bank's position after tonight: nothing to say, a warning, or foreclosure. */
function SolvencyNotice({ report }: { report: EodReport }) {
  if (report.insolventNights === 0) return null
  if (report.insolventNights >= INSOLVENCY_GRACE_NIGHTS) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
        <div className="font-medium text-destructive">The bank has foreclosed.</div>
        <p className="mt-1 text-muted-foreground">
          The company closed {INSOLVENCY_GRACE_NIGHTS} nights in a row overdrawn. The yard, the stock and the trucks go to
          the creditors. This career is over, but its save stays on the menu to look back on.
        </p>
      </div>
    )
  }
  const left = INSOLVENCY_GRACE_NIGHTS - report.insolventNights
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="font-medium text-destructive">
        Overdrawn: night {report.insolventNights} of {INSOLVENCY_GRACE_NIGHTS}
      </div>
      <p className="mt-1 text-muted-foreground">
        {left === 1
          ? 'Close tomorrow with cash in hand or the bank forecloses.'
          : `The bank forecloses if the company is still overdrawn ${left} more nights running.`}{' '}
        Deliver finished orders, sell a truck or a lot, or cut staff to get back above zero.
      </p>
    </div>
  )
}

export function EndOfDayDialog({
  open,
  report,
  onNextDay,
  onExit,
}: {
  open: boolean
  report: EodReport | null
  onNextDay: () => void
  /** Leaves for the title menu; the game is already saved. */
  onExit: () => void
}) {
  const overnightTotal = report?.overnightItems.reduce((sum, item) => sum + item.amount, 0) ?? 0
  const p = report?.production
  const bankrupt = (report?.insolventNights ?? 0) >= INSOLVENCY_GRACE_NIGHTS
  const primary = useRef<HTMLButtonElement>(null)
  // The report can land after the dialog opens and swap "Start Day" for "Back to the menu"; keep focus on the primary.
  useEffect(() => {
    if (open) primary.current?.focus()
  }, [open, bankrupt])

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        // Enter should start the next day (or leave, once bankrupt), not whichever button comes first.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          primary.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{bankrupt ? `Bankrupt on Day ${report?.day}` : `End of Day ${report?.day}`}</DialogTitle>
          <DialogDescription>The yard is closed. Wages and overnight costs have been paid.</DialogDescription>
        </DialogHeader>
        {report && <SolvencyNotice report={report} />}
        {report && p && (
          <>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              <Row label="Opening cash" amount={report.openingCash} />
              <Divider />
              <Row label="Revenue" amount={report.revenue} />
              <Row label="Operating expenses" amount={report.operatingExpenses} />
              {report.capitalSpending !== 0 && <Row label="Capital and financing" amount={report.capitalSpending} />}
              <Row label="Overnight costs" amount={overnightTotal} />
              {report.overnightItems.map((item, i) => (
                <Row key={i} label={item.memo} amount={item.amount} indent />
              ))}
              <Divider />
              <Row label="Net change" amount={report.netChange} strong />
              <Row label="Ending cash" amount={report.endingCash} strong />
            </dl>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 rounded-md bg-muted/50 p-3 text-sm tabular-nums">
              <dt>Stained</dt>
              <dd className="text-right">{formatBf(p.stainedBf)}</dd>
              <dt>Ruined</dt>
              <dd className={cn('text-right', p.wastedBf > 0 && 'text-destructive')}>{formatBf(p.wastedBf)}</dd>
              <dt>Dried and stacked</dt>
              <dd className="text-right">{formatBf(p.driedBf)}</dd>
              {p.stuckOnRacksBf > 0 && (
                <>
                  <dt className="text-destructive">Stuck on racks (no floor space)</dt>
                  <dd className="text-right text-destructive">{formatBf(p.stuckOnRacksBf)}</dd>
                </>
              )}
            </dl>
          </>
        )}
        <DialogFooter>
          <Button ref={bankrupt ? primary : undefined} variant={bankrupt ? 'default' : 'ghost'} onClick={onExit}>
            {bankrupt ? 'Back to the menu' : 'Exit to menu'}
          </Button>
          {!bankrupt && (
            <Button ref={primary} onClick={onNextDay}>
              Start Day {(report?.day ?? 0) + 1}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
