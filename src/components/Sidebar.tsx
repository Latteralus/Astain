import {
  BookOpen,
  ClipboardList,
  Save,
  LandPlot,
  LayoutDashboard,
  LogOut,
  Package,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { cn, formatMoney } from '@/lib/utils'
import { runAction, useGameStore, type Screen } from '@/store/gameStore'
import { INSOLVENCY_GRACE_NIGHTS } from '../../electron/rules'
import type { GameState } from '../../electron/types'

const NAV: { screen: Screen; label: string; icon: typeof Warehouse }[] = [
  { screen: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { screen: 'contracts', label: 'Contracts', icon: ClipboardList },
  { screen: 'market', label: 'Lumber market', icon: TrendingUp },
  { screen: 'yard', label: 'Yard', icon: Warehouse },
  { screen: 'inventory', label: 'Inventory', icon: Package },
  { screen: 'properties', label: 'Real estate', icon: LandPlot },
  { screen: 'fleet', label: 'Fleet', icon: Truck },
  { screen: 'staff', label: 'Staff', icon: Users },
  { screen: 'ledger', label: 'Ledger', icon: BookOpen },
]

/** Small counts beside a nav item: open offers, mill trucks on the road, or your own trucks out on runs. */
function navCount(game: GameState, screen: Screen): number {
  if (screen === 'contracts') return game.contracts.filter((c) => c.status === 'offered').length
  if (screen === 'market') return game.deliveries.filter((d) => d.status === 'in_transit').length
  if (screen === 'fleet') return game.trips.filter((t) => t.status !== 'completed').length
  return 0
}

export function Sidebar({ game }: { game: GameState }) {
  const { screen, setScreen, exitToMenu, pushNotice } = useGameStore()
  const dueToday = game.contracts.some((c) => c.status === 'active' && c.dueDay === game.day)
  const fleetTrouble =
    game.vehicles.some((v) => v.status === 'broken_down') || game.trips.some((t) => t.status === 'waiting')

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="px-5 py-5">
        <div className="text-lg font-semibold">AStain</div>
        <div className="truncate text-xs text-muted-foreground" title={game.companyName}>
          {game.companyName}
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ screen: target, label, icon: Icon }) => {
          const count = navCount(game, target)
          return (
            <button
              key={target}
              onClick={() => setScreen(target)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                screen === target && 'bg-accent font-medium text-accent-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
              {target === 'contracts' && dueToday && (
                <span className="size-1.5 rounded-full bg-destructive" aria-label="A contract is due today" />
              )}
              {target === 'fleet' && fleetTrouble && (
                <span className="size-1.5 rounded-full bg-destructive" aria-label="A truck is broken down or stuck at the gate" />
              )}
              {count > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto border-t px-5 py-4">
        <div className="text-xs text-muted-foreground">Cash</div>
        <div className={cn('text-xl font-semibold tabular-nums', game.cash < 0 && 'text-destructive')}>
          {formatMoney(game.cash)}
        </div>
        {game.insolventNights > 0 && !game.bankrupt && (
          <div className="mt-1 text-xs font-medium text-destructive">
            Overdrawn {game.insolventNights} of {INSOLVENCY_GRACE_NIGHTS} nights
          </div>
        )}
        {game.bankrupt && <div className="mt-1 text-xs font-medium text-destructive">Bankrupt</div>}
        <div className="mt-3 flex flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-muted-foreground"
            title="The game also saves itself as you play."
            onClick={async () => {
              if (await runAction(() => window.api.saveGame())) pushNotice('info', `${game.companyName} saved.`)
            }}
          >
            <Save /> Save Game
          </Button>
          <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={exitToMenu}>
            <LogOut /> Exit to menu
          </Button>
          <ThemeToggle label />
        </div>
      </div>
    </aside>
  )
}
