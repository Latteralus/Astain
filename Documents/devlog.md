# AStain Dev Log

Working notes for whoever picks this up next (mostly Claude). Newest entries at the top of each section.
Read this alongside `Technical.md` (design) and `DevPlan.md` (phase checklist).

---

## Project status

| Phase | State | Notes |
|---|---|---|
| 1. Architecture & Foundation | Complete | |
| 2. Core Time Engine | Complete | |
| 3. Operations & UI Dashboard | Complete | Marked complete 2026-09-21; the code was already there (spatial logic, production math, job market, dashboard). |
| 4. Logistics & Market Dynamics | Complete | |
| 5. Expansion & Fleet Management | Complete | 2026-09-21. See the log entry below. |
| 6. Balancing & Polish | Complete | 2026-09-21. Bankruptcy, capitalization and loan, multi-career saves with migrations, and `npm run sim` balancing harness. See the log entry below. |

The git repo has **no commits yet**; everything is untracked. Don't commit unless asked.

---

## Architecture map (quick orientation)

- `electron/rules.ts`: every constant, catalog and formula. It's pure and has no imports, so the renderer imports it too for previews. Add new tunables here.
- `electron/types.ts`: types shared by the main process and the renderer, including `GameState` and the `GameApi` IPC surface.
- `electron/database/schema.sql` + `dbManager.ts`: SQLite through better-sqlite3. `DbManager` is a thin layer of SQL methods with no game logic in it.
- `electron/engine.ts`: `GameEngine`. `advance()` is one in-game minute (deliveries, then trips, then production). `act()` wraps player commands in a transaction and refuses them during EOD.
- `electron/simulation.ts`: `spaceSummary`, `snapshot` (builds `GameState`), `runProductionMinute`, `closeDay`.
- `electron/market.ts`: prices, contract generation, the mill delivery state machine (`processDeliveries`), overnight contract settlement.
- `electron/fleet.ts` (Phase 5): the trip state machine (`processTrips`), breakdowns, driver and vehicle availability, and overnight crew/fleet/property charges (`chargeExpansionOvernight`).
- `electron/actions.ts`: every player command. Each one validates against the database and never trusts the renderer.
- `electron/saves.ts` (Phase 6): `SaveManager`, one SQLite file per career in `<userData>/saves/<id>.db`. It handles list, create, open, copy (`VACUUM INTO`) and delete. Save ids come from the renderer, so they're checked against a slug pattern (no path traversal).
- `electron/main.ts` / `preload.ts`: IPC wiring. The app opens on the title menu with **no game loaded**. A `session` (id, db, engine) exists only while a career is open, so game handlers go through `act()` / `requireSession()`. **A new action has to be added in four places:** `actions.ts`, the `ipcMain.handle` in `main.ts`, `preload.ts`, and `GameApi` in `types.ts`.
- `scripts/sim/` (Phase 6): the headless balancing harness. `sim.ts` has the scenarios and expectations, `bot.ts` is the scripted player, and `run.mjs` + `vite.config.ts` build and run it. See the tooling notes below.
- `src/`: React + Zustand + shadcn/ui. The screens are in `src/screens`, derived display helpers in `src/lib/game.ts`, and navigation is the `Screen` union in `src/store/gameStore.ts`, `SCREENS` in `App.tsx`, and `NAV` in `Sidebar.tsx`.

Circular imports exist (`simulation` ↔ `market`, `simulation` ↔ `fleet`). They only cross at function level, so they're fine under ESM. Don't add top-level code that runs one of these modules' exports at import time.

---

## Conventions and gotchas

- **Schema changes:** bump `SCHEMA_VERSION` in `dbManager.ts` **and** add a `MIGRATIONS[oldVersion]` entry with the `ALTER TABLE`s that upgrade the previous version. New tables need no migration, because `schema.sql` creates them with `IF NOT EXISTS`. Only changes to existing tables do. Also add any new `company` column to the `NEW_GAME` insert if it needs a non-default value.
  - On open, a save that's behind gets a `<id>.db.v<N>.bak` copy and is then upgraded in place.
  - A save that can't be upgraded (older than v5, or from a newer build) is listed as "Can't open". If something opens it directly, it's set aside as `.bak` and a new game starts.
  - The current version is **6**. v5 is the oldest version that can be upgraded.
- **Solvency:** `closeDay` counts consecutive nights ending with cash < 0 (`company.insolvent_nights`, also stored on each `daily_reports` row). At `INSOLVENCY_GRACE_NIGHTS` (3), `bankrupt_day` is set. After that `startNextDay` does nothing and `act` refuses everything. A bankrupt save reopens on its final EOD screen.
- **Time:** all trip and delivery timing is in *working minutes*, so trucks don't move overnight. Use `addWorkingMinutes`, `workingMinutesBetween` and `isReached` from `rules.ts`. Store moments as `(day, minute)` pairs.
- **Money:** always go through `db.postTransaction(amount, memo, category)`. The category (`operating` / `capital` / `overnight`) feeds the EOD report. Overnight charges have to be posted inside `closeDay`'s transaction.
- **Randomness:** functions take a `random = Math.random` parameter so tests and balancing runs can inject a seeded or forced RNG. For example, `processTrips(db, () => 0)` forces a breakdown with the shortest repair and the cheapest bill.
- **Contract statuses:** `offered → active → (shipping) → completed | failed`, or `expired` / `declined`. `settleMarketDay` only fails `active` contracts past their due day; `shipping` ones settle when the truck arrives. `getContractHistory` excludes offered, active and shipping.
- **Space model:** `freeSqFt` is the room for *lumber* (yard plus usable lot space). `yardFreeSqFt` is the room for *equipment* (production floor only). Use the right one. `inboundSqFt` includes mill trucks and your own hauls.

### Tooling quirks (Windows + Git Bash in this environment)

- **Heredocs containing backticks fail** in the Bash tool ("unexpected EOF while looking for matching `'`"). For TS/JS content with template literals, write the script to the scratchpad with the Write tool, then run it (`python script.py`). Edit and Write are fine for direct file edits.
- better-sqlite3 is compiled for Electron's ABI (`postinstall` runs `electron-builder install-app-deps`). To run backend code headlessly, bundle it with Vite and run it under Electron as Node:
  - A Vite config **outside the project can't `import 'vite'`**, so export a plain object. Set `root` to the project, alias `@electron`, use `build.ssr: <entry>`, mark `better-sqlite3` as external, and put the output inside the project (e.g. `node_modules/.tmp/…`) so `better-sqlite3` resolves.
  - Run it with `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron out.mjs`.
  - `schema.sql?raw` only resolves through Vite, which is why plain `tsx`/`node` doesn't work.
- **Driving the GUI:** Playwright isn't installed. What works:
  - Launch the built app with `./node_modules/electron/dist/electron.exe . --user-data-dir=<scratch> --remote-debugging-port=9222`. Run `npx vite build` first, and unset `ELECTRON_RUN_AS_NODE`.
  - Drive it over CDP with a small Node WebSocket script: `Runtime.evaluate` to click buttons by text, `Page.captureScreenshot` for screenshots.
  - **Always pass `--user-data-dir`.** Otherwise a schema bump sets the user's real save aside.
  - React `<select>`: set the value with the native `HTMLSelectElement.prototype.value` setter, then dispatch a bubbling `change` event.
  - Reloading the page resets React local state, such as the "Haul with" choice.
  - Kill the app afterwards with `taskkill //IM electron.exe //F`.
- `npx tsc -b` is the typecheck. `npx vite build` builds the renderer and Electron bundles. `npm run build` also runs electron-builder, which is slow and not needed to verify changes.
- **`npm run sim`** runs the balancing suite: 10 scenarios × 5 seeds, about 3 minutes. It exits non-zero if an expectation fails.
  - Options: `--only <name>`, `--seeds N`, `--trace <name>` (day-by-day revenue, costs, raw/finished stock, backlog and cash for the first seed).
  - Runs are deterministic: the harness replaces `Math.random` with a seeded PRNG, and every random roll in the engine defaults to `Math.random`.
  - It drives `GameEngine.advance()` directly on a `:memory:` database. Call `engine.stop()` after `startNextDay()`, because that call arms the real-time timer.
  - Run it after any change to `rules.ts` numbers.
- **DbManager caches prepared statements** (`this.sql(...)`). Keep using it for new queries; re-preparing on every call made the simulation 25× slower.
- `GameEngine` events are all optional. With no `onState` listener it skips building a snapshot every minute, which the simulation relies on.
- Heredocs in the Bash tool also break on **apostrophes** inside the body, not just backticks. Write scripts to the scratchpad instead.
- **GUI testing with saves:** seed `<user-data-dir>/saves/` with `.db` files before launch. A mid-day save opens paused, and the title screen lists everything in that folder.

---

## Log

### 2026-09-21: Phase 6, Balancing & Polish

**What was built**
- **Bankruptcy.** Before this, cash could go negative forever, so there was no death spiral to test. Now three consecutive nights closed overdrawn means foreclosure and the career ends.
  - The EOD dialog shows "Overdrawn: night N of 3" with advice, and a foreclosure screen at the end.
  - The sidebar shows the overdraft count under the cash figure.
- **Capitalization** (`CAPITALIZATIONS` in rules, from Technical.md §6):
  - *Bootstrapped*: $50k, no debt.
  - *Bank-backed*: $100k including a $50k loan at 24% APR, repaid in equal nightly installments over 120 days (≈ $450/night at first).
  - EOD lists "Loan interest" and "Loan principal" separately.
  - The Ledger has a loan panel with repay $5k, repay $10k, and pay it all off (`repayLoan`, posted as `capital`). Early repayment keeps the installment the same and ends the loan sooner.
- **Save/load:**
  - A title menu lists careers (company, day, cash, financing, last played, bankrupt / can't-open badges) with Continue/Load/Delete, plus a New career form with a company name and capitalization.
  - In game, the sidebar has *Save a copy* (a checkpoint snapshot named "<company> (day N)"; play continues in the original) and *Exit to menu*, and the EOD dialog also has *Exit to menu*.
  - Saving is continuous (SQLite), so there's no save button. Loading a mid-day game opens paused.
- **Schema v6 with real migrations.** See Conventions above. The old `save1.db` is picked up by the menu like any other save and upgraded when it's opened.
- **Balancing harness** `npm run sim` (`scripts/sim/`). The bot plays like a careful human:
  - It keeps the fastest workers on the biggest stations.
  - It only takes offers it can finish with a spare day, with at most 6 days of work booked.
  - It buys raw lumber just-in-time (2 days ahead, and never past the floor space).
  - It delivers the earliest deadline first.
  - It can use its own trucks.
- **Staining priority (gameplay fix found by the sim):** workers used to stain whichever species had the *deepest pile*, so a cedar order could starve behind a big pine stack with no way for the player to steer it. `stainingOrder()` now puts first the species the earliest-due contract is still short of (counting finished and drying stock), then the rest by pile size. This alone cut the steady bot's missed deadlines from 23 to 6 over 5 seeds.

**Balance changes** (all in `rules.ts`)
- Contract rates: toll $0.55–0.80 → **$0.80–1.10**/bf, purchase premium $0.85–1.25 → **$1.05–1.45**/bf.
  - Why: with an average crew (quality 50 → 30% waste on a dip tank), a competent modest yard was *losing* ~$25k over 60 days. Toll netted ~$0.30/bf after buying raw to cover waste, and purchase ~$0.70/bf, against ~$750/night overhead. Good play has to beat idling.
- Pickup capacity 2 → **4 bundles** (description updated to a gooseneck trailer), so it can carry about half of all contracts instead of almost none.
- Freight `FREIGHT_PER_BF` $0.05 → **$0.08**.

**Where the economy sits now** (`npm run sim`, 5 seeds; all 10 scenarios pass)

| Scenario | Result |
|---|---|
| idle, never works | Bankrupt on day 94. A new player has plenty of runway. |
| starter yard only (brush bench) | Survives 60 days; equity $50k → $27k. The starting yard can't pay its own rent, which pushes the first investment. |
| steady (dip tank + 1 hire) | Equity $50k → **$75k**. About 3% of contracts missed. |
| **over-hire then lull** (2 dip tanks, 4 stainers, truck + driver, leased lot + forklift, no work) | **Bankrupt on day 11–12, every seed.** The death spiral works: ~$1,590/night of fixed costs. |
| same, but lays everyone off and sells the truck on day 3 | Bankrupt on day 24–26. Cutting doubles the runway, but severance plus idle base costs still sink it without work. |
| same over-expansion with work flowing | Equity **$109k**. Expansion pays when contracts fill capacity. |
| steady yard, lull from day 20 | Survives 60 days on about $22k. |
| bank-backed steady | Equity about $73k, the same as bootstrapped (the bot doesn't spend the extra capital). |
| bank-backed over-hire + lull | Bankrupt on day 34–35. |

**Open balance questions (not resolved)**
- **A fleet at small scale is still a net cost.** A steady yard plus pickup and driver ends ≈ $58k equity vs $75k without, because $16k of capital and ~$180/night buys only ~$76/day of freight. The bot's fleet logic is simple (it hauls only when the whole order fits and delivers when a truck is idle), so a smarter player may do better. Worth another pass: cheaper pickup, lower pickup insurance, or freight that rewards short routes.
- **The bank-backed start only helps if the capital gets used.** No bot scenario grows with it yet; a "growth" bot that reinvests would show whether 24%/120 days is fair.
- Idle overhead ($545/night) means any company with *zero* work eventually dies (day 94). That's intentional, but it's the floor for how long lulls can be survived.
- The starter yard misses ~7% of deadlines even with a careful bot. A brush bench is tiny next to contract sizes. Fine as pressure to invest, but new players will feel it.

**Verified**
- `npx tsc -b` is clean and `npm run sim` passes (10/10).
- A scratch check script (37 checks, not in the repo) covered:
  - The v5 → v6 upgrade keeping progress, and the `.bak` it writes.
  - Newer-version and junk files listing as can't-open.
  - Id slugging and collisions, and path-traversal ids being rejected.
  - Save-a-copy naming, and delete removing the side files.
  - Loan night charges and early repayment (including the caps).
  - Three-night bankruptcy, and a bankrupt save reopening at its final EOD.
  - Recovering resetting the count, and mid-day loads opening paused.
- Clicked through the real app over CDP with a scratch `--user-data-dir`, with screenshots of each:
  - The title menu, a new bank-backed career, loan repayment, save a copy, exit, and delete with confirmation.
  - Loading an overdrawn save: the night-2 warning.
  - Loading a bankrupt save: the foreclosure screen.
- Fixed one regression found that way: the EOD dialog's autofocus landed on the new "Exit to menu" button, so Enter would have quit. It now focuses "Start Day" (or "Back to the menu" when bankrupt), even when the report arrives after the dialog opens.

**Follow-ups**
- Equipment can't be sold, so a retrenching player is stuck with idle dip tanks. A `sellEquipment` action at a resale fraction would give the lull response more teeth.
- The EOD capital line is now labeled "Capital and financing", but purchases, sales and loan repayments are still one net figure.
- Open offers still show on a bankrupt company's board (harmless, since everything is refused).
- The Phase 5 rough edges not mentioned here are still open.

### 2026-09-21: Phase 5, Expansion & Fleet Management

**What was built**
- **Real estate** (`PROPERTIES` in rules):
  - Gravel lot: 3,000 sq ft, storage only.
  - Acreage: 10,000 sq ft, storage only.
  - Commercial annex: 2,000 sq ft of production floor.
  - Leasing costs a signing fee of 5 days' rent, then rent every night. Buying costs the price, then 0.03%/night property tax. Selling returns 85%.
  - Releasing or selling a site is refused if lumber or equipment would overflow (`spaceAfterLosing` in actions).
- **Crew** (`crew` table, `CREW_ROLES`): forklift driver, logistics manager (max 1), driver (standard license), CDL driver.
  - Hiring has a fixed fee; there's no candidate pool, unlike stainers.
  - Severance is rolled at hire, 10–14× the daily wage.
  - Each forklift driver makes 5,000 sq ft of lot usable.
- **Vehicles** (`VEHICLES`): pickup, flatbed, semi.
  - Their condition wears per hour driven. The breakdown chance per minute is scaled by wear (×1 to ×5) and by the logistics manager (×0.6).
  - A breakdown costs a repair bill plus a delay; the delay is halved with a manager.
  - Service restores condition to 100 and takes 120 working minutes. Resale is 40–70% depending on condition.
- **Trips** (`trips` table, `processTrips`):
  - Legs: `outbound` (LOAD + drive), then `returning` (drive), then `completed`.
  - A mill haul that finds no floor space goes to `waiting` and retries every minute.
  - Deliveries pay payout + freight at the end of the outbound leg, minus the penalty if it's past the due day.
  - The driver is picked automatically (`availableDriver`): the cheapest licensed one who's free.
- **Contracts** gained `route_minutes` (40–150) and `freight`, set by `freightAllowance`.
- **Overnight:** crew payroll, fleet insurance, lease rent and property tax are posted by `chargeExpansionOvernight`.
- **UI:**
  - New Real estate and Fleet screens; a crew panel on Staff.
  - A "Haul with" selector on the mill cards; ship controls on active contracts.
  - The SpaceBar shows the storage lots and any uncrewed lot space; the Dashboard shows your trucks.
  - The Sidebar badge counts open trips and shows a red dot when a truck is broken down or waiting at the gate.

**Verified:** a headless scenario script covered 60+ checks: the space model, crew limits, license checks, capacity caps, hauls and reputation, overnight charges, shipping, forced breakdowns, the gate wait, late delivery, a shipment spanning the night, and the release/fire guards. I also clicked through the real app and screenshotted every new screen.

**Design decisions and simplifications (revisit if gameplay needs it)**
- Inventory is **one pooled stock**, not tracked per site. Lots only add capacity, and that capacity is gated by forklift crew. Per-site stock with transfers was judged too heavy for now.
- Vehicles don't use floor or parking space.
- There are no breakdowns while parked and no overnight inspections. Breakdowns only happen while driving (not while repairing or waiting at the gate).
- Mill hauls in your own truck are paid for **at dispatch** (at the mill counter), not on arrival. The truck never refuses its load; it waits at the gate instead.
- A shipped contract that arrives late is still completed, with the penalty deducted. It never fails.
- The home yard's rent is still the fixed `Rent` cost ($250/night); it isn't a `properties` row.

**Balance notes for Phase 6** (all numbers are first guesses)
- Starting cash is $50k and a pickup costs $16k. A pickup plus a driver costs about $179/night, versus mill delivery fees of $140–260 per order. At one haul a day it roughly breaks even, and the freight on shipped orders is the upside. Check that fleets pay off in the mid game and aren't a trap.
- The mill delivery fee is flat per order and mill trucks carry up to 12 bundles, so big mill orders are very cheap per bf. The semi's 16-bundle capacity is its main edge.
- Breakdown risk when new is about 2.4% (pickup) to 4.7% (semi) per 10-hour driving day, without a manager. Wear is 0.5–0.7 condition per hour driven.
- Lot economics: gravel lot $70/night + forklift $150/night ≈ $220 for 3,000 sq ft (~30k bf). Compare the annex at $340/night for 2,000 sq ft of production floor.
- Freight = bf × ($0.05 + $0.03 × route hours), rounded to $10.
- Things to watch in the death-spiral simulation: crew wages, insurance and lease rent are all fixed nightly costs. Over-expanding during a contract lull should hurt, and severance makes crew hard to shed quickly.

**Known rough edges / follow-ups**
- `tripDestination` in the UI looks up the customer in `game.contracts`. Once a delivery completes, the contract drops out of that list, so today's finished delivery trips show "Customer". This could be fixed by storing the customer name on the trip, or by looking it up in history.
- The EOD report lumps all capital movement into one line ("Capital purchases and sales"). Sales show as positive capital.
- There's no UI for choosing a specific driver; dispatch is automatic.
- The home-yard row on the Real estate screen says "Rent in fixed costs" instead of showing the $250.
- My test script lives in the session scratchpad and **isn't in the repo**. Phase 6's automated balancing runs would be a good time to add a real headless test/sim harness to the project, e.g. `scripts/sim.ts` plus a Vite SSR config, following the tooling notes above.
