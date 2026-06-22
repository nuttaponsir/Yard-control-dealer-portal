import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  // SSR on: this app has a real Nitro server (Postgres + session auth), unlike
  // the localStorage-only reference project.
  ssr: true,
  modules: ['@nuxt/eslint'],
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    // Server-only. Override via NUXT_SESSION_SECRET in production.
    sessionSecret: 'dev-mitsubishi-dealer-portal-secret-change-me',
  },
  app: {
    head: {
      title: 'JWD Autologic — Dealer Portal',
      // Light by default; the saved preference (if 'dark') is applied pre-paint
      // by the inline script below to avoid a flash, and toggled at runtime via
      // useTheme().
      htmlAttrs: { lang: 'th' },
      script: [
        {
          innerHTML:
            ";(function(){try{if(localStorage.getItem('jwd-theme')==='dark')document.documentElement.classList.add('dark');}catch(e){}})();",
          tagPosition: 'head',
        },
      ],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'JWD Autologic Dealer Portal — VIN-gated spare-parts ordering, WMS, and telematics for the dealer network.',
        },
      ],
    },
  },
})
