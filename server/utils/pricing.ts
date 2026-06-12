// ============================================================================
// Phase C — order money math (tiered discount + VAT).
// ----------------------------------------------------------------------------
// Pure, side-effect-free so it can be unit-tested and reused by reports later.
//   subtotal = Σ(unitPrice × qty)            (list price, pre-discount)
//   discount = round(subtotal × discountPct / 100)   (dealer grade tier, M7)
//   net      = subtotal − discount
//   vat      = round(net × vatRate / 100)            (appConfig vat_rate, M11)
//   total    = net + vat
// All amounts are integer THB (the schema stores integers).
// ============================================================================
export interface MoneyLine {
  unitPrice: number
  qty: number
}

export interface OrderMoney {
  subtotal: number
  discount: number
  vat: number
  total: number
}

export function computeOrderMoney(
  lines: MoneyLine[],
  discountPct: number,
  vatRate: number,
): OrderMoney {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const discount = Math.round((subtotal * discountPct) / 100)
  const net = subtotal - discount
  const vat = Math.round((net * vatRate) / 100)
  const total = net + vat
  return { subtotal, discount, vat, total }
}
