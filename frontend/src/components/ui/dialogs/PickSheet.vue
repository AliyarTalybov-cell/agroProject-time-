<script setup lang="ts">
/**
 * Нижняя панель выбора — Sheet из shadcn-vue (side="bottom"): заголовок,
 * подпись и список крупных строк с описанием. Для экрана оператора.
 */
import { ScrollArea } from '@/components/ui/shadcn/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/shadcn/sheet'

export interface PickSheetItem {
  key: string
  title: string
  description?: string
  onPick: () => void
}

defineProps<{ label: string; title: string; items: PickSheetItem[]; empty?: string }>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <Sheet v-model:open="open">
    <SheetContent side="bottom" class="mx-auto max-h-[85dvh] w-full max-w-2xl rounded-t-xl">
      <SheetHeader>
        <SheetDescription>{{ label }}</SheetDescription>
        <SheetTitle class="text-lg">{{ title }}</SheetTitle>
      </SheetHeader>
      <ScrollArea class="tw-scope min-h-0 flex-1 px-4 pb-4">
        <div class="grid gap-2">
          <button
            v-for="item in items"
            :key="item.key"
            type="button"
            class="hover:bg-accent focus-visible:ring-ring/50 grid gap-1 rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-3"
            @click="item.onPick()"
          >
            <span class="text-sm font-medium">{{ item.title }}</span>
            <span v-if="item.description" class="text-muted-foreground text-xs">{{ item.description }}</span>
          </button>
          <p v-if="!items.length && empty" class="text-muted-foreground py-6 text-center text-sm">{{ empty }}</p>
        </div>
      </ScrollArea>
    </SheetContent>
  </Sheet>
</template>
