<script setup lang="ts">
/**
 * Подтверждение действия (в первую очередь удаления) вместо window.confirm —
 * AlertDialog из shadcn-vue: закрывается только кнопками, не кликом мимо.
 */
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog'
import UiButton from './UiButton.vue'

withDefaults(
  defineProps<{
    title: string
    text?: string
    confirmLabel?: string
    busyLabel?: string
    busy?: boolean
    danger?: boolean
  }>(),
  {
    text: 'Это действие нельзя отменить.',
    confirmLabel: 'Удалить',
    busyLabel: 'Удаление…',
    busy: false,
    danger: true,
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

function onOpenChange(open: boolean) {
  if (!open) emit('cancel')
}
</script>

<template>
  <AlertDialog :open="true" @update:open="onOpenChange">
    <AlertDialogContent class="ui-dialog" @escape-key-down="(e: Event) => busy && e.preventDefault()">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ title }}</AlertDialogTitle>
        <AlertDialogDescription>
          <slot>{{ text }}</slot>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <UiButton :disabled="busy" @click="emit('cancel')">Отмена</UiButton>
        <UiButton :variant="danger ? 'danger' : 'primary'" :disabled="busy" @click="emit('confirm')">
          {{ busy ? busyLabel : confirmLabel }}
        </UiButton>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
