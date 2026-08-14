<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const loading = ref(false)

const title = computed(() => (mode.value === 'login' ? 'Вход в аккаунт' : 'Регистрация'))
const subtitle = computed(() =>
  mode.value === 'login'
    ? 'Войдите под своей учётной записью портала АГРОСИСТЕМА.'
    : 'Создайте учётную запись и начните работу с полями, задачами и аналитикой.',
)
const submitLabel = computed(() => (mode.value === 'login' ? 'Войти' : 'Зарегистрироваться'))
const switchBtnLabel = computed(() => (mode.value === 'login' ? 'Создать аккаунт' : 'Войти в существующий аккаунт'))

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = null
}

async function submit() {
  error.value = null
  const trimmedEmail = email.value.trim()
  const trimmedPassword = password.value.trim()
  if (!trimmedEmail || !trimmedPassword) {
    error.value = 'Введите логин (email) и пароль'
    return
  }
  if (trimmedPassword.length < 6) {
    error.value = 'Пароль не менее 6 символов'
    return
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(trimmedEmail, trimmedPassword)
    } else {
      await auth.register(trimmedEmail, trimmedPassword)
    }
    const redirect = (route.query.redirect as string) || '/news'
    router.push(redirect)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('email not confirmed')) {
      error.value =
        'Почта не подтверждена. В Supabase: Authentication → Users → найдите себя → Confirm. Либо Authentication → Providers → Email → выключите «Confirm email», чтобы больше не требовать подтверждение.'
    } else {
      error.value = msg || 'Ошибка входа'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-layout auth-uiview">
    <img
      class="login-bg-img"
      src="/login-bg.jpg"
      alt=""
      width="1920"
      height="1080"
      decoding="async"
      fetchpriority="high"
    />
    <form class="form_container" @submit.prevent="submit">
      <div class="title_container">
        <p class="title">{{ title }}</p>
        <span class="subtitle">{{ subtitle }}</span>
      </div>

      <div class="input_container">
        <label class="input_label" for="auth-email">Логин (email)</label>
        <svg fill="none" viewBox="0 0 24 24" height="20" width="20" xmlns="http://www.w3.org/2000/svg" class="icon">
          <path stroke-linejoin="round" stroke-linecap="round" stroke-width="1.5" stroke="currentColor" d="M7 8.5L9.942 10.239C11.657 11.254 12.343 11.254 14.058 10.239L17 8.5"></path>
          <path stroke-linejoin="round" stroke-width="1.5" stroke="currentColor" d="M2.016 13.476C2.081 16.541 2.114 18.074 3.245 19.209C4.376 20.345 5.95 20.384 9.099 20.463C11.039 20.512 12.961 20.512 14.901 20.463C18.05 20.384 19.624 20.345 20.755 19.209C21.886 18.074 21.919 16.541 21.984 13.476C22.005 12.49 22.005 11.51 21.984 10.524C21.919 7.459 21.886 5.926 20.755 4.791C19.624 3.655 18.05 3.616 14.901 3.537C12.961 3.488 11.039 3.488 9.099 3.537C5.95 3.616 4.376 3.655 3.245 4.791C2.114 5.926 2.081 7.459 2.016 10.524C1.995 11.51 1.995 12.49 2.016 13.476Z"></path>
        </svg>
        <input
          id="auth-email"
          v-model="email"
          class="input_field"
          placeholder="name@mail.com"
          type="email"
          autocomplete="email"
          required
        />
      </div>

      <div class="input_container">
        <label class="input_label" for="auth-password">Пароль</label>
        <svg fill="none" viewBox="0 0 24 24" height="20" width="20" xmlns="http://www.w3.org/2000/svg" class="icon">
          <rect x="4" y="11" width="16" height="9" rx="3" stroke="currentColor" stroke-width="1.8"></rect>
          <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
        <input
          id="auth-password"
          v-model="password"
          class="input_field"
          type="password"
          placeholder="Password"
          autocomplete="current-password"
          required
        />
      </div>

      <p v-if="error" class="auth_error" role="alert">{{ error }}</p>

      <button type="submit" class="sign-in_btn" :disabled="loading">
        <span>{{ loading ? 'Проверка...' : submitLabel }}</span>
      </button>

      <div class="separator">
        <hr class="line" />
        <span>или</span>
        <hr class="line" />
      </div>

      <button type="button" class="sign-in_ggl" @click="switchMode">
        <span>{{ switchBtnLabel }}</span>
      </button>

      <p class="note">
        Продолжая, вы принимаете
        <RouterLink class="note-link" to="/rules">правила</RouterLink>
        использования корпоративного портала.
      </p>
    </form>
  </div>
</template>

<style scoped>
.login-layout {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  background-color: #1c2e18;
}

.login-bg-img {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
}

.login-layout::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(20, 35, 18, 0.72) 0%,
    rgba(12, 22, 10, 0.55) 50%,
    rgba(18, 30, 14, 0.65) 100%
  );
}

.form_container {
  position: relative;
  z-index: 2;
  width: fit-content;
  min-width: min(100%, 360px);
  max-width: 410px;
  height: fit-content;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 50px 40px 20px;
  background-color: #ffffff;
  box-shadow:
    0px 106px 42px rgba(0, 0, 0, 0.01),
    0px 59px 36px rgba(0, 0, 0, 0.05),
    0px 26px 26px rgba(0, 0, 0, 0.09),
    0px 7px 15px rgba(0, 0, 0, 0.1),
    0px 0px 0px rgba(0, 0, 0, 0.1);
  border-radius: 11px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  box-sizing: border-box;
}

.title_container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 4px;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: #212121;
  text-align: center;
}

.subtitle {
  font-size: 0.725rem;
  max-width: 80%;
  text-align: center;
  line-height: 1.1rem;
  color: #8b8e98;
}

.input_container {
  width: 100%;
  height: fit-content;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input_container--select .role_hint {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.25;
  color: #8b8e98;
  padding-left: 2px;
}

.icon {
  width: 20px;
  height: 20px;
  position: absolute;
  z-index: 2;
  left: 12px;
  top: 50%;
  bottom: auto;
  transform: translateY(2px);
  color: #141b34;
  pointer-events: none;
}

.input_label {
  font-size: 0.75rem;
  color: #8b8e98;
  font-weight: 600;
}

.input_field {
  width: 100%;
  height: 40px;
  padding: 0 12px 0 40px;
  border-radius: 7px;
  outline: none;
  border: 1px solid #e5e5e5;
  filter: drop-shadow(0px 1px 0px #efefef) drop-shadow(0px 1px 0.5px rgba(239, 239, 239, 0.5));
  transition: all 0.3s cubic-bezier(0.15, 0.83, 0.66, 1);
  font-size: 0.9rem;
  color: #212121;
  background-color: #fff;
  box-sizing: border-box;
}

.input_field::placeholder {
  color: #9ca3af;
}

.input_field:focus {
  border: 1px solid transparent;
  box-shadow: 0 0 0 2px #242424;
  background-color: transparent;
}

.input_field--select {
  padding-left: 12px;
  padding-right: 36px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
}

.auth_error {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.35;
  color: var(--danger-red);
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(185, 28, 28, 0.08);
  border: 1px solid rgba(185, 28, 28, 0.2);
}

.sign-in_btn {
  width: 100%;
  height: 40px;
  border: 0;
  background: var(--accent-green);
  border-radius: 7px;
  outline: none;
  color: #ffffff;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.sign-in_btn:hover:not(:disabled) {
  background: var(--accent-green-hover);
}

.sign-in_btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.separator {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  color: #8b8e98;
  font-size: 0.75rem;
  font-weight: 600;
}

.separator .line {
  display: block;
  width: 100%;
  height: 1px;
  border: 0;
  background-color: #e8e8e8;
  flex: 1;
}

.sign-in_ggl {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #ffffff;
  border-radius: 7px;
  outline: none;
  color: #242424;
  border: 1px solid #e5e5e5;
  filter: drop-shadow(0px 1px 0px #efefef) drop-shadow(0px 1px 0.5px rgba(239, 239, 239, 0.5));
  cursor: pointer;
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
}

.sign-in_ggl:hover {
  border-color: #d8d8d8;
}

.note {
  margin: 4px 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: #8b8e98;
  text-align: center;
  text-decoration: none;
}

.note-link {
  color: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.note-link:hover {
  color: #4b5563;
}

@media (max-width: 480px) {
  .login-layout {
    padding: 16px;
  }
  .form_container {
    padding: 40px 24px 24px;
    min-width: 100%;
  }
}
</style>

<!-- Тёмная тема: атрибут data-theme на <html> задаётся приложением -->
<style>
html[data-theme='dark'] .auth-uiview .form_container {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  box-shadow:
    0 24px 48px rgba(0, 0, 0, 0.35),
    0 8px 20px rgba(0, 0, 0, 0.25);
}

html[data-theme='dark'] .auth-uiview .title {
  color: var(--text-primary);
}

html[data-theme='dark'] .auth-uiview .subtitle,
html[data-theme='dark'] .auth-uiview .input_label,
html[data-theme='dark'] .auth-uiview .separator,
html[data-theme='dark'] .auth-uiview .note,
html[data-theme='dark'] .auth-uiview .role_hint {
  color: var(--text-secondary);
}

html[data-theme='dark'] .auth-uiview .note-link:hover {
  color: var(--text-primary);
}

html[data-theme='dark'] .auth-uiview .input_field {
  background: rgba(0, 0, 0, 0.25);
  border-color: var(--border-color);
  color: var(--text-primary);
  filter: none;
}

html[data-theme='dark'] .auth-uiview .icon {
  color: var(--text-secondary);
}

html[data-theme='dark'] .auth-uiview .input_field::placeholder {
  color: var(--text-secondary);
}

html[data-theme='dark'] .auth-uiview .input_field:focus {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.24);
  background: rgba(0, 0, 0, 0.2);
}

html[data-theme='dark'] .auth-uiview .separator .line {
  background-color: var(--border-color);
}

html[data-theme='dark'] .auth-uiview .sign-in_ggl {
  background: rgba(0, 0, 0, 0.2);
  border-color: var(--border-color);
  color: var(--text-primary);
  filter: none;
}

html[data-theme='dark'] .auth-uiview .sign-in_ggl:hover {
  border-color: color-mix(in srgb, white 35%, var(--border-color));
  color: var(--text-primary);
}

html[data-theme='dark'] .auth-uiview .auth_error {
  background: rgba(211, 60, 60, 0.12);
  border-color: rgba(211, 60, 60, 0.35);
}
</style>
