import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

// Shells launched from VS Code inherit ELECTRON_RUN_AS_NODE=1, which makes Electron boot as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rolldownOptions: {
              // Native module: must stay outside the bundle so it loads from node_modules (unpacked from ASAR).
              external: ['better-sqlite3'],
            },
          },
        },
      },
      preload: {
        input: path.join(import.meta.dirname, 'electron/preload.ts'),
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
