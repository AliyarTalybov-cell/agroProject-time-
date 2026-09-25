<script setup lang="ts">
/**
 * Удаление события календаря — окно shadcn (Dialog + RadioGroup): у кого
 * удалить (у всех / только у меня) и какие слоты серии.
 */
import { Label } from '@/components/ui/shadcn/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/shadcn/radio-group'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'

defineProps<{
  busy: boolean
  asSeries: boolean
  audienceChoice: boolean
  canForAll: boolean
  canOnlyForMe: boolean
}>()

const audience = defineModel<'all' | 'only_me'>('audience', { required: true })
const scope = defineModel<'only_this' | 'this_and_following'>('scope', { required: true })
const emit = defineEmits<{ cancel: []; confirm: [] }>()
</script>

<template>
  <UiModal
    title="Удалить событие?"
    :description="asSeries ? 'Выберите вариант удаления для повторяющихся событий.' : 'Событие будет удалено без возможности восстановления.'"
    :max-width="460"
    :close-disabled="busy"
    @close="emit('cancel')"
  >
    <div v-if="audienceChoice" class="grid gap-3">
      <Label>Область удаления</Label>
      <RadioGroup v-model="audience" class="gap-3">
        <div class="flex items-center gap-2">
          <RadioGroupItem id="cal-del-all" value="all" :disabled="!canForAll" />
          <Label for="cal-del-all" class="font-normal">Удалить у всех участников</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem id="cal-del-me" value="only_me" :disabled="!canOnlyForMe" />
          <Label for="cal-del-me" class="font-normal">Удалить только у меня</Label>
        </div>
      </RadioGroup>
      <p v-if="!canForAll || !canOnlyForMe" class="text-muted-foreground text-xs">
        Удалить у всех может только постановщик или руководитель. Удалить у себя можно только после отказа от участия.
      </p>
    </div>
    <RadioGroup v-if="asSeries" v-model="scope" class="gap-3">
      <div class="flex items-center gap-2">
        <RadioGroupItem id="cal-del-one" value="only_this" />
        <Label for="cal-del-one" class="font-normal">Удалить только этот слот</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroupItem id="cal-del-next" value="this_and_following" />
        <Label for="cal-del-next" class="font-normal">Удалить этот и все последующие слоты</Label>
      </div>
    </RadioGroup>
    <template #actions>
      <UiButton :disabled="busy" @click="emit('cancel')">Отмена</UiButton>
      <UiButton variant="danger" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Удаление…' : 'Удалить' }}</UiButton>
    </template>
  </UiModal>
</template>
