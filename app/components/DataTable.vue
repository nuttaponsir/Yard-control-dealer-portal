<script setup lang="ts" generic="T extends Record<string, any>">
// SHARED component (SA owns). Generic table. Columns declare key + label and an
// optional `mono` flag for codes (SKU/VIN/PO). Use the #cell-<key> slot for
// custom rendering (e.g. a StatusBadge).
interface Column {
  key: string
  label: string
  mono?: boolean
  align?: 'left' | 'right'
}
defineProps<{ columns: Column[]; rows: T[] }>()
const { t } = useI18n()
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-app">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-app bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <th
            v-for="c in columns"
            :key="c.key"
            class="px-4 py-2.5 font-semibold"
            :class="c.align === 'right' ? 'text-right' : ''"
          >
            {{ c.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in rows"
          :key="i"
          class="border-b border-app/60 last:border-0 hover:bg-surface-2/50"
        >
          <td
            v-for="c in columns"
            :key="c.key"
            class="px-4 py-2.5 text-app"
            :class="[c.mono ? 'code' : '', c.align === 'right' ? 'text-right' : '']"
          >
            <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">
              {{ row[c.key] }}
            </slot>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length" class="px-4 py-8 text-center text-muted">
            {{ t('common.empty') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
