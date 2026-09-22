-- Single-row company record: cash, clock, debt, solvency, and the production yard.
-- Columns added after v5 must also be added by a migration in dbManager.ts.
CREATE TABLE IF NOT EXISTS company (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  cash              REAL    NOT NULL,
  day               INTEGER NOT NULL DEFAULT 1,
  minute            INTEGER NOT NULL DEFAULT 480,
  loan_balance      REAL    NOT NULL DEFAULT 0,
  loan_rate         REAL    NOT NULL DEFAULT 0,   -- annual rate, e.g. 0.18
  yard_sq_ft        REAL    NOT NULL,
  name              TEXT    NOT NULL DEFAULT 'AStain Co.',
  capitalization    TEXT    NOT NULL DEFAULT 'bootstrapped',
  loan_installment  REAL    NOT NULL DEFAULT 0,   -- principal repaid each night
  insolvent_nights  INTEGER NOT NULL DEFAULT 0,   -- consecutive nights closed with negative cash
  bankrupt_day      INTEGER                       -- set when the bank forecloses; the career is over
);

-- Recurring overhead charged every night at 8:00 PM (rent, utilities, insurance...).
CREATE TABLE IF NOT EXISTS fixed_costs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT    NOT NULL,
  daily_amount REAL    NOT NULL CHECK (daily_amount >= 0)
);

-- Stations (brush bench, dip tank, spray booth) and drying racks; specs live in rules.ts.
CREATE TABLE IF NOT EXISTS equipment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  purchased_day INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  level                INTEGER NOT NULL DEFAULT 1,
  xp                   REAL    NOT NULL DEFAULT 0,   -- progress toward the next level
  speed                INTEGER NOT NULL CHECK (speed BETWEEN 1 AND 100),
  quality              INTEGER NOT NULL CHECK (quality BETWEEN 1 AND 100),
  daily_wage           REAL    NOT NULL,
  severance_multiplier REAL    NOT NULL,
  hired_day            INTEGER NOT NULL,
  fired_day            INTEGER,                      -- NULL while employed
  station_id           INTEGER UNIQUE REFERENCES equipment (id),
  status               TEXT    NOT NULL DEFAULT 'unassigned'
);

-- Applicants produced by a job posting; they leave the pool once expires_day has passed.
CREATE TABLE IF NOT EXISTS candidates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  speed                INTEGER NOT NULL,
  quality              INTEGER NOT NULL,
  daily_wage           REAL    NOT NULL,
  severance_multiplier REAL    NOT NULL,
  expires_day          INTEGER NOT NULL
);

-- Board feet by species and stage. Raw and finished stock sit on the floor; drying stock sits on the racks.
CREATE TABLE IF NOT EXISTS inventory (
  species     TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('raw', 'drying', 'finished')),
  board_feet  REAL NOT NULL DEFAULT 0 CHECK (board_feet >= 0),
  PRIMARY KEY (species, state)
);

-- Stained wood on the racks, grouped by when it will be dry. The 'drying' inventory row is the total of these.
CREATE TABLE IF NOT EXISTS drying_batches (
  species      TEXT    NOT NULL,
  board_feet   REAL    NOT NULL CHECK (board_feet >= 0),
  ready_day    INTEGER NOT NULL,
  ready_minute INTEGER NOT NULL,              -- may run past 8:00 PM; anything left dries overnight
  PRIMARY KEY (species, ready_day, ready_minute)
);

-- Board feet moved from the racks to finished stock each day, daytime and overnight together.
CREATE TABLE IF NOT EXISTS daily_drying (
  day      INTEGER PRIMARY KEY,
  dried_bf REAL    NOT NULL DEFAULT 0
);

-- Per-worker daily output; feeds the End-of-Day report and later balancing runs.
CREATE TABLE IF NOT EXISTS production_log (
  day         INTEGER NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees (id),
  stained_bf  REAL    NOT NULL DEFAULT 0,
  wasted_bf   REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, employee_id)
);

-- Customer orders. Offers sit on the board until offer_expires_day; accepting one starts a lead_days clock.
CREATE TABLE IF NOT EXISTS contracts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer          TEXT    NOT NULL,
  kind              TEXT    NOT NULL CHECK (kind IN ('toll', 'purchase')),
  species           TEXT    NOT NULL,
  board_feet        REAL    NOT NULL,
  payout            REAL    NOT NULL,
  penalty           REAL    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'offered'
                    CHECK (status IN ('offered', 'active', 'shipping', 'completed', 'failed', 'expired', 'declined')),
  offered_day       INTEGER NOT NULL,
  offer_expires_day INTEGER NOT NULL,
  lead_days         INTEGER NOT NULL,
  route_minutes     INTEGER NOT NULL,           -- one-way drive to the customer, for delivering it yourself
  freight           REAL    NOT NULL,           -- extra the customer pays when you deliver it yourself
  accepted_day      INTEGER,
  due_day           INTEGER,                    -- deliver by 8:00 PM on this day
  material_received INTEGER NOT NULL DEFAULT 0, -- toll: the customer's lumber is on site
  resolved_day      INTEGER,
  note              TEXT
);

CREATE INDEX IF NOT EXISTS contracts_status ON contracts (status);

-- One row per species per day; the history behind the market chart.
CREATE TABLE IF NOT EXISTS market_prices (
  day          INTEGER NOT NULL,
  species      TEXT    NOT NULL,
  price_per_bf REAL    NOT NULL,
  PRIMARY KEY (day, species)
);

CREATE TABLE IF NOT EXISTS market_news (
  day      INTEGER PRIMARY KEY,
  headline TEXT    NOT NULL
);

-- Standing with each mill (specs live in rules.ts). Reputation buys a discount of up to 20%.
CREATE TABLE IF NOT EXISTS mill_relations (
  mill              TEXT    PRIMARY KEY,
  reputation        REAL    NOT NULL CHECK (reputation BETWEEN 0 AND 100),
  delivered_bf      REAL    NOT NULL DEFAULT 0,
  last_delivery_day INTEGER
);

-- Trucks heading for the yard: mill orders and customers' toll drop-offs. ETAs are in working time.
CREATE TABLE IF NOT EXISTS deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT    NOT NULL CHECK (kind IN ('mill_order', 'toll_dropoff')),
  species         TEXT    NOT NULL,
  board_feet      REAL    NOT NULL,
  mill            TEXT    REFERENCES mill_relations (mill),
  contract_id     INTEGER REFERENCES contracts (id),
  goods_cost      REAL    NOT NULL DEFAULT 0,   -- price locked at order; paid cash on delivery
  status          TEXT    NOT NULL DEFAULT 'in_transit'
                  CHECK (status IN ('in_transit', 'delivered', 'refused', 'cancelled')),
  ordered_day     INTEGER NOT NULL,
  ordered_minute  INTEGER NOT NULL,
  eta_day         INTEGER NOT NULL,
  eta_minute      INTEGER NOT NULL,
  resolved_day    INTEGER,
  resolved_minute INTEGER
);

CREATE INDEX IF NOT EXISTS deliveries_status ON deliveries (status);

CREATE TABLE IF NOT EXISTS ledger (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  day      INTEGER NOT NULL,
  minute   INTEGER NOT NULL,
  amount   REAL    NOT NULL,                      -- positive = income, negative = expense
  category TEXT    NOT NULL CHECK (category IN ('operating', 'capital', 'overnight')),
  memo     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_day ON ledger (day);

-- One row per closed day; the End-of-Day summary and the history for balancing runs.
CREATE TABLE IF NOT EXISTS daily_reports (
  day                INTEGER PRIMARY KEY,
  opening_cash       REAL    NOT NULL,
  revenue            REAL    NOT NULL,
  operating_expenses REAL    NOT NULL,
  capital_spending   REAL    NOT NULL,
  overnight_costs    REAL    NOT NULL,
  ending_cash        REAL    NOT NULL,
  stained_bf         REAL    NOT NULL,
  wasted_bf          REAL    NOT NULL,
  dried_bf           REAL    NOT NULL,
  stuck_on_racks_bf  REAL    NOT NULL,
  insolvent_nights   INTEGER NOT NULL DEFAULT 0
);

-- Storage lots and production annexes beyond the home yard (specs live in rules.ts).
CREATE TABLE IF NOT EXISTS properties (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL,
  tenure        TEXT    NOT NULL CHECK (tenure IN ('lease', 'own')),
  price_paid    REAL    NOT NULL DEFAULT 0,       -- owned: the purchase price, for tax and resale
  acquired_day  INTEGER NOT NULL,
  released_day  INTEGER                           -- NULL while held
);

-- Warehouse and fleet staff: forklift drivers, logistics managers, drivers. Stainers live in employees.
CREATE TABLE IF NOT EXISTS crew (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  role                 TEXT    NOT NULL,
  daily_wage           REAL    NOT NULL,
  severance_multiplier REAL    NOT NULL,
  hired_day            INTEGER NOT NULL,
  fired_day            INTEGER                    -- NULL while employed
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT    NOT NULL,
  condition         REAL    NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  purchase_price    REAL    NOT NULL,
  purchased_day     INTEGER NOT NULL,
  sold_day          INTEGER,                      -- NULL while owned
  shop_until_day    INTEGER,                      -- in for service until this moment
  shop_until_minute INTEGER,
  breakdowns        INTEGER NOT NULL DEFAULT 0
);

-- Runs by the company's own vehicles: hauling lumber from a mill, or delivering an order to a customer.
-- A trip drives out (outbound), turns around at the far end, and drives back (returning). A lumber haul that
-- finds no floor space waits at the gate until room opens up.
CREATE TABLE IF NOT EXISTS trips (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  kind               TEXT    NOT NULL CHECK (kind IN ('mill_pickup', 'contract_delivery')),
  vehicle_id         INTEGER NOT NULL REFERENCES vehicles (id),
  driver_id          INTEGER NOT NULL REFERENCES crew (id),
  species            TEXT    NOT NULL,
  board_feet         REAL    NOT NULL,
  mill               TEXT    REFERENCES mill_relations (mill),
  contract_id        INTEGER REFERENCES contracts (id),
  goods_cost         REAL    NOT NULL DEFAULT 0,  -- mill hauls: paid at the mill counter when dispatched
  fuel_cost          REAL    NOT NULL,
  drive_minutes      INTEGER NOT NULL,            -- one way
  status             TEXT    NOT NULL DEFAULT 'outbound'
                     CHECK (status IN ('outbound', 'returning', 'waiting', 'completed')),
  departed_day       INTEGER NOT NULL,
  departed_minute    INTEGER NOT NULL,
  leg_ends_day       INTEGER NOT NULL,            -- when the current leg finishes, repairs included
  leg_ends_minute    INTEGER NOT NULL,
  repair_until_day   INTEGER,                     -- broken down on the roadside until this moment
  repair_until_minute INTEGER,
  breakdowns         INTEGER NOT NULL DEFAULT 0,
  completed_day      INTEGER,
  completed_minute   INTEGER
);

CREATE INDEX IF NOT EXISTS trips_status ON trips (status);
