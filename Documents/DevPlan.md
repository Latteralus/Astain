Phase 1: Architecture & Foundation (Complete)
The goal of this phase is to establish the core engine and prove that the React frontend can talk to the local SQLite database.

Initialize the Environment: Scaffold the Vite + React application inside an Electron wrapper.

Establish the IPC Bridge: Write the preload.ts context bridge. This replaces your standard API routes, allowing the UI to send commands to the Node backend safely.

Database Schema Design: Write the initial schema.sql for better-sqlite3. Create the baseline tables: player_state (cash, current day), employees (speed, quality, wage), and inventory (raw wood, finished pickets).

Zustand Setup: Create the UI store to hold the immediate session state (e.g., currentScreen, activeModal).

Phase 2: The Core Time Engine (Complete)
Before adding any game mechanics, the simulation needs its heartbeat.

The Tick Loop: Program the main loop in the Electron backend where 1 real second equals 1 in-game minute.

Time Rendering: Send the current time via IPC to the React frontend to display the working hours (8:00 AM to 8:00 PM).

The EOD Trigger: Build the logic that pauses the loop at 8:00 PM, calculates fixed overnight costs (rent, loan interest), updates the SQLite database, and pushes the End-of-Day financial summary to the React frontend.

Phase 3: Operations & UI Dashboard (Complete)
With the engine running, you will build the primary interface and implement the core production math.

Dashboard Layout: Implement shadcn/ui to build the main ledger, inventory tables, and employee management screens.

Spatial Logic: Write the functions that calculate available property square footage and block actions if the player lacks space for equipment or drying racks.

Production Math: Implement the formulas for hourly output and material waste based on worker stats (speed and quality) and equipment limits.

The Job Market: Create the recruitment mechanics, including job posting costs and the UI warnings/financial penalties for firing employees.

Phase 4: Logistics & Market Dynamics (Complete)
This phase introduces the external economy and the spatial delays of supply chain management.

Contract Generation: Build the procedural generator for Toll and Purchase contracts, varying the volume, deadlines, and payouts.

Delivery State Machine: Program the delays for incoming materials (4-6 in-game hours for mill purchases, 1-2 hours for Toll drop-offs).

Market Fluctuations: Create the system that dynamically shifts raw lumber prices and calculates mill-specific reputation discounts.

Phase 5: Expansion & Fleet Management (Complete)
The final core phase scales the business from a single lot to a multi-site operation handling its own transportation.

Real Estate Purchasing: Allow players to lease or buy secondary storage lots and hire dedicated warehouse crew (forklift drivers, logistics managers).

Vehicle Logistics: Implement OTR truck selection and container delivery routes. Players will purchase heavy-duty pickups, flatbeds, and semi-trucks, managing the trade-offs between carrying capacity, CDL driver wages, and daily insurance costs.

Breakdowns & Maintenance: Add RNG events for vehicle breakdowns to disrupt the production queue and stress-test the player's cash reserves.

Phase 6: Balancing & Polish (Complete)
Economy Balancing: Run automated simulations of the tick loop to ensure the "death spiral" works correctly—making sure fixed costs will bankrupt a player who over-hires during a contract lull.

Save/Load System: Finalize the serialization of the SQLite database so players can maintain multiple career saves locally.