// @vitest-environment happy-dom
// Test2 (QA, frontend/E2E). Component test for StatusBadge.
// Maps to AC-11.4 (Thai status labels render exactly per §4/§7) and the
// SPEC §4.1/§4.2 status->label/tone contract via app/utils/labels.ts.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBadge from '~/components/StatusBadge.vue'
import {
  ORDER_STATUS_LABELS,
  CLAIM_STATUS_LABELS,
  STATUS_TONE,
} from '~/utils/labels'

describe('StatusBadge', () => {
  // Order statuses (SPEC §4.1)
  const orderCases: Array<[string, string]> = [
    ['pending', 'รอดำเนินการ'],
    ['confirming', 'กำลังยืนยันสินค้า'],
    ['packing', 'กำลังแพ็ค'],
    ['shipped', 'จัดส่งแล้ว'],
    ['delivered', 'ส่งถึงแล้ว'],
  ]

  it.each(orderCases)('renders order status %s as the correct Thai label', (status, label) => {
    const wrapper = mount(StatusBadge, { props: { status } })
    expect(wrapper.text()).toContain(label)
    // sanity: spec label matches labels.ts
    expect(ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]).toBe(label)
  })

  it.each(orderCases)('applies the right tone classes for order status %s', (status) => {
    const wrapper = mount(StatusBadge, { props: { status } })
    const cls = wrapper.find('span').classes().join(' ')
    for (const tone of STATUS_TONE[status]!.split(' ')) {
      expect(cls).toContain(tone)
    }
  })

  // Claim statuses (SPEC §4.2) — only the ones the spec names with Thai labels.
  const claimCases: Array<[string, string]> = [
    ['submitted', 'ส่งคำร้อง'],
    ['reviewing', 'กำลังตรวจสอบ'],
    ['rejected', 'ปฏิเสธ'],
  ]

  it.each(claimCases)('renders claim status %s as the correct Thai label', (status, label) => {
    const wrapper = mount(StatusBadge, { props: { status } })
    expect(wrapper.text()).toContain(label)
    expect(CLAIM_STATUS_LABELS[status as keyof typeof CLAIM_STATUS_LABELS]).toBe(label)
  })

  it('falls back to a neutral tone and the raw value for an unknown status', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'mystery' } })
    expect(wrapper.text()).toContain('mystery')
    expect(wrapper.find('span').classes().join(' ')).toContain('bg-zinc-700/40')
  })

  it('honours an explicit label override prop', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'pending', label: 'CUSTOM' } })
    expect(wrapper.text()).toContain('CUSTOM')
    expect(wrapper.text()).not.toContain('รอดำเนินการ')
  })
})
