import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@google/genai'] })],
    resolve: {
      // Force the node/require CJS build of @google/genai instead of the ESM build
      conditions: ['node', 'require', 'default'],
      alias: {
        '@google/genai': resolve('node_modules/@google/genai/dist/node/index.cjs')
      }
    },
    build: {
      rollupOptions: {
        external: ['ws', 'bufferutil', 'utf-8-validate']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: {
      port: 5200
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
