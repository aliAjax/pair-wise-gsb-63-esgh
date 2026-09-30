import type { AuditEntry, InspectionItem, InspectionRecord, Qualification, RecordRevision, RevisionSource, ScheduleSlot } from '../types'
import { crewNameOf } from './crews'

const standardItems = (abnormal = false): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: abnormal ? '异常' : '正常', reading: abnormal ? '6.8 mm' : '2.1 mm', limit: '≤ 5.0 mm', note: abnormal ? '主支撑连接处磨损超限' : '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '≤ 3.0 m', note: '' },
  { id: 'lock', name: '锁止机构', result: abnormal ? '异常' : '正常', reading: abnormal ? '存在间隙' : '闭合可靠', limit: '无可见间隙', note: abnormal ? '安全压杠锁止存在回弹' : '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '动作可靠', note: '' }
]

interface SeedInput {
  id: string
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionRecord['status']
  risk: InspectionRecord['risk']
  stopped: boolean
  crewId: string | null
  slot: ScheduleSlot | null
  requiredQuals: Qualification[]
  dueDate: string
  items: InspectionItem[]
  evidenceCount: number
  createdAt: string
  updatedAt: string
  revisions: Array<Partial<RecordRevision> & { action: string; reason: string; at: string; source?: RevisionSource }>
}

function buildRecord(input: SeedInput): InspectionRecord {
  const revisions: RecordRevision[] = input.revisions.map((revision, index) => ({
    revision: index + 1,
    operator: revision.operator ?? '系统',
    source: revision.source ?? '主台',
    crewId: revision.crewId !== undefined ? revision.crewId : input.crewId,
    crewName: revision.crewId !== undefined ? crewNameOf(revision.crewId) : crewNameOf(input.crewId),
    slot: revision.slot !== undefined ? revision.slot : input.slot,
    shift: revision.shift ?? input.shift,
    snapshot: revision.snapshot ?? {
      status: input.status,
      risk: input.risk,
      stopped: input.stopped,
      assignedTo: crewNameOf(input.crewId),
      summary: '',
      evidenceCount: input.evidenceCount
    },
    ...revision
  } as RecordRevision))
  return {
    id: input.id,
    deviceCode: input.deviceCode,
    deviceName: input.deviceName,
    area: input.area,
    shift: input.shift,
    inspector: input.inspector,
    inspectedAt: input.inspectedAt,
    status: input.status,
    risk: input.risk,
    stopped: input.stopped,
    assignedTo: crewNameOf(input.crewId),
    dueDate: input.dueDate,
    items: input.items,
    evidenceCount: input.evidenceCount,
    version: revisions.length,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    crewId: input.crewId,
    slot: input.slot,
    requiredQuals: input.requiredQuals,
    displacedFromSlot: null,
    displacedBy: null,
    displacedAt: null,
    revisions,
    conflicts: []
  }
}

export const seedRecords: InspectionRecord[] = [
  // R1 紧急缺陷：尚未派班，派到维修一组 09-30 早班时会顶替 R2（低风险计划）
  buildRecord({
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-30T08:20:00', status: '需整改', risk: '紧急', stopped: true,
    crewId: null, slot: null, requiredQuals: ['高处作业', '焊接作业'], dueDate: '2026-09-30',
    items: standardItems(true), evidenceCount: 4, createdAt: '2026-09-30T08:20:00', updatedAt: '2026-09-30T08:40:00',
    revisions: [
      { action: '创建检验记录', operator: '周宁', reason: '班前检验发现锁止回弹，主支撑磨损超限', at: '2026-09-30T08:20:00', crewId: null, crewName: '未派班', slot: null },
      { action: '执行停用隔离', operator: '周宁', reason: '紧急风险缺陷处置前必须停用设备，现场已挂牌', at: '2026-09-30T08:40:00', crewId: null, crewName: '未派班', slot: null }
    ]
  }),
  // R2 低风险计划：占用维修一组 09-30 早班，可被 R1 顶替，顶替后进入待重排并保留原班次与证据
  buildRecord({
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '整改中', risk: '低', stopped: false,
    crewId: 'CREW-MECH1', slot: { start: '2026-09-30T08:30', end: '2026-09-30T11:30' }, requiredQuals: [], dueDate: '2026-10-02',
    items: standardItems(true), evidenceCount: 2, createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-29T16:10:00',
    revisions: [
      { action: '创建检验记录', operator: '李琪', reason: '例行润滑保养发现导轨异响', at: '2026-09-28T09:05:00', crewId: null, crewName: '未派班', slot: null },
      { action: '安排班组时段', operator: '值班主管', reason: '排入 09-30 早班计划，无特殊资质要求', at: '2026-09-29T16:10:00' }
    ]
  }),
  // R3 待复测：电气班组早班后段，复测通过即可关闭并恢复设备
  buildRecord({
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '低', stopped: false,
    crewId: 'CREW-ELEC', slot: { start: '2026-09-30T10:00', end: '2026-09-30T12:00' }, requiredQuals: ['电气作业'], dueDate: '2026-09-30',
    items: standardItems(), evidenceCount: 3, createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-29T17:20:00',
    revisions: [
      { action: '创建检验记录', operator: '王璟', reason: '电气巡检发现控制柜接线松动', at: '2026-09-27T15:40:00', crewId: null, crewName: '未派班', slot: null },
      { action: '安排班组时段', operator: '值班主管', reason: '电气班组早班后段处置，需电气作业资质', at: '2026-09-28T09:00:00' },
      { action: '现场处置完成', operator: '沈柏舟', reason: '重新压接端子并紧固，申请复测', at: '2026-09-29T17:20:00' }
    ]
  }),
  // R4 已关闭：摩天轮，历史闭环，关闭时恢复开放
  buildRecord({
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false,
    crewId: 'CREW-MECH2', slot: { start: '2026-09-28T08:00', end: '2026-09-28T10:00' }, requiredQuals: ['液压维修'], dueDate: '2026-09-28',
    items: standardItems(), evidenceCount: 5, createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00',
    revisions: [
      { action: '创建检验记录', operator: '赵帆', reason: '液压站油位偏低列入整改', at: '2026-09-27T07:55:00', crewId: null, crewName: '未派班', slot: null },
      { action: '安排班组时段', operator: '值班主管', reason: '维修二组次日早班补油检漏，需液压维修资质', at: '2026-09-27T09:30:00' },
      { action: '复测通过并恢复开放', operator: '赵帆', reason: '复测全部正常，无未关闭缺陷，设备恢复开放', at: '2026-09-28T16:20:00',
        snapshot: { status: '已关闭', risk: '低', stopped: false, assignedTo: '维修二组', summary: '复测合格，恢复开放', evidenceCount: 5 } }
    ]
  }),
  // R5 高风险未派班：需电气作业，派给维修一组会被资质校验拦截
  buildRecord({
    id: 'INS-240821-05', deviceCode: 'FR-118', deviceName: '激流勇进', area: 'A区南侧', shift: '中班', inspector: '陈屿',
    inspectedAt: '2026-09-30T09:10:00', status: '需整改', risk: '高', stopped: false,
    crewId: null, slot: null, requiredQuals: ['电气作业', '高处作业'], dueDate: '2026-09-30',
    items: standardItems(true), evidenceCount: 1, createdAt: '2026-09-30T09:10:00', updatedAt: '2026-09-30T09:10:00',
    revisions: [
      { action: '创建检验记录', operator: '陈屿', reason: '提升段电机绝缘下降，雨中漏电保护动作', at: '2026-09-30T09:10:00', crewId: null, crewName: '未派班', slot: null }
    ]
  }),
  // R6 中风险未派班：演示跨班重叠——安排 15:00-18:00（16:00 交接班、横跨早/中班）与维修二组早班任务冲突
  buildRecord({
    id: 'INS-240821-06', deviceCode: 'PB-066', deviceName: '碰碰车', area: '室内区', shift: '中班', inspector: '郑澜',
    inspectedAt: '2026-09-30T10:00:00', status: '需整改', risk: '中', stopped: false,
    crewId: null, slot: null, requiredQuals: ['焊接作业'], dueDate: '2026-10-01',
    items: standardItems(true), evidenceCount: 0, createdAt: '2026-09-30T10:00:00', updatedAt: '2026-09-30T10:00:00',
    revisions: [
      { action: '创建检验记录', operator: '郑澜', reason: '护栏焊缝开裂，需焊接补强', at: '2026-09-30T10:00:00', crewId: null, crewName: '未派班', slot: null }
    ]
  }),
  // R7 中风险，维修二组 09-30 早班到 15:30：R6 排 15:00-18:00 跨班时段即与其重叠，用于演示跨班拦截
  buildRecord({
    id: 'INS-240821-07', deviceCode: 'CB-032', deviceName: '海盗船', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-29T14:00:00', status: '整改中', risk: '中', stopped: false,
    crewId: 'CREW-MECH2', slot: { start: '2026-09-30T08:00', end: '2026-09-30T15:30' }, requiredQuals: ['焊接作业'], dueDate: '2026-10-01',
    items: standardItems(true), evidenceCount: 2, createdAt: '2026-09-29T14:00:00', updatedAt: '2026-09-29T17:00:00',
    revisions: [
      { action: '创建检验记录', operator: '赵帆', reason: '船体连接耳板焊缝出现裂纹', at: '2026-09-29T14:00:00', crewId: null, crewName: '未派班', slot: null },
      { action: '安排班组时段', operator: '值班主管', reason: '维修二组 09-30 早班全天处理，需焊接作业资质', at: '2026-09-29T17:00:00' }
    ]
  })
]

export const seedAudit: AuditEntry[] = seedRecords.flatMap((record) =>
  record.revisions.map((revision, index) => ({
    id: `${record.id}-A${index + 1}`,
    recordId: record.id,
    action: revision.action,
    operator: revision.operator,
    detail: revision.reason,
    createdAt: revision.at,
    crewId: revision.crewId,
    slot: revision.slot,
    revision: revision.revision,
    source: revision.source
  }))
)
