<script setup lang="ts">
/**
 * Пагинация реестров — Pagination из shadcn-vue: «Показано a – b из N»,
 * кнопки «Назад / Далее», номера страниц с многоточием, «На странице» (Select).
 * v-model:page, v-model:page-size — как раньше. Страницы нумеруются с 1;
 * смена размера страницы сама возвращает на первую.
 */
import { computed } from 'vue'
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/shadcn/pagination'
import UiSelect from './UiSelect.vue'

const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    pageSizeOptions?: readonly number[]
    /** Без выбора «На странице» (размер страницы фиксирован). */
    hideSize?: boolean
  }>(),
  { pageSizeOptions: () => [5, 10, 20, 50], hideSize: false },
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [size: number]
}>()

const rangeStart = computed(() => (props.total ? (props.page - 1) * props.pageSize + 1 : 0))
const rangeEnd = computed(() => Math.min(props.page * props.pageSize, props.total))

function setPage(p: number) {
  if (p !== props.page) emit('update:page', p)
}

function setSize(size: number) {
  emit('update:pageSize', size)
  if (props.page !== 1) emit('update:page', 1)
}
</script>

<template>
  <footer class="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
    <p class="text-muted-foreground m-0">
      Показано <span class="text-foreground font-medium">{{ rangeStart }}</span>
      – <span class="text-foreground font-medium">{{ rangeEnd }}</span>
      из <span class="text-foreground font-medium">{{ total }}</span>
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <Pagination
        v-slot="{ page: current }"
        :page="page"
        :items-per-page="pageSize"
        :total="Math.max(total, 1)"
        :sibling-count="1"
        show-edges
        class="mx-0 w-auto"
        @update:page="setPage"
      >
        <PaginationContent v-slot="{ items }">
          <PaginationPrevious size="icon" aria-label="Предыдущая страница"><ChevronLeftIcon /></PaginationPrevious>
          <template v-for="(item, index) in items" :key="index">
            <PaginationItem v-if="item.type === 'page'" :value="item.value" :is-active="item.value === current">
              {{ item.value }}
            </PaginationItem>
            <PaginationEllipsis v-else :index="index" />
          </template>
          <PaginationNext size="icon" aria-label="Следующая страница"><ChevronRightIcon /></PaginationNext>
        </PaginationContent>
      </Pagination>
      <label v-if="!hideSize" class="text-muted-foreground flex items-center gap-2">
        <span class="whitespace-nowrap">На странице</span>
        <UiSelect
          :model-value="pageSize"
          :options="pageSizeOptions.map((n) => ({ value: n, label: String(n) }))"
          size="sm"
          aria-label="Строк на странице"
          @update:model-value="setSize"
        />
      </label>
    </div>
  </footer>
</template>
