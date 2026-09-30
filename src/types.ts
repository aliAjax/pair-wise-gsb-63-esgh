export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '已关闭' | '停用' | '待重排'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'
export type Qualification = '高空' | '电气' | '液压' | '焊接' | '制动'

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  limit: string
  note: string
}

/** 处置修订：沿班组、时段和修订号可追溯每一次原因 */
export interface DefectRevision {
  id: string
  version: number
  reason: string
  operator: string
  crewId: string | null
  crewName: string
  shift: string
  slotStart: string | null
  slotEnd: string | null
  requiredQuals: Qualification[]
  disposition: string
  evidenceCount: number
  createdAt: string
}

/** 两侧同时修改时并存的两个版本，冲突未消解前阻止关闭 */
export interface ConflictBranch {
  side: '台内值班端' | '班组离线端'
  version: number
  operator: string
  reason: string
  disposition: string
  evidenceCount: number
  items: InspectionItem[]
  updatedAt: string
}

/** 班组断网期间在本地登记的处置操作，回台后按 opId 幂等合并 */
export interface OfflineOperation {
  opId: string
  recordId: string
  crewName: string
  type: 'complete' | 'create'
  disposition: string
  evidenceCount: number
  items: InspectionItem[] | null
  deviceCode?: string
  deviceName?: string
  area?: string
  risk?: RiskLevel
  baseVersion: number
  queuedAt: string
}

/** 被紧急缺陷顶替的原排班快照（保留原班次与证据） */
export interface PreemptionSnapshot {
  crewId: string
  crewName: string
  shift: string
  slotStart: string
  slotEnd: string
  requiredQuals: Qualification[]
  reason: string
  evidenceCount: number
  preemptedBy: string
  preemptedAt: string
}

export interface InspectionRecord {
  id: string
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  inspectedAt: string
  status: InspectionStatus
  risk: RiskLevel
  /** 设备是否停用隔离；仍有未关闭缺陷时禁止恢复开放 */
  stopped: boolean
  assignedTo: string
  crewId: string | null
  /** 跨班时段（精确到分钟），用于重叠检测 */
  slotStart: string | null
  slotEnd: string | null
  requiredQuals: Qualification[]
  dueDate: string
  items: InspectionItem[]
  evidenceCount: number
  version: number
  /** 现场处置说明（每次保存/离线完成都会进修订时间线） */
  disposition: string
  revisions: DefectRevision[]
  /** 被紧急缺陷顶替后保留的原班次/证据 */
  preemption: PreemptionSnapshot | null
  /** 两侧同时修改产生的双版本；存在时阻止关闭 */
  conflict: { branches: ConflictBranch[]; createdAt: string } | null
  conflictResolvedWith: '台内值班端' | '班组离线端' | null
  createdAt: string
  updatedAt: string
}

export interface Crew {
  id: string
  name: string
  quals: Qualification[]
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

export interface InspectionDraft {
  deviceCode: string
  deviceName: string
  area: string
  shift: string
  inspector: string
  risk: RiskLevel
  assignedTo: string
  dueDate: string
}

/** 未关闭的缺陷状态（这些状态下设备不得恢复开放） */
export const OPEN_DEFECT_STATUSES: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '停用', '待重排']

export const RISK_RANK: Record<RiskLevel, number> = { 紧急: 0, 高: 1, 中: 2, 低: 3 }
