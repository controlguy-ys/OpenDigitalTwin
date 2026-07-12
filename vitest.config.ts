import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
      'middleware/**/*.test.ts',
    ],
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
})
