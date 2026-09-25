import { createApp } from 'vue'

import App from './App.vue'
import { vCardTable } from './directives/cardTable'
import { router } from './router'
import { useAuth } from './stores/auth'
import './styles/shadcn.css'
import './styles/global.css'
import './styles/modal.css'
import './styles/ui.css'

// Применить сохранённую тему до рендера
const saved = localStorage.getItem('agro:theme')
const theme = saved === 'light' || saved === 'dark' ? saved : 'dark'
document.documentElement.setAttribute('data-theme', theme)
document.documentElement.style.colorScheme = theme

const auth = useAuth()
auth.startAuthListener()

// Монтируем сразу: при недоступной БД getSession() может долго висеть
const app = createApp(App).use(router)
app.directive('card-table', vCardTable)
app.mount('#app')
void auth.init()
