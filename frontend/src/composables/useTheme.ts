import { ref, watch, onMounted } from 'vue'

const STORAGE_KEY = 'agro:theme'
type Theme = 'dark' | 'light'

function getStoredTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  return stored === 'light' || stored === 'dark' ? stored : 'light'
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

const theme = ref<Theme>(getStoredTheme())

export function useTheme() {
  onMounted(() => {
    applyTheme(theme.value)
  })

  watch(theme, (next) => {
    applyTheme(next)
    localStorage.setItem(STORAGE_KEY, next)
  })

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setTheme(next: Theme) {
    theme.value = next
  }

  return { theme, toggle, setTheme, isDark: () => theme.value === 'dark', isLight: () => theme.value === 'light' }
}
