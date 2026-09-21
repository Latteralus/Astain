// Career saves: one SQLite file per company in the saves folder. The game writes to its save continuously, so there is
// no "save" step. Loading picks a file, and "save a copy" snapshots the live file under a new name.
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { canOpenVersion, DbManager, type CompanyRow, type NewGameOptions } from './database/dbManager'
import type { SaveSummary } from './types'

/** Save ids come back from the renderer, so they're restricted to names that can't escape the saves folder. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

export const MAX_COMPANY_NAME = 40

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'career'
  )
}

/** The company name as entered, tidied; null if there's nothing usable. */
export function cleanCompanyName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPANY_NAME)
  return clean.length > 0 ? clean : null
}

export class SaveManager {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true })
  }

  isValidId(id: unknown): id is string {
    return typeof id === 'string' && ID_PATTERN.test(id)
  }

  private file(id: string): string {
    if (!this.isValidId(id)) throw new Error(`Invalid save id: ${id}`)
    return path.join(this.dir, `${id}.db`)
  }

  exists(id: string): boolean {
    return this.isValidId(id) && fs.existsSync(this.file(id))
  }

  /** Every career in the saves folder, most recently played first. */
  list(): SaveSummary[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.db') && this.isValidId(f.slice(0, -3)))
      .map((f) => this.summary(f.slice(0, -3)))
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
  }

  summary(id: string): SaveSummary {
    const file = this.file(id)
    // Writes land in the -wal file until SQLite checkpoints, so it's the fresher timestamp while a game is open.
    const lastPlayed = Math.max(
      ...[file, `${file}-wal`].filter((f) => fs.existsSync(f)).map((f) => fs.statSync(f).mtimeMs),
    )
    const base: SaveSummary = {
      id,
      companyName: id,
      day: 0,
      cash: 0,
      capitalization: null,
      bankrupt: false,
      lastPlayed,
      compatible: false,
    }
    let db: Database.Database | undefined
    try {
      db = new Database(file, { fileMustExist: true })
      const version = db.pragma('user_version', { simple: true }) as number
      const row = db.prepare('SELECT * FROM company WHERE id = 1').get() as Partial<CompanyRow> | undefined
      if (!row) return base
      return {
        ...base,
        // Columns added in later schema versions are missing from older saves until they're opened and upgraded.
        companyName: row.name ?? 'AStain Co.',
        day: row.day ?? 1,
        cash: row.cash ?? 0,
        capitalization: row.capitalization ?? 'bootstrapped',
        bankrupt: row.bankrupt_day != null,
        compatible: canOpenVersion(version),
      }
    } catch {
      // Not a database, or damaged: listed so the player can delete it, but it can't be loaded.
      return base
    } finally {
      db?.close()
    }
  }

  /** A fresh id for a new file, based on the company name. */
  private newId(name: string): string {
    const stem = slug(name)
    let id = stem
    for (let n = 2; this.exists(id); n++) id = `${stem}-${n}`
    return id
  }

  create(options: NewGameOptions): { id: string; db: DbManager } {
    const id = this.newId(options.companyName)
    return { id, db: new DbManager(this.file(id), options) }
  }

  open(id: string): DbManager {
    return new DbManager(this.file(id))
  }

  /** Snapshots a live save into a new career file. The copy's company is renamed so the two can be told apart. */
  copy(source: DbManager): SaveSummary {
    const { name, day } = source.getCompany()
    const copyName = `${name} (day ${day})`.slice(0, MAX_COMPANY_NAME)
    const id = this.newId(copyName)
    source.copyTo(this.file(id))
    const db = new Database(this.file(id))
    try {
      db.prepare('UPDATE company SET name = ? WHERE id = 1').run(copyName)
    } finally {
      db.close()
    }
    return this.summary(id)
  }

  /** Deletes a save file for good, along with SQLite's side files and any pre-upgrade backups. */
  delete(id: string): void {
    const file = this.file(id)
    const prefix = `${id}.db`
    for (const f of fs.readdirSync(this.dir)) {
      if (f === prefix || f.startsWith(`${prefix}-`) || f.startsWith(`${prefix}.v`)) fs.rmSync(path.join(this.dir, f))
    }
    if (fs.existsSync(file)) throw new Error(`Could not delete ${file}`)
  }
}
