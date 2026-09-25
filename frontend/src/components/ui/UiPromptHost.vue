<script setup lang="ts">
/** Окно ввода для promptText() — Dialog + Label + Input из shadcn-vue. Стоит один раз в App.vue. */
import { ref, watch } from 'vue'
import { Input } from '@/components/ui/shadcn/input'
import { Label } from '@/components/ui/shadcn/label'
import { promptRequest } from '@/composables/usePromptText'
import UiButton from './UiButton.vue'
import UiModal from './UiModal.vue'

const value = ref('')
watch(promptRequest, (r) => {
  if (r) value.value = r.value
})

function finish(result: string | null) {
  const r = promptRequest.value
  promptRequest.value = null
  r?.resolve(result)
}
</script>

<template>
  <UiModal v-if="promptRequest" :title="promptRequest.title" :max-width="440" @close="finish(null)">
    <form id="ui-prompt-form" class="grid gap-2" @submit.prevent="finish(value)">
      <Label for="ui-prompt-input">{{ promptRequest.label }}</Label>
      <Input id="ui-prompt-input" v-model="value" autofocus />
    </form>
    <template #actions>
      <UiButton @click="finish(null)">Отмена</UiButton>
      <UiButton variant="primary" type="submit" form="ui-prompt-form" :disabled="!value.trim()">Сохранить</UiButton>
    </template>
  </UiModal>
</template>
