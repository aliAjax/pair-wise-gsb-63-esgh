import type { AuditEntry, Crew, DefectRevision, InspectionItem, InspectionRecord } from '../types'

const items = (abnormal = false): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: abnormal ? '异常' : '正常', reading: abnormal ? '6.8 mm' : '2.1 mm', limit: '≤ 5.0 mm', note: abnormal ? '主支撑连接处磨损超限' : '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '68 dB', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '制动距离 2.3 m', limit: '≤ 3.0 m', note: '' },
  { id: 'lock', name: '锁止机构', result: abnormal ? '异常' : '正常', reading: abnormal ? '存在间隙' : '闭合可靠', limit: '无可见间隙', note: abnormal ? '安全压杠锁止存在回弹' : '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '联锁有效', limit: '动作可靠', note: '' }
]

export const crews: Crew[] = [
  { id: 'C1', name: '维修一组', quals: ['高空', '焊接', '制动'] },
  { id: 'C2', name: '维修二组', quals: ['液压', '制动'] },
  { id: 'C3', name: '电气班组', quals: ['电气', '制动'] },
  { id: 'C4', name: '检验二组', quals: ['高空', '电气'] }
]

function revision(seed: Partial<DefectRevision> & { version: number; reason: string }): DefectRevision {
  return {
    id: `rev-${seed.version}`,
    operator: '系统流转',
    crewId: null,
    crewName: '',
    shift: '',
    slotStart: null,
    slotEnd: null,
    requiredQuals: [],
    disposition: '',
    evidenceCount: 0,
    createdAt: '',
    ...seed
  }
}

export const seedRecords: InspectionRecord[] = [
  {
    id: 'INS-240821-01', deviceCode: 'AM-014', deviceName: '高空飞翔', area: 'A区北侧', shift: '早班', inspector: '周宁',
    inspectedAt: '2026-09-28T08:20:00', status: '整改中', risk: '紧急', stopped: true,
    assignedTo: '维修一组', crewId: 'C1', slotStart: '2026-09-30T08:30', slotEnd: '2026-09-30T10:30',
    requiredQuals: ['高空', '焊接'], dueDate: '2026-09-29',
    items: items(true), evidenceCount: 4, version: 3, disposition: '主支撑焊接加固，等待更换磨损衬套',
    revisions: [
      revision({ version: 1, reason: '班前检验发现磨损超限，停用隔离', operator: '周宁', crewId: null, crewName: '', shift: '早班', disposition: '已挂停用牌', evidenceCount: 4, createdAt: '2026-09-28T08:20:00' }),
      revision({ version: 2, reason: '派单：维修一组，需高空+焊接资质', operator: '值班主管', crewId: 'C1', crewName: '维修一组', shift: '早班', slotStart: '2026-09-30T08:30', slotEnd: '2026-09-30T10:30', requiredQuals: ['高空', '焊接'], disposition: '按计划开工', evidenceCount: 4, createdAt: '2026-09-28T09:35:00' }),
      revision({ version: 3, reason: '现场补焊完成，等待衬套备件', operator: '维修一组', crewId: 'C1', crewName: '维修一组', shift: '早班', slotStart: '2026-09-30T08:30', slotEnd: '2026-09-30T10:30', requiredQuals: ['高空', '焊接'], disposition: '主支撑焊接加固，等待更换磨损衬套', evidenceCount: 4, createdAt: '2026-09-28T11:10:00' })
    ],
    preemption: null, conflict: null, conflictResolvedWith: null,
    createdAt: '2026-09-28T08:20:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-02', deviceCode: 'RC-007', deviceName: '家庭过山车', area: 'B区', shift: '早班', inspector: '李琪',
    inspectedAt: '2026-09-28T09:05:00', status: '需整改', risk: '低', stopped: false,
    assignedTo: '维修一组', crewId: 'C1', slotStart: '2026-09-30T09:30', slotEnd: '2026-09-30T11:00',
    requiredQuals: ['制动'], dueDate: '2026-09-30',
    items: items(true), evidenceCount: 2, version: 2, disposition: '制动距离接近上限，计划例行调校',
    revisions: [
      revision({ version: 1, reason: '制动测试读数临界，列入低风险计划', operator: '李琪', crewName: '', shift: '早班', disposition: '低风险计划工单', evidenceCount: 2, createdAt: '2026-09-28T09:05:00' }),
      revision({ version: 2, reason: '派单：维修一组，与高空飞翔时段重叠，存在冲突', operator: '值班主管', crewId: 'C1', crewName: '维修一组', shift: '早班', slotStart: '2026-09-30T09:30', slotEnd: '2026-09-30T11:00', requiredQuals: ['制动'], disposition: '制动距离接近上限，计划例行调校', evidenceCount: 2, createdAt: '2026-09-28T11:10:00' })
    ],
    preemption: null, conflict: null, conflictResolvedWith: null,
    createdAt: '2026-09-28T09:05:00', updatedAt: '2026-09-28T11:10:00'
  },
  {
    id: 'INS-240821-03', deviceCode: 'CR-021', deviceName: '旋转木马', area: '亲子区', shift: '中班', inspector: '王璟',
    inspectedAt: '2026-09-27T15:40:00', status: '待复测', risk: '中', stopped: false,
    assignedTo: '电气班组', crewId: 'C3', slotStart: '2026-09-30T14:00', slotEnd: '2026-09-30T15:30',
    requiredQuals: ['电气'], dueDate: '2026-09-29',
    items: items(), evidenceCount: 3, version: 4, disposition: '联锁回路更换完成，待复测',
    revisions: [
      revision({ version: 1, reason: '联锁偶发失效，开具缺陷', operator: '王璟', crewName: '', shift: '中班', disposition: '停用联锁回路', evidenceCount: 3, createdAt: '2026-09-27T15:40:00' }),
      revision({ version: 4, reason: '电气班组完成联锁回路更换，预约复测', operator: '电气班组', crewId: 'C3', crewName: '电气班组', shift: '中班', slotStart: '2026-09-30T14:00', slotEnd: '2026-09-30T15:30', requiredQuals: ['电气'], disposition: '联锁回路更换完成，待复测', evidenceCount: 3, createdAt: '2026-09-28T10:25:00' })
    ],
    preemption: null, conflict: null, conflictResolvedWith: null,
    createdAt: '2026-09-27T15:40:00', updatedAt: '2026-09-28T10:25:00'
  },
  {
    id: 'INS-240821-04', deviceCode: 'WF-003', deviceName: '摩天轮', area: '湖景区', shift: '早班', inspector: '赵帆',
    inspectedAt: '2026-09-27T07:55:00', status: '已关闭', risk: '低', stopped: false,
    assignedTo: '维修二组', crewId: 'C2', slotStart: '2026-09-28T09:00', slotEnd: '2026-09-28T11:00',
    requiredQuals: ['液压'], dueDate: '2026-09-28',
    items: items(), evidenceCount: 5, version: 5, disposition: '液压站压力复测合格，设备恢复开放',
    revisions: [
      revision({ version: 1, reason: '液压站压力波动，开具缺陷并停用', operator: '赵帆', crewName: '', shift: '早班', disposition: '停用液压站', evidenceCount: 5, createdAt: '2026-09-27T07:55:00' }),
      revision({ version: 5, reason: '复测通过：压力稳定，关闭缺陷并恢复开放', operator: '维修二组', crewId: 'C2', crewName: '维修二组', shift: '早班', slotStart: '2026-09-28T09:00', slotEnd: '2026-09-28T11:00', requiredQuals: ['液压'], disposition: '液压站压力复测合格，设备恢复开放', evidenceCount: 5, createdAt: '2026-09-28T16:20:00' })
    ],
    preemption: null, conflict: null, conflictResolvedWith: null,
    createdAt: '2026-09-27T07:55:00', updatedAt: '2026-09-28T16:20:00'
  }
]

export const seedAudit: AuditEntry[] = seedRecords.flatMap((record) => [
  { id: `${record.id}-A1`, recordId: record.id, action: '创建检验记录', operator: record.inspector, detail: `${record.deviceName}完成班前检验`, createdAt: record.createdAt },
  ...(record.version > 1 ? [{ id: `${record.id}-A${record.version}`, recordId: record.id, action: record.status, operator: '系统流转', detail: `记录更新至版本 V${record.version}`, createdAt: record.updatedAt }] : [])
])
