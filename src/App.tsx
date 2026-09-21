import { useEffect, useState, type ReactNode } from 'react'
import { ClockBar } from '@/components/ClockBar'
import { EndOfDayDialog } from '@/components/EndOfDayDialog'
import { Notices } from '@/components/Notices'
import { Sidebar } from '@/components/Sidebar'
import { ContractsScreen } from '@/screens/ContractsScreen'
import { DashboardScreen } from '@/screens/DashboardScreen'
import { FleetScreen } from '@/screens/FleetScreen'
import { InventoryScreen } from '@/screens/InventoryScreen'
import { LedgerScreen } from '@/screens/LedgerScreen'
import { MarketScreen } from '@/screens/MarketScreen'
import { PropertiesScreen } from '@/screens/PropertiesScreen'
import { StaffScreen } from '@/screens/StaffScreen'
import { TitleScreen } from '@/screens/TitleScreen'
import { YardScreen } from '@/screens/YardScreen'
import { useGameStore, type Screen } from '@/store/gameStore'
import type { GameState } from '../electron/types'

const SCREENS: Record<Screen, (props: { game: GameState }) => ReactNode> = {
  dashboard: DashboardScreen,
  contracts: ContractsScreen,
  market: MarketScreen,
  yard: YardScreen,
  inventory: InventoryScreen,
  properties: PropertiesScreen,
  fleet: FleetScreen,
  staff: StaffScreen,
  ledger: LedgerScreen,
}

export default function App() {
  const { game, eodReport, screen, setGame, setEodReport, pushNotice, syncGame, exitToMenu } = useGameStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Picks up a game already loaded in the main process (e.g. after a renderer reload), including one reopened at 8 PM
    // whose eod event fired before this window subscribed. With no game loaded, the title menu shows.
    syncGame().then(() => setReady(true))
    const offState = window.api.onState(setGame)
    const offEod = window.api.onEndOfDay(setEodReport)
    const offNotice = window.api.onNotice((n) => pushNotice(n.tone, n.text))
    return () => {
      offState()
      offEod()
      offNotice()
    }
  }, [setGame, setEodReport, pushNotice, syncGame])

  if (!ready) return <div className="p-8 text-muted-foreground">Loading…</div>
  if (!game) {
    return (
      <>
        <TitleScreen />
        <Notices />
      </>
    )
  }

  async function startNextDay() {
    setGame(await window.api.startNextDay())
    setEodReport(null)
  }

  const ActiveScreen = SCREENS[screen]

  return (
    <div className="flex h-screen">
      <Sidebar game={game} />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <ClockBar game={game} />
        <ActiveScreen game={game} />
      </main>
      <EndOfDayDialog open={game.phase === 'eod'} report={eodReport} onNextDay={startNextDay} onExit={exitToMenu} />
      <Notices />
    </div>
  )
}
