export type InspectionStatus = '待检验' | '需整改' | '整改中' | '待复测' | '待重排' | '已关闭' | '停用'
export type RiskLevel = '低' | '中' | '高' | '紧急'
export type CheckResult = '正常' | '异常' | '不适用'
export type Qualification = '高处作业' | '电气作业' | '焊接作业' | '液压维修' | '起重作业'
export type ShiftPreset = '早班' | '中班' | '晚班'
export type RevisionSource = '主台' | '班组离线回传'

export interface InspectionItem {
  id: string
  name: string
  result: CheckResult
  reading: string
  limit: string
  note: string
}

/** 处置时段：统一使用本地无时区 ISO 风格字符串，便于跨班时段重叠比较 */
export interface ScheduleSlot {
  start: string
  end: string
}

export interface RevisionSnapshot {
  status: InspectionStatus
  risk: RiskLevel
  stopped: boolean
  assignedTo: string
  summary: string
  evidenceCount: number
}

/** 每次保存、排程、顶替、回传、裁决、关闭都留一版修订，可沿班组/时段追溯原因 */
export interface RecordRevision {
  revision: number
  action: string
  operator: string
  reason: string
  source: RevisionSource
  at: string
  crewId: string | null
  crewName: string | null
  slot: ScheduleSlot | null
  shift: string
  snapshot: RevisionSnapshot
  fieldClientId?: string
}

/** 两侧同时修改时并轨保留的现场版本 */
export interface FieldConflict {
  id: string
  clientName: string
  fieldRevision: number
  baseRevision: number
  currentRevision: number
  fieldPatch: Partial<InspectionRecord>
  fieldNote: string
  createdAt: string
  status: '待裁决' | '保留现场版' | '保留主台版'
  resolvedAt?: string
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
  stopped: boolean
  /** 兼容展示：当前承担班组名称 */
  assignedTo: string
  dueDate: string
  items: InspectionItem[]
  evidenceCount: number
  version: number
  createdAt: string
  updatedAt: string
  /** 派工：班组 + 时段 + 资质要求 */
  crewId: string | null
  slot: ScheduleSlot | null
  requiredQuals: Qualification[]
  /** 被紧急缺陷顶替时留痕：原班次仍在 shift，原时段快照在此 */
  displacedFromSlot: ScheduleSlot | null
  displacedBy: string | null
  displacedAt: string | null
  revisions: RecordRevision[]
  conflicts: FieldConflict[]
}

export interface AuditEntry {
  id: string
  recordId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  crewId?: string | null
  slot?: ScheduleSlot | null
  revision?: number
  source?: RevisionSource
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
  crewId?: string | null
  slot?: ScheduleSlot | null
  requiredQuals?: Qualification[]
}

/** 班组断网期间在现场终端产生、回台后合并的操作 */
export interface FieldOperation {
  opId: string
  clientName: string
  type: 'complete' | 'create'
  createdAt: string
  synced: boolean
  syncedAt?: string | null
  outcome?: string
  recordId?: string
  baseRevision?: number
  patch?: Partial<InspectionRecord>
  note?: string
  draft?: InspectionDraft
}

export interface ActionResult {
  ok: boolean
  message: string
  code?: 'invalid-slot' | 'qualification' | 'conflict' | 'preempt-available' | 'blocked'
  blockers?: Array<{ recordId: string; deviceName: string; risk: RiskLevel; slot: ScheduleSlot }>
}
