// @vitest-environment happy-dom
// Test2 (QA). Component tests for the shared UI primitives DataTable, StatCard,
// CategoryChip. Supports AC-2.1 (KPI cards), AC-4.3/AC-4.4 (catalog chips/cards),
// AC-7.3 (low-stock columns), AC-9.1 (directory columns), and the SCAFFOLD
// "mono column for codes (SKU/VIN/PO)" convention.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import DataTable from '~/components/DataTable.vue'
import StatCard from '~/components/StatCard.vue'
import CategoryChip from '~/components/CategoryChip.vue'

describe('DataTable', () => {
  const columns = [
    { key: 'po', label: 'เลขที่ PO', mono: true },
    { key: 'value', label: 'มูลค่า', align: 'right' as const },
  ]
  const rows = [
    { po: 'PO-2026-089793', value: 1120 },
    { po: 'PO-2026-089794', value: 700 },
  ]

  it('renders headers from column labels', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })
    const heads = wrapper.findAll('th').map((th) => th.text())
    expect(heads).toEqual(['เลขที่ PO', 'มูลค่า'])
  })

  it('renders a row per data item with cell values', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })
    const bodyRows = wrapper.findAll('tbody tr')
    expect(bodyRows).toHaveLength(2)
    expect(wrapper.text()).toContain('PO-2026-089793')
    expect(wrapper.text()).toContain('1120')
  })

  it('applies the mono "code" class to flagged columns (SKU/VIN/PO convention)', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })
    const firstCellClasses = wrapper.find('tbody tr td').classes()
    expect(firstCellClasses).toContain('code')
  })

  it('right-aligns columns flagged align=right', () => {
    const wrapper = mount(DataTable, { props: { columns, rows } })
    const cells = wrapper.findAll('tbody tr:first-child td')
    expect(cells[1]!.classes()).toContain('text-right')
  })

  it('shows the empty state when there are no rows', () => {
    const wrapper = mount(DataTable, { props: { columns, rows: [] } })
    expect(wrapper.text()).toContain('ไม่มีข้อมูล')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  })

  it('supports the #cell-<key> slot for custom rendering', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows },
      slots: { 'cell-po': (p: any) => h('b', { class: 'custom' }, `#${p.value}`) },
    })
    expect(wrapper.find('b.custom').text()).toBe('#PO-2026-089793')
  })
})

describe('StatCard', () => {
  it('renders label and numeric value (KPI tile)', () => {
    const wrapper = mount(StatCard, { props: { label: 'รอดำเนินการ', value: 12 } })
    expect(wrapper.text()).toContain('รอดำเนินการ')
    expect(wrapper.text()).toContain('12')
  })

  it('renders an optional hint', () => {
    const wrapper = mount(StatCard, { props: { label: 'รวม', value: 40, hint: 'ทั้งเครือข่าย' } })
    expect(wrapper.text()).toContain('ทั้งเครือข่าย')
  })

  it('applies the tone class for the given tone', () => {
    const wrapper = mount(StatCard, { props: { label: 'X', value: 1, tone: 'emerald' } })
    expect(wrapper.find('div').classes().join(' ')).toContain('emerald')
  })

  it('defaults to the default tone when none is given', () => {
    const wrapper = mount(StatCard, { props: { label: 'X', value: 1 } })
    expect(wrapper.find('div').classes().join(' ')).toContain('bg-surface')
  })
})

describe('CategoryChip', () => {
  it('renders its slot content (category label)', () => {
    const wrapper = mount(CategoryChip, { slots: { default: 'เบรก' } })
    expect(wrapper.text()).toBe('เบรก')
  })

  it('shows selected styling when active', () => {
    const wrapper = mount(CategoryChip, { props: { active: true }, slots: { default: 'ไฟ' } })
    const cls = wrapper.find('button').classes().join(' ')
    expect(cls).toContain('border-brand-600')
    expect(cls).toContain('text-brand-300')
  })

  it('shows the unselected (default) styling when inactive', () => {
    const wrapper = mount(CategoryChip, { props: { active: false }, slots: { default: 'ไฟ' } })
    const cls = wrapper.find('button').classes().join(' ')
    expect(cls).toContain('text-muted')
    expect(cls).not.toContain('border-brand-600')
  })
})
