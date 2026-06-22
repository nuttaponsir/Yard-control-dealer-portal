<script setup lang="ts">
// /auth — Dev1 owns. Full-screen login: edge-to-edge dark-red hero (left) +
// stacked login / demo cards (right), with a TH/EN switch and quick-pick role
// cards that prefill the form. Theme: nuxt-tailwind-dark-theme (brand ramp).
import { ref } from 'vue'
import type { Role } from '~/types'

definePageMeta({ layout: 'auth' })

const { login, seedDemo, demoAccounts, demoPassword } = useAuth()
const { t, lang } = useI18n()
const { logoUrl, load: loadBrand } = useBrand()
onMounted(loadBrand)

const email = ref('admin@demo.co')
const password = ref(demoPassword)
const error = ref('')
const busy = ref(false)
const seedMsg = ref('')

const STATS = computed(() => [
  { value: '100+', label: t('auth.stats.dealers') },
  { value: '5', label: t('auth.stats.models') },
  { value: '2', label: t('auth.stats.warehouses') },
])

// Per-role visual identity for the quick-pick cards (gradient + inline icon).
// Icons are stored as SVG path-data arrays and rendered with <path v-for>, so
// no raw-HTML injection (v-html) is needed.
const ROLE_UI: Record<Role, { gradient: string; icon: string[] }> = {
  admin: {
    gradient: 'from-brand-500 to-brand-700',
    icon: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
  },
  owner: {
    gradient: 'from-violet-500 to-indigo-600',
    icon: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9h.01', 'M9 13h.01', 'M9 17h.01'],
  },
  sales: {
    gradient: 'from-amber-500 to-orange-600',
    icon: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  },
  warehouse: {
    gradient: 'from-teal-500 to-emerald-600',
    icon: [
      'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
      'm3.3 7 8.7 5 8.7-5',
      'M12 22V12',
    ],
  },
}

function setLang(l: 'th' | 'en') {
  lang.value = l
}

async function onSubmit() {
  error.value = ''
  busy.value = true
  try {
    await login(email.value, password.value)
    await navigateTo('/dashboard')
  } catch (e: unknown) {
    const err = e as { data?: { statusMessage?: string }; statusMessage?: string }
    error.value = err?.data?.statusMessage || err?.statusMessage || t('auth.error.login')
  } finally {
    busy.value = false
  }
}

function pick(addr: string) {
  email.value = addr
  password.value = demoPassword
}

async function onSeed() {
  busy.value = true
  error.value = ''
  seedMsg.value = ''
  try {
    await seedDemo()
    seedMsg.value = t('auth.seed.success')
  } catch {
    error.value = t('auth.seed.error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-2">
    <!-- ── Left: edge-to-edge dark-red hero ───────────────────────────────── -->
    <div class="relative flex flex-col justify-between gap-12 overflow-hidden bg-brand-950 p-8 md:p-12">
      <!-- ambient red glow -->
      <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-900/60 via-brand-950 to-black"/>
      <div class="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-600/20 blur-3xl"/>

      <!-- top row: brand + language switch -->
      <div class="relative z-10 flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <img
            v-if="logoUrl"
            :src="logoUrl"
            :alt="t('auth.brand.kicker')"
            class="h-12 w-12 rounded-2xl bg-white object-contain shadow-lg shadow-brand-900/50"
          >
          <div v-else class="grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-sm font-extrabold tracking-tight text-white shadow-lg shadow-brand-900/50">
            <span>JW<span class="text-accent-400">D</span></span>
          </div>
          <div class="leading-tight">
            <p class="text-[11px] font-semibold tracking-[0.22em] text-accent-400">{{ t('auth.brand.kicker') }}</p>
            <p class="text-lg font-bold text-white">{{ t('auth.brand.name') }}</p>
          </div>
        </div>

        <div class="inline-flex rounded-lg border border-brand-800/80 bg-brand-950/50 p-0.5 text-xs font-semibold">
          <button
            type="button"
            class="rounded-md px-3 py-1 transition"
            :class="lang === 'th' ? 'bg-brand-600 text-white' : 'text-brand-200 hover:text-white'"
            @click="setLang('th')"
          >
            TH
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1 transition"
            :class="lang === 'en' ? 'bg-brand-600 text-white' : 'text-brand-200 hover:text-white'"
            @click="setLang('en')"
          >
            EN
          </button>
        </div>
      </div>

      <!-- headline + stats -->
      <div class="relative z-10 max-w-md">
        <h1 class="text-3xl font-bold leading-tight text-white md:text-4xl">
          {{ t('auth.hero.title') }}
        </h1>
        <p class="mt-4 text-sm leading-relaxed text-brand-200/90">
          {{ t('auth.hero.body') }}
        </p>
        <div class="mt-7 flex flex-wrap gap-3">
          <div
            v-for="s in STATS"
            :key="s.label"
            class="rounded-xl border border-brand-800 bg-brand-900/40 px-4 py-2.5"
          >
            <span class="text-sm font-bold text-white">{{ s.value }}</span>
            <span class="ml-1.5 text-xs text-brand-200">{{ s.label }}</span>
          </div>
        </div>
      </div>

      <p class="relative z-10 text-[11px] text-brand-200/70">{{ t('auth.footer') }}</p>
    </div>

    <!-- ── Right: login + demo cards ──────────────────────────────────────── -->
    <div class="flex items-center justify-center bg-app p-6 md:p-10">
      <div class="w-full max-w-md space-y-6">
        <!-- login card -->
        <div class="rounded-2xl border border-app bg-surface p-6 md:p-8">
          <h2 class="text-2xl font-bold text-app">{{ t('auth.login.title') }}</h2>
          <p class="mt-1 text-sm text-muted">{{ t('auth.login.subtitle') }}</p>

          <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-muted">{{ t('auth.field.email') }}</label>
              <input
                v-model="email"
                type="email"
                autocomplete="email"
                placeholder="you@dealer.co.th"
                class="w-full rounded-lg border border-app bg-app px-3 py-2.5 text-sm text-app"
              >
            </div>
            <div>
              <label class="mb-1.5 block text-xs font-semibold text-muted">{{ t('auth.field.password') }}</label>
              <input
                v-model="password"
                type="password"
                autocomplete="current-password"
                class="w-full rounded-lg border border-app bg-app px-3 py-2.5 text-sm text-app"
              >
            </div>
            <p v-if="error" class="text-xs text-rose-400">{{ error }}</p>
            <AppButton type="submit" :disabled="busy" class="mt-1 w-full">
              {{ t('action.login') }}
            </AppButton>
          </form>
        </div>

        <!-- demo card -->
        <div class="rounded-2xl border border-app bg-surface p-6 md:p-8">
          <h3 class="text-sm font-bold text-app">{{ t('auth.demo.title') }}</h3>
          <p class="mt-1 text-xs text-muted">
            {{ t('auth.demo.passwordHint') }}
            <span class="code text-app">{{ demoPassword }}</span>
          </p>

          <AppButton variant="outline" size="sm" :disabled="busy" class="mt-3 w-full" @click="onSeed">
            {{ t('auth.demo.seedButton') }}
          </AppButton>
          <p v-if="seedMsg" class="mt-2 text-[11px] text-emerald-400">{{ seedMsg }}</p>

          <div class="mt-4 grid grid-cols-2 gap-3">
            <button
              v-for="a in demoAccounts"
              :key="a.email"
              type="button"
              :aria-pressed="email === a.email"
              class="group relative overflow-hidden rounded-xl bg-gradient-to-br p-3.5 text-left text-white shadow-sm transition hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              :class="email === a.email
                ? [ROLE_UI[a.role].gradient, 'ring-2 ring-white shadow-lg shadow-black/30']
                : [ROLE_UI[a.role].gradient, 'opacity-90 hover:opacity-100']"
              @click="pick(a.email)"
            >
              <span class="grid h-9 w-9 place-items-center rounded-lg bg-white/20">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="h-5 w-5"
                  aria-hidden="true"
                >
                  <path v-for="(d, i) in ROLE_UI[a.role].icon" :key="i" :d="d" />
                </svg>
              </span>
              <p class="mt-2.5 text-sm font-bold">{{ t('auth.role.' + a.role) }}</p>
              <p class="code text-[11px] text-white/85">{{ a.email }}</p>

              <!-- selected check -->
              <span
                v-if="email === a.email"
                class="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-white text-brand-700"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
                  <path d="m5 12 4 4L19 7" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
