<script setup lang="ts">
/** Окно подтверждения для askConfirm() — UiConfirmModal. Стоит один раз в App.vue. */
import { confirmRequest } from '@/composables/useConfirm'
import UiConfirmModal from './UiConfirmModal.vue'

function finish(ok: boolean) {
  const r = confirmRequest.value
  confirmRequest.value = null
  r?.resolve(ok)
}
</script>

<template>
  <UiConfirmModal
    v-if="confirmRequest"
    :title="confirmRequest.title"
    :text="confirmRequest.text"
    :confirm-label="confirmRequest.confirmLabel"
    @confirm="finish(true)"
    @cancel="finish(false)"
  />
</template>
