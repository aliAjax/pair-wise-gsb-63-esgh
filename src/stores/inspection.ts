import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedRecords } from '../data/seed'
import { crewNameOf, crewSatisfies, slotsOverlap, sameDevice } from '../data/crews'
import { createOfflineInspection } from '../services/api'
import type {
  ActionResult, AuditEntry, FieldConflict, FieldOperation, InspectionDraft, InspectionRecord,
  InspectionStatus, Qualification, RecordRevision, RevisionSource, RevisionSnapshot, ScheduleSlot
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform-v2'
const FIELD_OPS_KEY = 'gsb63:field-ops-v1'
/** 旧版数据键：迁移后保留兜底读取 */
const LEGACY_STORAGE_KEY = 'gsb63:inspection-platform'

const OPEN_STATUSES: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '待重排', '停用']
const ACTIVE_SCHEDULE_STATUSES: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '停用']
const RISK_RANK: Record<string, number> = { 紧急: 3, 高: 2, 中: 1, 低: 0 }

export interface AssignmentInput {
  crewId: string
  slot: ScheduleSlot
  requiredQuals: Qualification[]
  operator?: string
  force?: boolean
}

interface PersistedState {
  records: InspectionRecord[]
  audit: AuditEntry[]
}

interface FieldOpsState {
  ops: FieldOperation[]
  processed: string[]
}

function normalizeSlot(value: unknown): ScheduleSlot | null {
  if (value && typeof value === 'object') {
    const slot = value as ScheduleSlot
    if (slot.start && slot.end) return { start: slot.start, end: slot.end }
  }
  return null
}

/** 兼容 v1 演示数据：补齐班组、时段、资质与修订链 */
function normalizeRecord(raw: InspectionRecord): InspectionRecord {
  const record = { ...raw } as InspectionRecord
  record.crewId = record.crewId ?? null
  record.slot = normalizeSlot(record.slot)
  record.requiredQuals = record.requiredQuals ?? []
  record.displacedFromSlot = normalizeSlot(record.displacedFromSlot)
  record.displacedBy = record.displacedBy ?? null
  record.displacedAt = record.displacedAt ?? null
  record.conflicts = record.conflicts ?? []
  record.assignedTo = record.assignedTo || crewNameOf(record.crewId)
  if (!Array.isArray(record.revisions) || !record.revisions.length) {
    const snapshot: RevisionSnapshot = {
      status: record.status, risk: record.risk, stopped: record.stopped,
      assignedTo: record.assignedTo, summary: '历史记录迁移', evidenceCount: record.evidenceCount
    }
    const revisions: RecordRevision[] = []
    for (let revision = 1; revision <= Math.max(1, record.version); revision += 1) {
      revisions.push({
        revision,
        action: revision === 1 ? '创建检验记录' : '保存检验记录',
        operator: '历史迁移',
        reason: revision === 1 ? `${record.deviceName}完成班前检验` : `记录更新至版本 V${revision}`,
        source: '主台',
        at: revision === 1 ? record.createdAt : record.updatedAt,
        crewId: record.crewId,
        crewName: record.assignedTo,
        slot: record.slot,
        shift: record.shift,
        snapshot
      })
    }
    record.revisions = revisions
    record.version = revisions.length
  }
  return record
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState
      return {
        records: (parsed.records ?? seedRecords).map(normalizeRecord),
        audit: parsed.audit ?? seedAudit
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy) as PersistedState
      return {
        records: (parsed.records ?? seedRecords).map(normalizeRecord),
        audit: parsed.audit ?? seedAudit
      }
    }
  } catch {
    /* 损坏数据回落到种子 */
  }
  return { records: structuredClone(seedRecords), audit: structuredClone(seedAudit) }
}

function readFieldOps(): FieldOpsState {
  try {
    const raw = localStorage.getItem(FIELD_OPS_KEY)
    if (raw) return JSON.parse(raw) as FieldOpsState
  } catch {
    /* ignore */
  }
  return { ops: [], processed: [] }
}

function validSlot(slot: ScheduleSlot | null | undefined): slot is ScheduleSlot {
  return !!slot && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(slot.start) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(slot.end) && slot.start < slot.end
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const fieldState = ref<FieldOpsState>(readFieldOps())
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  const today = new Date().toISOString().slice(0, 10)

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < today && OPEN_STATUSES.includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length,
    pendingReschedule: records.value.filter((item) => item.status === '待重排').length,
    conflicts: records.value.reduce((sum, item) => sum + item.conflicts.filter((entry) => entry.status === '待裁决').length, 0),
    pendingFieldOps: fieldState.value.ops.filter((op) => !op.synced).length
  }))

  function findRecord(id: string) {
    return records.value.find((item) => item.id === id)
  }

  /** 同一设备仍未关闭的缺陷（设备放行联动的判定口径） */
  function openDefectsOfDevice(deviceCode: string, excludeId?: string): InspectionRecord[] {
    return records.value.filter((item) =>
      item.id !== excludeId && OPEN_STATUSES.includes(item.status) && sameDevice(item, { deviceCode }))
  }

  function scheduledConflicts(crewId: string, slot: ScheduleSlot, excludeId?: string) {
    return records.value.filter((item) =>
      item.id !== excludeId
      && item.crewId === crewId
      && !!item.slot
      && ACTIVE_SCHEDULE_STATUSES.includes(item.status)
      && slotsOverlap(item.slot!, slot))
  }

  function addAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'> & { createdAt?: string }) {
    audit.value.unshift({
      ...entry,
      id: `${entry.recordId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: entry.createdAt ?? new Date().toISOString()
    })
  }

  function pushRevision(
    record: InspectionRecord,
    data: {
      action: string
      operator: string
      reason: string
      source?: RevisionSource
      crewId?: string | null
      slot?: ScheduleSlot | null
      fieldClientId?: string
    }
  ) {
    const crewId = data.crewId !== undefined ? data.crewId : record.crewId
    const slot = data.slot !== undefined ? data.slot : record.slot
    const summaryMap: Partial<Record<InspectionStatus, string>> = {
      待重排: '被紧急缺陷顶替，等待重新排班',
      已关闭: '复测通过，缺陷关闭'
    }
    const revision: RecordRevision = {
      revision: record.revisions.length + 1,
      action: data.action,
      operator: data.operator,
      reason: data.reason,
      source: data.source ?? '主台',
      at: new Date().toISOString(),
      crewId,
      crewName: crewNameOf(crewId),
      slot: slot ? { ...slot } : null,
      shift: record.shift,
      fieldClientId: data.fieldClientId,
      snapshot: {
        status: record.status,
        risk: record.risk,
        stopped: record.stopped,
        assignedTo: record.assignedTo,
        summary: summaryMap[record.status] ?? data.reason,
        evidenceCount: record.evidenceCount
      }
    }
    record.revisions.push(revision)
    record.version = record.revisions.length
    record.updatedAt = revision.at
    addAudit({
      recordId: record.id,
      action: data.action,
      operator: data.operator,
      detail: data.reason,
      createdAt: revision.at,
      crewId,
      slot: revision.slot,
      revision: revision.revision,
      source: revision.source
    })
    return revision
  }

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft, '主台')
    records.value.unshift(record)
    addAudit({ recordId: record.id, action: '创建检验记录', operator: draft.inspector, detail: '新建设备班次检验任务', crewId: record.crewId, slot: record.slot, revision: 1, source: '主台', createdAt: record.createdAt })
    return record
  }

  function updateRecord(id: string, patch: Partial<InspectionRecord>, action = '保存检验记录', operator = '当前用户'): ActionResult {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    // 设备仍有未关闭缺陷时不能恢复开放
    if (patch.stopped === false && record.stopped) {
      const others = openDefectsOfDevice(record.deviceCode, id)
      if (others.length) {
        return { ok: false, message: `${record.deviceName} 仍有 ${others.length} 条未关闭缺陷，不能恢复开放`, code: 'blocked' }
      }
    }
    Object.assign(record, patch)
    if (patch.crewId !== undefined) record.assignedTo = crewNameOf(patch.crewId)
    pushRevision(record, { action, operator, reason: `记录更新至版本 V${record.revisions.length + 1}` })
    return { ok: true, message: '检验记录已保存并生成新版本' }
  }

  /**
   * 派工核心：班组 + 时段 + 资质
   * - 资质不满足直接拒绝
   * - 同一班组同一时段只能接一项（跨班重叠按绝对时段比较）
   * - 紧急缺陷可顶替低风险计划；被顶缺陷保留原班次和证据进入待重排
   */
  function planAssignment(id: string, input: AssignmentInput): ActionResult {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    const operator = input.operator ?? '值班主管'
    if (!validSlot(input.slot)) return { ok: false, message: '处置时段不合法：开始时间必须早于结束时间', code: 'invalid-slot' }
    if (!crewSatisfies(input.crewId, input.requiredQuals)) {
      return { ok: false, message: `${crewNameOf(input.crewId)}不满足该缺陷的资质要求：${input.requiredQuals.join('、')}`, code: 'qualification' }
    }
    const blockers = scheduledConflicts(input.crewId, input.slot, id)
    if (blockers.length) {
      const riskHigher = blockers.every((blocker) => RISK_RANK[record.risk] > RISK_RANK[blocker.risk])
      if (!input.force) {
        const detail = blockers.map((blocker) => `${blocker.deviceName}（${blocker.risk}风险 ${blocker.slot!.start.slice(11)}-${blocker.slot!.end.slice(11)}）`).join('、')
        return {
          ok: false,
          code: riskHigher ? 'preempt-available' : 'conflict',
          message: riskHigher
            ? `${crewNameOf(input.crewId)}该时段已占用：${detail}。本缺陷风险更高，可顶替低风险计划。`
            : `${crewNameOf(input.crewId)}该时段已占用：${detail}。风险等级不足以顶替。`,
          blockers: blockers.map((blocker) => ({ recordId: blocker.id, deviceName: blocker.deviceName, risk: blocker.risk, slot: blocker.slot! }))
        }
      }
      if (!riskHigher) {
        return { ok: false, code: 'blocked', message: '占用时段内存在同级或更高风险缺陷，不能顶替' }
      }
      // 执行顶替：被顶缺陷保留原班次(shift)与证据，仅摘下班组时段并进入待重排
      blockers.forEach((blocker) => {
        blocker.displacedFromSlot = blocker.slot ? { ...blocker.slot } : null
        blocker.displacedBy = record.id
        blocker.displacedAt = new Date().toISOString()
        blocker.crewId = null
        blocker.slot = null
        blocker.assignedTo = '待重排'
        blocker.status = '待重排'
        pushRevision(blocker, {
          action: '被紧急缺陷顶替',
          operator,
          reason: `${record.deviceName}（${record.risk}风险）占用同班组时段，原班次 ${blocker.shift} 与 ${blocker.evidenceCount} 份证据保留，进入待重排`,
          crewId: null,
          slot: null
        })
      })
    }

    const resuming = record.status === '待重排'
    record.crewId = input.crewId
    record.slot = { ...input.slot }
    record.requiredQuals = [...input.requiredQuals]
    record.assignedTo = crewNameOf(input.crewId)
    if (resuming) record.status = '需整改'
    record.displacedFromSlot = resuming ? record.displacedFromSlot : null
    pushRevision(record, {
      action: resuming ? '待重排缺陷重新排班' : blockers.length ? '顶替后排班' : '安排班组时段',
      operator,
      reason: resuming
        ? `重新安排至${crewNameOf(input.crewId)} ${input.slot.start.replace('T', ' ')} 起`
        : `安排${crewNameOf(input.crewId)}于 ${input.slot.start.replace('T', ' ')}–${input.slot.end.slice(11)} 处置，资质要求：${input.requiredQuals.length ? input.requiredQuals.join('、') : '无'}`,
      crewId: input.crewId,
      slot: input.slot
    })
    return { ok: true, message: resuming ? '已重新排班，缺陷回到整改流程' : `已派发给${crewNameOf(input.crewId)}` }
  }

  function unresolvedConflicts(id: string): FieldConflict[] {
    return (findRecord(id)?.conflicts ?? []).filter((entry) => entry.status === '待裁决')
  }

  function transition(id: string, next: InspectionStatus, detail: string, operator = '当前用户'): ActionResult {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (next === '已关闭') {
      if (record.items.some((item) => item.result === '异常')) {
        return { ok: false, message: '仍有异常项，不能关闭缺陷', code: 'blocked' }
      }
      const pendingConflicts = unresolvedConflicts(id)
      if (pendingConflicts.length) {
        return { ok: false, message: `存在 ${pendingConflicts.length} 个两侧同时修改的待裁决版本，保留两版期间不能关闭`, code: 'blocked' }
      }
      const others = openDefectsOfDevice(record.deviceCode, id)
      if (others.length) {
        return { ok: false, message: `同设备 ${record.deviceName} 仍有 ${others.length} 条未关闭缺陷，不能恢复开放`, code: 'blocked' }
      }
    }
    if (next === '待复测' && !record.stopped && record.risk === '紧急') {
      return { ok: false, message: '紧急风险缺陷必须先执行停用', code: 'blocked' }
    }
    record.status = next
    // 关闭即联动恢复设备（已确认同设备无其他未关闭缺陷）
    if (next === '已关闭') record.stopped = false
    pushRevision(record, { action: `状态流转：${next}`, operator, reason: detail })
    return { ok: true, message: `已流转至${next}` }
  }

  /** 复测通过：关闭缺陷，且同设备无其他未关闭缺陷时恢复设备 */
  function retestPass(id: string, operator = '当前用户'): ActionResult {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (record.items.some((item) => item.result === '异常')) {
      return { ok: false, message: '仍有异常项，复测不能通过', code: 'blocked' }
    }
    const pendingConflicts = unresolvedConflicts(id)
    if (pendingConflicts.length) {
      return { ok: false, message: '两侧修改版本尚未裁决，保留两版期间不能关闭', code: 'blocked' }
    }
    const others = openDefectsOfDevice(record.deviceCode, id)
    if (others.length) {
      record.status = '已关闭'
      pushRevision(record, { action: '复测通过关闭缺陷', operator, reason: `复测合格关闭缺陷；同设备仍有 ${others.length} 条未关闭缺陷，设备继续停用隔离` })
      return { ok: true, message: `缺陷已关闭，但 ${record.deviceName} 仍有其他未关闭缺陷，设备暂不恢复开放` }
    }
    record.status = '已关闭'
    record.stopped = false
    pushRevision(record, { action: '复测通过并恢复开放', operator, reason: '复测全部正常，同设备无未关闭缺陷，缺陷关闭并恢复设备开放' })
    return { ok: true, message: '复测通过，缺陷已关闭，设备恢复开放' }
  }

  /* ---------------- 班组断网现场作业：暂存 -> 回台同步合并 ---------------- */

  function enqueueFieldOp(op: FieldOperation) {
    fieldState.value.ops.push(op)
  }

  /** 班组断网完成处置：现场记录暂存在终端，回台后才合并 */
  function enqueueOfflineComplete(id: string, clientName: string, note: string): ActionResult {
    const record = findRecord(id)
    if (!record) return { ok: false, message: '记录不存在' }
    const patch: Partial<InspectionRecord> = {
      status: '待复测',
      evidenceCount: record.evidenceCount + 1,
      items: record.items.map((item) => item.result === '异常'
        ? { ...item, result: '正常', reading: '现场复测正常', note: `${item.note ? `${item.note}；` : ''}已现场修复（离线暂存 ${new Date().toISOString().slice(5, 16)}）` }
        : item)
    }
    enqueueFieldOp({
      opId: `${id}-complete-${record.version}`,
      clientName,
      type: 'complete',
      createdAt: new Date().toISOString(),
      synced: false,
      syncedAt: null,
      recordId: id,
      baseRevision: record.version,
      patch,
      note
    })
    return { ok: true, message: `处置记录已暂存在「${clientName}」离线队列，回台同步后合并` }
  }

  /** 班组断网期间在现场新建缺陷 */
  function enqueueOfflineCreate(draft: InspectionDraft, clientName: string): FieldOperation {
    const op: FieldOperation = {
      opId: `create-${draft.deviceCode}-${Date.now()}`,
      clientName,
      type: 'create',
      createdAt: new Date().toISOString(),
      synced: false,
      syncedAt: null,
      draft,
      note: `${draft.deviceName} 现场离线新建`
    }
    enqueueFieldOp(op)
    return op
  }

  /** 模拟网络重发：同一 opId 再次进入队列（可能发生在应答丢失后），验证重复记录只入一次 */
  function duplicatePendingOp(opId: string) {
    const original = fieldState.value.ops.filter((op) => op.opId === opId).pop()
    if (original) {
      fieldState.value.ops.push({ ...original, synced: false, syncedAt: null, outcome: undefined })
    }
  }

  interface SyncSummary { imported: number; duplicated: number; conflicts: number; fastForwarded: number; messages: string[] }

  /** 回台同步合并：幂等去重 + 同缺陷两侧同时修改保留两版 */
  function syncFieldOps(): SyncSummary {
    const summary: SyncSummary = { imported: 0, duplicated: 0, conflicts: 0, fastForwarded: 0, messages: [] }
    const seenInBatch = new Set<string>()
    fieldState.value.ops.filter((op) => !op.synced).forEach((op) => {
      op.syncedAt = new Date().toISOString()
      // 重复记录只入一次：历史已处理 或 本批次已出现
      if (fieldState.value.processed.includes(op.opId) || seenInBatch.has(op.opId)) {
        op.synced = true
        op.outcome = '重复记录，已去重（只入一次）'
        summary.duplicated += 1
        return
      }
      seenInBatch.add(op.opId)
      fieldState.value.processed.push(op.opId)
      op.synced = true

      if (op.type === 'create' && op.draft) {
        const record = createOfflineInspection(op.draft, '班组离线回传')
        records.value.unshift(record)
        addAudit({
          recordId: record.id, action: '离线记录回台合并', operator: op.clientName,
          detail: `班组断网期间现场新建，回台同步并入（操作号 ${op.opId.slice(-6)}）`,
          crewId: record.crewId, slot: record.slot, revision: 1, source: '班组离线回传', createdAt: op.syncedAt
        })
        summary.imported += 1
        summary.messages.push(`新建缺陷 ${record.id} 已合并`)
        op.recordId = record.id
        op.outcome = '已合并入台账'
        return
      }

      const record = op.recordId ? findRecord(op.recordId) : undefined
      if (!record || !op.patch) {
        op.outcome = '目标记录不存在'
        return
      }
      // 同一缺陷两侧同时修改：现场基线版本落后于主台版本 -> 保留两版并阻止关闭
      if ((op.baseRevision ?? record.version) < record.version) {
        const conflict: FieldConflict = {
          id: `${record.id}-C${record.conflicts.length + 1}`,
          clientName: op.clientName,
          fieldRevision: op.baseRevision ?? record.version,
          baseRevision: op.baseRevision ?? record.version,
          currentRevision: record.version,
          fieldPatch: op.patch,
          fieldNote: op.note ?? '现场离线处置记录',
          createdAt: op.syncedAt,
          status: '待裁决'
        }
        record.conflicts.push(conflict)
        pushRevision(record, {
          action: '两侧同时修改·保留两版',
          operator: op.clientName,
          reason: `现场基于 V${conflict.baseRevision} 完成处置，主台已更新到 V${conflict.currentRevision}；两版并存，裁决前阻止关闭`,
          source: '班组离线回传',
          fieldClientId: op.clientName
        })
        summary.conflicts += 1
        summary.messages.push(`${record.deviceName} 出现版本冲突，两版已保留`)
        op.outcome = '两侧同时修改，已保留两版待裁决'
        return
      }

      Object.assign(record, op.patch)
      pushRevision(record, {
        action: '离线处置回台合并',
        operator: op.clientName,
        reason: `${op.note ?? '现场处置完成'}（离线操作号 ${op.opId.slice(-6)}，基线 V${op.baseRevision} 一致，直接并入）`,
        source: '班组离线回传',
        fieldClientId: op.clientName
      })
      summary.fastForwarded += 1
      summary.messages.push(`${record.deviceName} 处置记录已并入 V${record.version}`)
      op.outcome = `已并入 V${record.version}`
    })
    return summary
  }

  /** 裁决并轨版本：保留现场版则应用其补丁，保留主台版则仅归档 */
  function resolveConflict(id: string, conflictId: string, keep: 'field' | 'master', operator = '值班主管'): ActionResult {
    const record = findRecord(id)
    const conflict = record?.conflicts.find((item) => item.id === conflictId)
    if (!record || !conflict) return { ok: false, message: '冲突记录不存在' }
    conflict.status = keep === 'field' ? '保留现场版' : '保留主台版'
    conflict.resolvedAt = new Date().toISOString()
    if (keep === 'field') {
      Object.assign(record, conflict.fieldPatch)
      pushRevision(record, {
        action: '裁决采用现场版',
        operator,
        reason: `采用 ${conflict.clientName} 离线处置版本：${conflict.fieldNote}`,
        source: '班组离线回传',
        fieldClientId: conflict.clientName
      })
    } else {
      pushRevision(record, {
        action: '裁决保留主台版',
        operator,
        reason: `主台 V${conflict.currentRevision} 为准，现场 V${conflict.fieldRevision} 仅归档留痕：${conflict.fieldNote}`
      })
    }
    return { ok: true, message: keep === 'field' ? '已采用现场版本并并轨' : '已保留主台版本，现场版归档' }
  }

  function clearSyncedFieldOps() {
    fieldState.value.ops = fieldState.value.ops.filter((op) => !op.synced)
  }

  function resetDemo() {
    records.value = structuredClone(seedRecords)
    audit.value = structuredClone(seedAudit)
    fieldState.value = { ops: [], processed: [] }
    localStorage.removeItem(FIELD_OPS_KEY)
  }

  watch([records, audit], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: records.value, audit: audit.value }))
  }, { deep: true })

  watch(fieldState, (value) => {
    localStorage.setItem(FIELD_OPS_KEY, JSON.stringify(value))
  }, { deep: true })

  return {
    records, audit, fieldState, keyword, status, area, liveMessage,
    filtered, stats, today,
    findRecord, openDefectsOfDevice, scheduledConflicts, unresolvedConflicts,
    addRecord, updateRecord, planAssignment, transition, retestPass,
    enqueueOfflineComplete, enqueueOfflineCreate, duplicatePendingOp, syncFieldOps, resolveConflict, clearSyncedFieldOps,
    resetDemo
  }
})
