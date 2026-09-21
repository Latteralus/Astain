import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useGameStore } from '@/store/gameStore'

/** Flips between dark and light mode. `label` shows the text beside the icon (used in the sidebar). */
export function ThemeToggle({ label = false, className }: { label?: boolean; className?: string }) {
  const theme = useGameStore((s) => s.theme)
  const toggleTheme = useGameStore((s) => s.toggleTheme)
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <Button
      variant="ghost"
      size={label ? 'sm' : 'icon-sm'}
      className={cn(label && 'justify-start text-muted-foreground', className)}
      onClick={toggleTheme}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
      {label && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
    </Button>
  )
}
