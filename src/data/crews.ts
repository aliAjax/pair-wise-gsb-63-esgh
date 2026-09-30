import type { Qualification, ScheduleSlot, ShiftPreset } from '../types'

export interface Crew {
  id: string
  name: string
  lead: string
  quals: Qualification[]
  mobile: string
}

export const crews: Crew[] = [
  { id: 'CREW-MECH1', name: '维修一组', lead: '孙兆远', quals: ['高处作业', '焊接作业', '起重作业'], mobile: '对讲 101' },
  { id: 'CREW-MECH2', name: '维修二组', lead: '韩立冬', quals: ['液压维修', '焊接作业'], mobile: '对讲 102' },
  { id: 'CREW-ELEC', name: '电气班组', lead: '沈柏舟', quals: ['电气作业', '高处作业'], mobile: '对讲 103' },
  { id: 'CREW-INSP2', name: '检验二组', lead: '卢知秋', quals: ['高处作业'], mobile: '对讲 104' }
]

export const QUAL_LABEL: Record<Qualification, string> = {
  高处作业: '高处作业',
  电气作业: '电气作业',
  焊接作业: '焊接作业',
  液压维修: '液压维修',
  起重作业: '起重作业'
}

export const ALL_QUALIFICATIONS: Qualification[] = ['高处作业', '电气作业', '焊接作业', '液压维修', '起重作业']

export function getCrew(id: string | null | undefined): Crew | undefined {
  return crews.find((crew) => crew.id === id)
}

export function crewNameOf(id: string | null | undefined): string {
  return getCrew(id)?.name ?? '未派班'
}

/** 班组是否同时满足全部资质要求 */
export function crewSatisfies(id: string, required: Qualification[]): boolean {
  const crew = getCrew(id)
  return !!crew && required.every((qual) => crew.quals.includes(qual))
}

/** 班次预设：演示日期 2026-09-30（与 seed 时间一致） */
export const SHIFT_PRESETS: Record<ShiftPreset, ScheduleSlot> = {
  早班: { start: '2026-09-30T08:00', end: '2026-09-30T16:00' },
  中班: { start: '2026-09-30T16:00', end: '2026-09-30T23:59' },
  晚班: { start: '2026-10-01T00:00', end: '2026-10-01T08:00' }
}

export const SHIFT_ORDER: ShiftPreset[] = ['早班', '中班', '晚班']

export function slotsOverlap(a: ScheduleSlot, b: ScheduleSlot): boolean {
  return a.start < b.end && b.start < a.end
}

/** 根据日期与班次生成预设时段 */
export function presetSlot(shift: string, date = '2026-09-30'): ScheduleSlot {
  if (shift === '中班') return { start: `${date}T16:00`, end: `${date}T23:59` }
  if (shift === '晚班') {
    const next = new Date(`${date}T00:00`)
    next.setDate(next.getDate() + 1)
    const nextDate = next.toISOString().slice(0, 10)
    return { start: `${nextDate}T00:00`, end: `${nextDate}T08:00` }
  }
  return { start: `${date}T08:00`, end: `${date}T16:00` }
}

/** 时段落在哪个班次（跨班时按开始时间判定，仅用于展示） */
export function shiftOfSlot(slot: ScheduleSlot): string {
  const hour = Number(slot.start.slice(11, 13))
  if (hour >= 16 && hour < 24) return '中班'
  if (hour >= 0 && hour < 8) return '晚班'
  return '早班'
}

export function formatSlot(slot: ScheduleSlot | null | undefined): string {
  if (!slot) return '未排时段'
  return `${slot.start.replace('T', ' ')} – ${slot.end.slice(11)}`
}

export function formatStamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

/** 同设备编号/名称视为同一台设备 */
export function sameDevice(a: { deviceCode: string }, b: { deviceCode: string }): boolean {
  return a.deviceCode.trim() === b.deviceCode.trim()
}
