<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AboutServicePage from '@/pages/AboutServicePage.vue'
import DashboardOverview from '@/components/dashboard/DashboardOverview.vue'

const route = useRoute()
const router = useRouter()

const isAboutTab = computed(() => route.query.tab === 'about')

function goOverviewTab() {
  void router.replace({ path: '/dashboard', query: {} })
}

function goAboutTab() {
  void router.replace({ path: '/dashboard', query: { tab: 'about' } })
}
</script>

<template>
  <div class="dashboard-page flex flex-col gap-6">
    <Tabs :model-value="isAboutTab ? 'about' : 'overview'">
      <TabsList aria-label="Вкладки раздела «Обзор»">
        <TabsTrigger id="dashboard-tab-overview" value="overview" @click="goOverviewTab">Обзор</TabsTrigger>
        <TabsTrigger id="dashboard-tab-about" value="about" @click="goAboutTab">О сервисе</TabsTrigger>
      </TabsList>
    </Tabs>

    <div v-if="!isAboutTab" role="tabpanel" aria-labelledby="dashboard-tab-overview">
      <h1 class="sr-only">Обзор</h1>
      <DashboardOverview />
    </div>

    <div
      v-show="isAboutTab"
      class="dashboard-about-panel"
      role="tabpanel"
      :aria-labelledby="'dashboard-tab-about'"
    >
      <AboutServicePage embedded />
    </div>
  </div>
</template>
