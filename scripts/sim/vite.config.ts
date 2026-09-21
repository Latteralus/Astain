// Bundles the balancing simulation for Node. It has to go through Vite because dbManager imports schema.sql?raw.
import path from 'node:path'
import { defineConfig } from 'vite'

const root = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  root,
  logLevel: 'warn',
  build: {
    ssr: path.join(root, 'scripts/sim/sim.ts'),
    // Inside node_modules so the bundle can resolve better-sqlite3 at runtime.
    outDir: path.join(root, 'node_modules/.tmp/sim'),
    emptyOutDir: true,
    target: 'node22',
    rolldownOptions: {
      external: ['better-sqlite3'],
      output: { entryFileNames: 'sim.mjs' },
    },
  },
})
