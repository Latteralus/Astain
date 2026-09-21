import { useEffect } from 'react'
import { Info, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGameStore, type ToastNotice } from '@/store/gameStore'

const LIFETIME_MS = { info: 5000, warning: 10000, error: 6000 } as const

function NoticeCard({ notice }: { notice: ToastNotice }) {
  const dismiss = useGameStore((s) => s.dismissNotice)

  useEffect(() => {
    const timer = setTimeout(() => dismiss(notice.id), LIFETIME_MS[notice.tone])
    return () => clearTimeout(timer)
  }, [notice, dismiss])

  const Icon = notice.tone === 'info' ? Info : TriangleAlert
  return (
    <div
      role={notice.tone === 'info' ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg',
        notice.tone !== 'info' && 'border-destructive/40',
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', notice.tone === 'info' ? 'text-muted-foreground' : 'text-destructive')} />
      <p className="flex-1">{notice.text}</p>
      <Button size="icon-xs" variant="ghost" onClick={() => dismiss(notice.id)} aria-label="Dismiss">
        <X />
      </Button>
    </div>
  )
}

/** Toasts for rejected actions and for things that happen on their own, like trucks arriving. */
export function Notices() {
  const notices = useGameStore((s) => s.notices)
  if (notices.length === 0) return null
  return (
    <div className="fixed right-6 bottom-6 z-40 flex w-full max-w-md flex-col gap-2">
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  )
}
