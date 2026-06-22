<script setup lang="ts">
// /vin — the VIN check is now consolidated into /telematics (search + Autologic
// lookup live there). This route is kept only as a redirect so existing
// bookmarks / deep-links land in the right place.
await navigateTo('/telematics', { redirectCode: 301 })
</script>

<template>
  <div />
</template>
