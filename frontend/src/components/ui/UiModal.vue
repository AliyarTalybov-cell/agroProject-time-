<script setup lang="ts">
/**
 * Окно проекта — Dialog из shadcn-vue: затемнение, заголовок, крестик, тело
 * (слот по умолчанию), кнопки (слот `actions`, как DialogFooter).
 *
 * Показывать через v-if у родителя: окно закрывается по крестику, по клику
 * вне окна и по Esc — во всех случаях эмитит `close`, решать закрыть ли
 * (например, пока идёт сохранение) остаётся родителю. Списки, календари и
 * подсказки внутри окна (Reka UI) закрываются первыми — это делает сам Dialog.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog'

const props = withDefaults(
  defineProps<{
    title: string
    /** Ширина окна, px (на узком экране — во всю ширину минус поля). 560 — форма, 460 — подтверждение. */
    maxWidth?: number
    /** Блокирует закрытие (крестик, клик вне окна, Esc) — например, во время сохранения. */
    closeDisabled?: boolean
    /** Подпись под заголовком (DialogDescription). */
    description?: string
  }>(),
  { maxWidth: 560, closeDisabled: false, description: undefined },
)

const emit = defineEmits<{ close: [] }>()

function onOpenChange(open: boolean) {
  if (!open && !props.closeDisabled) emit('close')
}

function guard(e: Event) {
  if (props.closeDisabled) e.preventDefault()
}
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent
      class="ui-dialog"
      :style="{ maxWidth: `min(calc(100vw - 2rem), ${maxWidth}px)` }"
      @escape-key-down="guard"
      @pointer-down-outside="guard"
      @interact-outside="guard"
    >
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription :class="{ 'sr-only': !description }">{{ description || title }}</DialogDescription>
      </DialogHeader>
      <div class="ui-dialog-body">
        <slot />
      </div>
      <DialogFooter v-if="$slots.actions">
        <slot name="actions" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
