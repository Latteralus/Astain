// Dark by default. The choice is remembered per install in localStorage, which Electron keeps in the userData folder.
export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'astain.theme'

export function storedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Switches the page's colour tokens (the `.dark` class in index.css) and remembers the choice. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage unavailable: the theme still applies for this session.
  }
}
