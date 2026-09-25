<script setup lang="ts">
/**
 * Сообщение об успешной операции — тост Sonner из shadcn-vue (Toaster стоит в
 * App.vue). API прежний: страница ставит `open` — показываем тост и сразу
 * отдаём `close`, окно подтверждать не нужно.
 */
import { watch } from 'vue'
import { toast } from 'vue-sonner'

const props = defineProps<{
  open: boolean
  title?: string
  message?: string
  buttonText?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

watch(
  () => props.open,
  (open) => {
    if (!open) return
    toast.success(props.title || 'Операция выполнена', { description: props.message || undefined })
    emit('close')
  },
  { immediate: true },
)
</script>

<template>
  <span hidden />
</template>
