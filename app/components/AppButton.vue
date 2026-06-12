<script setup lang="ts">
// SHARED component (SA owns).
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false },
)
const base =
  'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]'
const sizes: Record<string, string> = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' }
const variants: Record<string, string> = {
  primary: 'bg-brand-600 text-white shadow-sm shadow-brand-900/40 hover:bg-brand-500',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
  outline: 'border border-app text-app hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-app',
  subtle: 'bg-surface-2 text-app hover:opacity-80',
}
</script>

<template>
  <button :type="type" :disabled="disabled" :class="[base, sizes[size], variants[variant]]">
    <slot />
  </button>
</template>
