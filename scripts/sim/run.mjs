// `npm run sim -- [options]`: builds the balancing simulation, then runs it under Electron's Node.
// better-sqlite3 is compiled for Electron's ABI, so the system `node` can't load it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import electron from 'electron'
import { build } from 'vite'

const root = path.resolve(import.meta.dirname, '../..')
await build({ configFile: path.join(root, 'scripts/sim/vite.config.ts') })

const { status } = spawnSync(electron, [path.join(root, 'node_modules/.tmp/sim/sim.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
process.exit(status ?? 1)
