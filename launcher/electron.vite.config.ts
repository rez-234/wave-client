import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      // A sandboxed preload can't load other files, so it is one self-contained CommonJS script.
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()],
    // The design tokens live in the repository's shared/ folder, next to the mod.
    server: { fs: { allow: [resolve('..')] } }
  }
})
