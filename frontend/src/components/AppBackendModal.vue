<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert'

defineProps<{
  message: string
  checking?: boolean
}>()

const emit = defineEmits<{
  retry: []
  close: []
}>()
</script>

<template>
  <UiModal title="Сервер временно недоступен" :max-width="440" @close="emit('close')">
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>{{ message }}</AlertTitle>
      <AlertDescription>Похоже, база данных сейчас не отвечает. Попробуйте повторить попытку через минуту.</AlertDescription>
    </Alert>
    <template #actions>
      <UiButton @click="emit('close')">Закрыть</UiButton>
      <UiButton variant="primary" :disabled="checking" @click="emit('retry')">
        {{ checking ? 'Проверка…' : 'Повторить' }}
      </UiButton>
    </template>
  </UiModal>
</template>
