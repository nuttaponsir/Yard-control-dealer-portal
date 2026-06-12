// ============================================================================
// useCart() — client cart state (Dev2 owns the logic; keeps the exported shape).
// SHARED contract: catalog adds lines, the cart sidebar reads `lines`/`total`.
// Also tracks the active (Autologic-verified) VIN context used at checkout. The
// VIN is shared app-wide via useState so the VIN page → catalog hand-off works
// (Dev1 sets it; catalog falls back to the ?vin= query param).
// ============================================================================
import { computed } from 'vue'
import type { CartLine, Part } from '~/types'

export function useCart() {
  const lines = useState<CartLine[]>('cart:lines', () => [])
  const activeVin = useState<string | null>('cart:activeVin', () => null)
  // Model/year of the active VIN, carried from the VIN page so the catalog can
  // label the vehicle without an extra lookup (falls back to a fetch otherwise).
  const activeVinModel = useState<string | null>('cart:activeVinModel', () => null)
  const activeVinYear = useState<number | null>('cart:activeVinYear', () => null)

  const count = computed(() => lines.value.reduce((s, l) => s + l.qty, 0))
  const total = computed(() => lines.value.reduce((s, l) => s + l.qty * l.unitPrice, 0))

  function add(part: Part, qty = 1) {
    const existing = lines.value.find((l) => l.partId === part.id)
    if (existing) existing.qty += qty
    else
      lines.value.push({
        partId: part.id,
        sku: part.sku,
        name: part.name,
        unitPrice: part.price,
        qty,
      })
  }

  function setQty(partId: number, qty: number) {
    const line = lines.value.find((l) => l.partId === partId)
    if (!line) return
    if (qty <= 0) remove(partId)
    else line.qty = qty
  }

  function remove(partId: number) {
    lines.value = lines.value.filter((l) => l.partId !== partId)
  }

  function clear() {
    lines.value = []
  }

  function qtyOf(partId: number): number {
    return lines.value.find((l) => l.partId === partId)?.qty ?? 0
  }

  function setActiveVin(vin: string | null, model: string | null = null, year: number | null = null) {
    activeVin.value = vin
    activeVinModel.value = model
    activeVinYear.value = year
  }

  return {
    lines,
    count,
    total,
    add,
    setQty,
    remove,
    clear,
    qtyOf,
    activeVin,
    activeVinModel,
    activeVinYear,
    setActiveVin,
  }
}
