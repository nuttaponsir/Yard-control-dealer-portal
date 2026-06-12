<script setup lang="ts">
// Root → dashboard (middleware sends unauthenticated users to /auth).
await navigateTo('/dashboard', { replace: true })
</script>

<template>
  <div />
</template>
