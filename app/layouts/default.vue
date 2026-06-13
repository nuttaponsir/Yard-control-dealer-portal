<script setup lang="ts">
const { title, subtitle } = usePageTitle()
// Shared with AppSidebar/AppHeader: controls the mobile slide-in drawer.
const sidebarOpen = useState('ui:sidebarOpen', () => false)
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-app">
    <AppSidebar />
    <!-- Mobile backdrop: tap to close the drawer. Hidden on lg+ (docked sidebar). -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 bg-black/50 lg:hidden"
      aria-hidden="true"
      @click="sidebarOpen = false"
    />
    <div class="flex min-w-0 flex-1 flex-col">
      <AppHeader :title="title" :subtitle="subtitle" />
      <main class="flex-1 overflow-y-auto p-4 sm:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
