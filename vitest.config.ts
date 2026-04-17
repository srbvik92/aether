import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals:     true,
    include:     ['src/main/__tests__/**/*.test.ts'],
    // Mock electron so main-process imports don't fail
    server: {
      deps: {
        inline: ['electron']
      }
    }
  },
  resolve: {
    alias: {
      // electron stub — we'll also mock it per-file with vi.mock
      electron: resolve('src/main/__tests__/__mocks__/electron.ts')
    }
  }
})
