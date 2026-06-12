<script setup lang="ts">
const { title, subtitle } = usePageTitle()
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-app">
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader :title="title" :subtitle="subtitle" />
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
