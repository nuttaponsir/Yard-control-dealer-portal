// ============================================================================
// Shared Vitest config (SA-owned). Two projects so a single `npm test` covers
// both layers:
//   • unit       — node env: server API/unit tests, label maps, Zod validation,
//                  and the e2e order-flow tests (hit a running dev server).
//   • component  — happy-dom + @vitejs/plugin-vue: mounts the .vue SFCs.
// `@vitejs/plugin-vue` ships with Nuxt, so no extra dependency is needed.
// ============================================================================
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const alias = {
  // Mirror the Nuxt '~' alias to the app srcDir so we can import composables/utils.
  '~': fileURLToPath(new URL('./app', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    // The server integration tests all hit ONE shared Postgres and mutate it
    // (creating orders, approving returns, …). Running test files in parallel
    // causes cross-file pollution: a report endpoint's snapshot vs. the test's
    // recomputed expectation diverge, or a concurrent writer triggers a 500.
    // Serialising files removes the races; the suite is fast enough (~15s) that
    // this costs little. Run against a freshly seeded DB (`pnpm db:seed`).
    fileParallelism: false,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'tests/*.{test,spec}.ts',
            'tests/server/**/*.{test,spec}.ts',
          ],
          exclude: ['tests/component-*.{test,spec}.ts'],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['tests/component-*.{test,spec}.ts'],
        },
      },
    ],
  },
})
