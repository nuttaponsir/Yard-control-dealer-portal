// ============================================================================
// App configuration — Phase L (Quick wins).
// ----------------------------------------------------------------------------
// A typed catalog over the appConfig key/value table. The Settings page renders
// these definitions (grouped + typed inputs); server code reads values through
// getConfig()/getConfigMap() with a safe fallback to the catalog default so a
// missing row never breaks a request. This is the single source of truth for
// every tunable knob (VAT, credit policy, future WMS/integration keys).
// ============================================================================
import { inArray } from 'drizzle-orm'
import { db, schema } from '../db'

export type SettingType = 'number' | 'enum' | 'boolean' | 'string'

export interface SettingOption {
  value: string
  /** Thai label shown in the Settings dropdown. */
  label: string
}

export interface SettingDef {
  key: string
  /** Thai label. */
  label: string
  /** Thai help text shown under the field. */
  help: string
  /** Grouping bucket for the Settings page. */
  group: string
  type: SettingType
  /** String form of the fallback used when the row is absent. */
  default: string
  /** Allowed values for `type: 'enum'`. */
  options?: SettingOption[]
  /** Optional numeric bounds for `type: 'number'`. */
  min?: number
  max?: number
}

// Credit policy modes — referenced by the order placement guard.
export type CreditEnforcement = 'block' | 'warn' | 'off'

// WMS fulfillment mode — referenced by the OMS/WMS adapter (server/utils/wms).
export type WmsMode = 'internal' | 'external'

// ---- the catalog -----------------------------------------------------------
export const SETTINGS: SettingDef[] = [
  {
    key: 'vat_rate',
    label: 'อัตราภาษีมูลค่าเพิ่ม (VAT %)',
    help: 'ใช้คำนวณภาษีของทุกคำสั่งซื้อ ค่ามาตรฐานคือ 7%',
    group: 'การเงิน',
    type: 'number',
    default: '7',
    min: 0,
    max: 100,
  },
  {
    key: 'currency',
    label: 'สกุลเงิน',
    help: 'สกุลเงินที่ใช้แสดงผลทั้งระบบ',
    group: 'การเงิน',
    type: 'string',
    default: 'THB',
  },
  {
    key: 'credit_enforcement',
    label: 'การควบคุมวงเงินเครดิต',
    help: 'block = บล็อกเมื่อเกินวงเงิน · warn = อนุญาตแต่แจ้งเตือน · off = ไม่ตรวจสอบ',
    group: 'เครดิต',
    type: 'enum',
    default: 'block',
    options: [
      { value: 'block', label: 'บล็อก (ปฏิเสธเมื่อเกินวงเงิน)' },
      { value: 'warn', label: 'เตือน (อนุญาตแต่แจ้งเตือน)' },
      { value: 'off', label: 'ปิด (ไม่ตรวจสอบเครดิต)' },
    ],
  },
  {
    key: 'credit_overlimit_pct',
    label: 'เพดานเกินวงเงิน (%)',
    help: 'อนุญาตให้สั่งเกินวงเงินได้กี่เปอร์เซ็นต์ (ใช้เมื่อโหมด = block) เช่น 10 = เกินได้ 10%',
    group: 'เครดิต',
    type: 'number',
    default: '0',
    min: 0,
    max: 100,
  },
  {
    key: 'wms_mode',
    label: 'โหมดคลังสินค้า (WMS)',
    help: 'internal = ใช้ระบบจัดการคลังภายใน (สร้างใบจัดสินค้าเอง) · external = ส่งให้ WMS ภายนอก',
    group: 'คลังสินค้า',
    type: 'enum',
    default: 'internal',
    options: [
      { value: 'internal', label: 'ภายใน (สร้างใบจัดสินค้าในระบบ)' },
      { value: 'external', label: 'ภายนอก (ส่งให้ WMS ภายนอก)' },
    ],
  },
  {
    key: 'wms_auto_pick',
    label: 'สร้างใบจัดสินค้าอัตโนมัติ',
    help: 'เมื่อเปิด ระบบจะสร้างใบจัดสินค้า (pick task) อัตโนมัติเมื่อคำสั่งซื้อเข้าสู่สถานะ “กำลังแพ็ก” (เฉพาะโหมดภายใน)',
    group: 'คลังสินค้า',
    type: 'boolean',
    default: 'true',
  },
]

const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]))

/** Catalog default for a key (string form), or '' when the key is unknown. */
export function configDefault(key: string): string {
  return BY_KEY.get(key)?.default ?? ''
}

/**
 * Read several config keys at once. Returns a key→value map where any missing
 * row falls back to the catalog default, so callers never get `undefined`.
 */
export async function getConfigMap(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const k of keys) out[k] = configDefault(k)
  if (keys.length === 0) return out
  const rows = await db.query.appConfig.findMany({
    where: inArray(schema.appConfig.key, keys),
  })
  for (const r of rows) if (r.value != null) out[r.key] = r.value
  return out
}

/** Read a single config value (DB row → catalog default → ''). */
export async function getConfig(key: string): Promise<string> {
  return (await getConfigMap([key]))[key]!
}

/** Read a numeric config value, coercing safely to the catalog default. */
export async function getConfigNumber(key: string): Promise<number> {
  const raw = await getConfig(key)
  const n = Number(raw)
  return Number.isFinite(n) ? n : Number(configDefault(key)) || 0
}

/** Read the credit-enforcement mode, validated against the allowed set. */
export async function getCreditEnforcement(): Promise<CreditEnforcement> {
  const v = await getConfig('credit_enforcement')
  return v === 'warn' || v === 'off' ? v : 'block'
}

/** Read a boolean config value ('true' → true; anything else → false). */
export async function getConfigBool(key: string): Promise<boolean> {
  return (await getConfig(key)) === 'true'
}

/** Read the WMS fulfillment mode, validated against the allowed set. */
export async function getWmsMode(): Promise<WmsMode> {
  const v = await getConfig('wms_mode')
  return v === 'external' ? 'external' : 'internal'
}
