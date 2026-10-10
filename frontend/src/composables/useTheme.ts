import { ref, onMounted } from 'vue'

const STORAGE_KEY = 'agro:theme'
type Theme = 'dark' | 'light'

function getStoredTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
  return stored === 'light' || stored === 'dark' ? stored : 'light'
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (root.getAttribute('data-theme') === theme) return
  // На время смены темы переходы выключены: иначе элементы с разной длительностью
  // transition перекрашиваются вразнобой и экран «мигает» кусками.
  root.setAttribute('data-theme-switching', '')
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  void root.offsetHeight
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))
}

const theme = ref<Theme>(getStoredTheme())

// Другая вкладка сменила тему — применяем здесь же, без записи обратно.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || (e.newValue !== 'light' && e.newValue !== 'dark')) return
    theme.value = e.newValue
    applyTheme(e.newValue)
  })
}

export function useTheme() {
  onMounted(() => {
    applyTheme(theme.value)
  })

  // Сохраняем только явный выбор пользователя: автоматическая запись из watch
  // перезаписывала выбор в других вкладках.
  function setTheme(next: Theme) {
    theme.value = next
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* приватный режим — тема просто не запомнится */
    }
  }

  function toggle() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { theme, toggle, setTheme, isDark: () => theme.value === 'dark', isLight: () => theme.value === 'light' }
}
