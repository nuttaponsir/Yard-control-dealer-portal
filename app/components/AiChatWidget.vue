<script setup lang="ts">
// Phase I — floating AI chat (DEMO). A bottom-right launcher that opens a chat
// panel. Talks to POST /api/chat (rule-based engine: help/how-to + data Q&A).
// Only shown to authenticated users (mounted from the default layout).
import { computed, nextTick, ref } from 'vue'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const { t } = useI18n()
const { isAuthed, role } = useAuth()

const open = ref(false)
const sending = ref(false)
const input = ref('')
const scroller = ref<HTMLElement | null>(null)

// Starter prompt chips (mirrors the server's defaultSuggestions, kept here so
// the panel has content before the first round-trip).
const starters = computed<string[]>(() => {
  const base = [
    t('chat.starter.orders'),
    t('chat.starter.lowStock'),
    t('chat.starter.createOrder'),
    t('chat.starter.vin'),
  ]
  if (role.value === 'owner' || role.value === 'sales') base.push(t('chat.starter.credit'))
  if (role.value === 'admin' || role.value === 'owner') base.push(t('chat.starter.payments'))
  return base
})

const messages = ref<Msg[]>([])

function greet() {
  if (!messages.value.length) {
    messages.value.push({ role: 'assistant', content: t('chat.greeting') })
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    greet()
    await scrollToBottom()
  }
}

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

// Render the lightweight markdown the engine emits: **bold** and newlines.
function fmt(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
}

async function send(text?: string) {
  const content = (text ?? input.value).trim()
  if (!content || sending.value) return
  input.value = ''
  messages.value.push({ role: 'user', content })
  sending.value = true
  await scrollToBottom()
  try {
    const res = await $fetch<{ reply: string }>('/api/chat', {
      method: 'POST',
      body: { messages: messages.value.slice(-12) },
    })
    messages.value.push({ role: 'assistant', content: res.reply })
  } catch {
    messages.value.push({ role: 'assistant', content: t('chat.error') })
  } finally {
    sending.value = false
    await scrollToBottom()
  }
}
</script>

<template>
  <ClientOnly>
    <div v-if="isAuthed" class="fixed bottom-5 right-5 z-[55] print:hidden">
      <!-- panel -->
      <Transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="translate-y-3 opacity-0"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="translate-y-3 opacity-0"
      >
        <div
          v-if="open"
          class="mb-3 flex h-[32rem] max-h-[75vh] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-app bg-surface shadow-2xl"
        >
          <!-- header -->
          <div class="flex items-center justify-between border-b border-app bg-surface-2 px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-sm">🤖</span>
              <div class="leading-tight">
                <p class="text-sm font-bold text-app">{{ t('chat.title') }}</p>
                <p class="text-[10px] text-muted">{{ t('chat.subtitle') }}</p>
              </div>
            </div>
            <button class="rounded-lg p-1 text-muted transition hover:bg-surface hover:text-app" :aria-label="t('chat.close')" @click="open = false">
              ✕
            </button>
          </div>

          <!-- messages -->
          <div ref="scroller" class="flex-1 space-y-3 overflow-y-auto p-4">
            <div
              v-for="(m, i) in messages"
              :key="i"
              class="flex"
              :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
            >
              <div
                class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
                :class="m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-surface-2 text-app'"
                v-html="fmt(m.content)"
              />
            </div>
            <div v-if="sending" class="flex justify-start">
              <div class="rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">…</div>
            </div>

            <!-- starter chips (only before the user has asked anything) -->
            <div v-if="messages.length <= 1 && !sending" class="flex flex-wrap gap-1.5 pt-1">
              <button
                v-for="s in starters"
                :key="s"
                class="rounded-full border border-app bg-surface px-2.5 py-1 text-xs text-muted transition hover:border-brand-500 hover:text-app"
                @click="send(s)"
              >
                {{ s }}
              </button>
            </div>
          </div>

          <!-- input -->
          <form class="flex items-center gap-2 border-t border-app p-3" @submit.prevent="send()">
            <input
              v-model="input"
              type="text"
              :placeholder="t('chat.placeholder')"
              :disabled="sending"
              class="min-w-0 flex-1 rounded-xl border border-app bg-surface-2 px-3 py-2 text-sm text-app outline-none placeholder:text-muted focus:border-brand-500 disabled:opacity-50"
            >
            <button
              type="submit"
              :disabled="sending || !input.trim()"
              class="shrink-0 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-500 disabled:opacity-40"
            >
              {{ t('chat.send') }}
            </button>
          </form>
        </div>
      </Transition>

      <!-- launcher -->
      <button
        class="ml-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-xl transition hover:scale-105 hover:bg-brand-500"
        :aria-label="t('chat.title')"
        @click="toggle"
      >
        <span aria-hidden="true">{{ open ? '✕' : '💬' }}</span>
      </button>
    </div>
  </ClientOnly>
</template>
