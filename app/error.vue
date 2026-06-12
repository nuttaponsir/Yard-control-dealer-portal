<script setup lang="ts">
// Phase F — branded full-screen error page. Nuxt renders this for unhandled
// errors and unmatched routes (404). Matches the dark/brand theme used across
// the portal. clearError() resets Nuxt's error state and navigates home.
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const { t } = useI18n()

const code = computed(() => props.error?.statusCode ?? 500)
const isNotFound = computed(() => code.value === 404)
const title = computed(() =>
  isNotFound.value ? t('error.404.title') : t('error.500.title'),
)
const message = computed(() =>
  isNotFound.value ? t('error.404.body') : t('error.500.body'),
)

function goHome() {
  clearError({ redirect: '/dashboard' })
}
</script>

<template>
  <div class="relative grid min-h-screen place-items-center overflow-hidden bg-app p-6">
    <div class="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-600/20 blur-3xl" />
    <div class="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-brand-600/10 blur-3xl" />

    <div class="relative w-full max-w-md text-center">
      <p class="code text-7xl font-black leading-none text-brand-600">{{ code }}</p>
      <h1 class="mt-4 text-2xl font-bold text-app">{{ title }}</h1>
      <p class="mt-2 text-sm text-muted">{{ message }}</p>

      <div class="mt-8 flex items-center justify-center gap-3">
        <AppButton @click="goHome">{{ t('error.action.home') }}</AppButton>
      </div>
    </div>
  </div>
</template>
