<script setup lang="ts">
// SHARED. Centered modal shell with backdrop + standard header. Drive with
// `open`; emits `close` on backdrop click or the ✕ button. Body goes in the
// default slot; footer actions in the optional #footer slot. Replaces the
// hand-rolled modal <div> repeated across the WMS/admin pages.
defineProps<{ open: boolean; title?: string; maxWidth?: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      @click.self="emit('close')"
    >
      <div
        class="max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-app bg-surface p-5 shadow-xl"
        :class="maxWidth ?? 'max-w-md'"
      >
        <div v-if="title || $slots.title" class="mb-4 flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold text-app">
            <slot name="title">{{ title }}</slot>
          </h2>
          <button class="text-muted hover:text-app" :aria-label="t('ui.close')" @click="emit('close')">✕</button>
        </div>
        <slot />
        <div v-if="$slots.footer" class="mt-4 flex justify-end gap-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>
