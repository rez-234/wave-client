import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Real downloads and a real game launch; run in CI under a virtual display (see .github/workflows/launcher.yml). */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000
  }
})
