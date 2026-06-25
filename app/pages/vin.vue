<script setup lang="ts">
// /vin — the VIN check is now consolidated into /accessories (search +
// lookup live there). This route is kept only as a redirect so existing
// bookmarks / deep-links land in the right place.
await navigateTo('/accessories', { redirectCode: 301 })
</script>

<template>
  <div />
</template>
