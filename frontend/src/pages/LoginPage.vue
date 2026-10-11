<script setup lang="ts">
/**
 * Вход в портал. На компьютере — форма слева и фото полей справа,
 * на телефоне — только форма. Ошибки Auth переводятся в понятный текст.
 */
import { CircleAlertIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Button } from '@/components/ui/shadcn/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/shadcn/input-group'
import { Label } from '@/components/ui/shadcn/label'
import { Spinner } from '@/components/ui/shadcn/spinner'
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const capsLock = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)

function onPasswordKey(e: KeyboardEvent) {
  capsLock.value = typeof e.getModifierState === 'function' && e.getModifierState('CapsLock')
}

/** Сообщения Auth — по-русски и без служебных подробностей. */
function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Неверная почта или пароль.'
  if (m.includes('email not confirmed')) return 'Почта не подтверждена. Обратитесь к руководителю или в ИТ-отдел.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'
  return msg || 'Не удалось войти. Попробуйте ещё раз.'
}

async function submit() {
  error.value = null
  const trimmedEmail = email.value.trim()
  const trimmedPassword = password.value.trim()
  if (!trimmedEmail || !trimmedPassword) {
    error.value = 'Введите почту и пароль.'
    return
  }
  if (trimmedPassword.length < 6) {
    error.value = 'Пароль — не меньше 6 символов.'
    return
  }
  loading.value = true
  try {
    await auth.login(trimmedEmail, trimmedPassword)
    const redirect = (route.query.redirect as string) || '/news'
    router.push(redirect)
  } catch (e: unknown) {
    error.value = humanError(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="tw-scope grid min-h-svh bg-background lg:grid-cols-2">
    <div class="flex flex-col gap-6 p-6 md:p-10">
      <div class="flex items-center gap-3">
        <img src="/logo-128.webp" width="40" height="40" alt="" class="size-10 shrink-0" />
        <div class="grid leading-tight">
          <span class="text-sm font-bold tracking-wide">АГРО<span class="text-primary dark:text-emerald-400">СИСТЕМА</span></span>
          <span class="text-xs text-muted-foreground">Портал агронома</span>
        </div>
      </div>

      <div class="flex flex-1 items-center justify-center">
        <div class="grid w-full max-w-sm gap-6">
          <div class="grid gap-2">
            <h1 class="text-2xl font-semibold">Вход в портал</h1>
            <p class="text-sm text-muted-foreground">Введите рабочую почту и пароль.</p>
          </div>

          <form class="grid gap-4" novalidate @submit.prevent="submit">
            <div class="grid gap-2">
              <Label for="auth-email">Почта</Label>
              <InputGroup>
                <InputGroupAddon><MailIcon /></InputGroupAddon>
                <InputGroupInput
                  id="auth-email"
                  v-model="email"
                  type="email"
                  inputmode="email"
                  placeholder="name@mail.ru"
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck="false"
                  autofocus
                />
              </InputGroup>
            </div>

            <div class="grid gap-2">
              <Label for="auth-password">Пароль</Label>
              <InputGroup>
                <InputGroupAddon><LockIcon /></InputGroupAddon>
                <InputGroupInput
                  id="auth-password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Не меньше 6 символов"
                  autocomplete="current-password"
                  @keydown="onPasswordKey"
                  @keyup="onPasswordKey"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                    :aria-pressed="showPassword"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOffIcon v-if="showPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p v-if="capsLock" class="text-xs text-amber-700 dark:text-amber-300">Включён Caps Lock</p>
            </div>

            <Alert v-if="error" variant="destructive" role="alert">
              <CircleAlertIcon />
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>

            <Button type="submit" class="w-full" :disabled="loading">
              <Spinner v-if="loading" />
              {{ loading ? 'Проверяем…' : 'Войти' }}
            </Button>
          </form>

          <p class="text-sm text-muted-foreground">
            Нет доступа или забыли пароль? Учётные записи создаёт руководитель — обратитесь к нему или в ИТ-отдел.
          </p>
        </div>
      </div>

      <p class="text-center text-xs text-balance text-muted-foreground">
        Продолжая, вы принимаете
        <RouterLink class="text-foreground underline underline-offset-4" to="/rules">правила</RouterLink>
        использования корпоративного портала.
      </p>
    </div>

    <div class="relative hidden overflow-hidden bg-muted lg:block">
      <img
        src="/login-bg.webp"
        alt=""
        width="1920"
        height="1080"
        decoding="async"
        fetchpriority="high"
        class="absolute inset-0 size-full object-cover"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" aria-hidden="true" />
      <div class="absolute inset-x-0 bottom-0 grid gap-2 p-10 text-white">
        <p class="text-2xl font-semibold">Поля, склады, техника и команда — в одном месте</p>
        <p class="text-sm text-white/80">Задачи, учёт зерна, работа в поле и аналитика хозяйства.</p>
      </div>
    </div>
  </div>
</template>
