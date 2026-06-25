<script setup lang="ts">
// SHARED. Fixed bottom-right toast. Render persistently and drive via `message`
// (shows while truthy). `tone` picks the semantic color. Replaces the ad-hoc
// toast <div> repeated across catalog/returns/payments/issues.
withDefaults(defineProps<{ message?: string | null; tone?: 'success' | 'error' }>(), {
  message: null,
  tone: 'success',
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="message"
      class="fixed bottom-6 right-6 z-[60] rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg"
      :class="tone === 'error'
        ? 'border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-300'
        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'"
      role="status"
      aria-live="polite"
    >
      {{ message }}
    </div>
  </Transition>
</template>
