import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as actions from './actions'
import type { DbManager } from './database/dbManager'
import { GameEngine, TICK_MS } from './engine'
import { CAPITALIZATIONS, DAY_START_MINUTE } from './rules'
import { cleanCompanyName, SaveManager } from './saves'
import type { ActionResult } from './types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(APP_ROOT, 'dist')

// Dev-only override to fast-forward testing, e.g. ASTAIN_TICK_MS=50 npm run dev
const tickMs = (VITE_DEV_SERVER_URL && Number(process.env.ASTAIN_TICK_MS)) || TICK_MS

/** How far back the market chart looks. */
const MARKET_HISTORY_DAYS = 30

let win: BrowserWindow | null = null
let saves: SaveManager

/** The career being played. Null while the title menu is showing. */
interface Session {
  id: string
  db: DbManager
  engine: GameEngine
}
let session: Session | null = null

const NO_GAME: ActionResult = { ok: false, error: 'No game is loaded.' }

function requireSession(): Session {
  if (!session) throw new Error('No game is loaded.')
  return session
}

/** Routes a player command to the loaded game's engine. */
function act(command: (db: DbManager) => ActionResult): ActionResult {
  return session ? session.engine.act(command) : NO_GAME
}

function closeSession() {
  if (!session) return
  session.engine.stop()
  session.db.close()
  session = null
}

function startSession(id: string, db: DbManager) {
  closeSession()
  const { day, minute } = db.getCompany()
  const engine = new GameEngine(
    db,
    {
      onState: (state) => win?.webContents.send('game:state', state),
      onEndOfDay: (report) => win?.webContents.send('game:eod', report),
      onNotice: (notice) => win?.webContents.send('game:notice', notice),
    },
    // A new company starts on the clock; a game in progress opens paused so the player can get their bearings.
    { tickMs, startPaused: day > 1 || minute > DAY_START_MINUTE },
  )
  session = { id, db, engine }
  engine.start()
}

/** Runs a save-file operation, turning a thrown error (disk full, locked file) into a message for the player. */
function trySave(what: string, fn: () => void): ActionResult {
  try {
    fn()
    return { ok: true }
  } catch (err) {
    console.error(err)
    return { ok: false, error: `Couldn't ${what}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function registerSaveIpc() {
  ipcMain.handle('saves:list', () => saves.list())
  ipcMain.handle('saves:new', (_e, name, capitalization): ActionResult => {
    const companyName = cleanCompanyName(name)
    if (!companyName) return { ok: false, error: 'Give the company a name.' }
    if (!Object.hasOwn(CAPITALIZATIONS, capitalization)) return { ok: false, error: 'Choose how to finance the company.' }
    return trySave('start the new game', () => {
      closeSession()
      const { id, db } = saves.create({ companyName, capitalization })
      startSession(id, db)
    })
  })
  ipcMain.handle('saves:load', (_e, id): ActionResult => {
    if (!saves.exists(id)) return { ok: false, error: 'That save no longer exists.' }
    if (!saves.summary(id).compatible) return { ok: false, error: "That save can't be opened by this version of AStain." }
    return trySave('load the save', () => {
      closeSession()
      startSession(id, saves.open(id))
    })
  })
  ipcMain.handle('saves:delete', (_e, id): ActionResult => {
    if (!saves.exists(id)) return { ok: false, error: 'That save no longer exists.' }
    if (session?.id === id) return { ok: false, error: 'Exit to the menu before deleting the game in progress.' }
    return trySave('delete the save', () => saves.delete(id))
  })
  ipcMain.handle('saves:copy', (): ActionResult => {
    if (!session) return NO_GAME
    const { db } = session
    return trySave('save a copy', () => void saves.copy(db))
  })
  ipcMain.handle('saves:exit', () => closeSession())
}

function registerGameIpc() {
  ipcMain.handle('game:getState', () => session?.engine.getState() ?? null)
  ipcMain.handle('game:getEodReport', () => session?.engine.getEodReport() ?? null)
  ipcMain.handle('game:pause', () => requireSession().engine.pause())
  ipcMain.handle('game:resume', () => requireSession().engine.resume())
  ipcMain.handle('game:startNextDay', () => requireSession().engine.startNextDay())
  ipcMain.handle('game:getLedger', () => requireSession().db.getLedger())
  ipcMain.handle('game:getReportHistory', () => requireSession().db.getReportHistory())
  ipcMain.handle('game:buyEquipment', (_e, type) => act((db) => actions.buyEquipment(db, type)))
  ipcMain.handle('game:assignStation', (_e, employeeId, equipmentId) =>
    act((db) => actions.assignStation(db, employeeId, equipmentId)),
  )
  ipcMain.handle('game:getMarketHistory', () => {
    const { db } = requireSession()
    const since = db.getCompany().day - MARKET_HISTORY_DAYS + 1
    return { prices: db.getPriceHistory(since), news: db.getNews(since) }
  })
  ipcMain.handle('game:getContractHistory', () => requireSession().db.getContractHistory())
  ipcMain.handle('game:orderLumber', (_e, mill, species, bundles, vehicleId) =>
    act((db) => actions.orderLumber(db, mill, species, bundles, vehicleId ?? null)),
  )
  ipcMain.handle('game:acceptContract', (_e, id) => act((db) => actions.acceptContract(db, id)))
  ipcMain.handle('game:declineContract', (_e, id) => act((db) => actions.declineContract(db, id)))
  ipcMain.handle('game:deliverContract', (_e, id) => act((db) => actions.deliverContract(db, id)))
  ipcMain.handle('game:shipContract', (_e, id, vehicleId) => act((db) => actions.shipContract(db, id, vehicleId)))
  ipcMain.handle('game:postJob', (_e, tier) => act((db) => actions.postJob(db, tier)))
  ipcMain.handle('game:hireCandidate', (_e, id) => act((db) => actions.hireCandidate(db, id)))
  ipcMain.handle('game:fireEmployee', (_e, id) => act((db) => actions.fireEmployee(db, id)))
  ipcMain.handle('game:acquireProperty', (_e, type, tenure) => act((db) => actions.acquireProperty(db, type, tenure)))
  ipcMain.handle('game:releaseProperty', (_e, id) => act((db) => actions.releaseProperty(db, id)))
  ipcMain.handle('game:hireCrew', (_e, role) => act((db) => actions.hireCrew(db, role)))
  ipcMain.handle('game:fireCrew', (_e, id) => act((db) => actions.fireCrew(db, id)))
  ipcMain.handle('game:buyVehicle', (_e, type) => act((db) => actions.buyVehicle(db, type)))
  ipcMain.handle('game:sellVehicle', (_e, id) => act((db) => actions.sellVehicle(db, id)))
  ipcMain.handle('game:serviceVehicle', (_e, id) => act((db) => actions.serviceVehicle(db, id)))
  ipcMain.handle('game:repayLoan', (_e, amount) => act((db) => actions.repayLoan(db, Number(amount))))
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AStain',
    // Matches the dark theme's background, so the window doesn't flash white while the page loads.
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.whenReady().then(() => {
  // Every career is its own file here. The app opens on the title menu; nothing loads until the player picks a save.
  saves = new SaveManager(path.join(app.getPath('userData'), 'saves'))

  registerSaveIpc()
  registerGameIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeSession())
