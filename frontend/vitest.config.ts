import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Конфиг вынесен из vite.config.ts намеренно: там он потянул бы импорт из
 * vitest в прод-сборку, и сборка перестала бы собираться без dev-зависимостей.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Санитайзер работает с DOM: DOMPurify и DOMParser нужен настоящий window.
    environment: 'jsdom',
    // Только юнит-тесты рядом с кодом. Каталог tests/ — за Playwright,
    // и его файлы Vitest подхватывать не должен.
    include: ['src/**/*.test.ts'],
  },
})
