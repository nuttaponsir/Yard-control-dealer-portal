// ============================================================================
// useAuth() — client auth composable (Dev1 owns; SHARED contract).
// Talks to the real server session API. State is shared app-wide via useState.
// ============================================================================
import { computed } from 'vue'
import type { Role, SessionUser } from '~/types'

export interface DemoAccount {
  email: string
  role: Role
  label: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'admin@demo.co', role: 'admin', label: 'ผู้ดูแลระบบ' },
  { email: 'owner@demo.co', role: 'owner', label: 'เจ้าของดีลเลอร์' },
  { email: 'sales@demo.co', role: 'sales', label: 'ฝ่ายขาย' },
  { email: 'warehouse@demo.co', role: 'warehouse', label: 'คลังสินค้า' },
]
export const DEMO_PASSWORD = 'demo1234'

export function useAuth() {
  const user = useState<SessionUser | null>('auth:user', () => null)

  const isAuthed = computed(() => user.value != null)
  const role = computed<Role | null>(() => user.value?.role ?? null)
  const can = (roles?: Role[]) =>
    !roles || roles.length === 0 || (role.value != null && roles.includes(role.value))

  /** Fetch the current session (used by middleware on first load). */
  async function fetchMe() {
    // useRequestFetch() forwards the incoming request's cookies during SSR.
    // Plain $fetch does NOT, so on a full page load the server-side session
    // check would see no cookie, return null, and the global middleware would
    // SSR-redirect an authenticated user to /auth — then the client bounces
    // back to the page, leaving the auth layout's root class stuck on the
    // default layout (the "stacked sidebar" rendering bug).
    const requestFetch = useRequestFetch()
    const { user: u } = await requestFetch<{ user: SessionUser | null }>('/api/auth/me')
    user.value = u
    return u
  }

  async function login(email: string, password: string) {
    const { user: u } = await $fetch<{ user: SessionUser | null }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    user.value = u
    return u
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  async function seedDemo() {
    return $fetch<{ ok: boolean }>('/api/auth/seed-demo', { method: 'POST' })
  }

  return {
    user,
    isAuthed,
    role,
    can,
    fetchMe,
    login,
    logout,
    seedDemo,
    demoAccounts: DEMO_ACCOUNTS,
    demoPassword: DEMO_PASSWORD,
  }
}
