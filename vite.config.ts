import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'chrome110',
    rollupOptions: {
      input: {
        onboarding: resolve(__dirname, 'onboarding.html'),
        companion: resolve(__dirname, 'companion.html'),
        chat: resolve(__dirname, 'chat.html'),
        bubble: resolve(__dirname, 'bubble.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
    },
  },
})
