import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { crews, seedAudit, seedRecords } from '../data/seed'
import {
  clearSyncMemory,
  createOfflineInspection,
  deepClone,
  readMergedOpIds,
  readQueue,
  rememberMergedOpIds,
  saveQueue,
  uid
} from '../services/api'
import { OPEN_DEFECT_STATUSES, RISK_RANK } from '../types'
import type {
  AuditEntry,
  ConflictBranch,
  Crew,
  InspectionDraft,
  InspectionRecord,
  InspectionStatus,
  OfflineOperation,
  Qualification
} from '../types'

const STORAGE_KEY = 'gsb63:inspection-platform'

interface PersistedState {
  records: InspectionRecord[]
  audit: AuditEntry[]
}

interface ActionResult {
  ok: boolean
  message: string
}

interface SchedulePatch {
  crewId: string | null
  slotStart: string | null
  slotEnd: string | null
  requiredQuals: Qualification[]
  reason: string
}

interface ConflictInfo {
  record: InspectionRecord
  other: InspectionRecord
}

function normalize(record: InspectionRecord): InspectionRecord {
  const base: InspectionRecord = {
    ...record,
    crewId: record.crewId ?? null,
    slotStart: record.slotStart ?? null,
    slotEnd: record.slotEnd ?? null,
    requiredQuals: record.requiredQuals ?? [],
    disposition: record.disposition ?? '',
    revisions: record.revisions ?? [{
      id: uid('rev'),
      version: record.version,
      reason: '历史版本补录',
      operator: record.inspector,
      crewId: null,
      crewName: record.assignedTo,
      shift: record.shift,
      slotStart: null,
      slotEnd: null,
      requiredQuals: [],
      disposition: record.disposition ?? '',
      evidenceCount: record.evidenceCount,
      createdAt: record.updatedAt
    }],
    preemption: record.preemption ?? null,
    conflict: record.conflict ?? null,
    conflictResolvedWith: record.conflictResolvedWith ?? null
  }
  return base
}

function readPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState
      return { records: (parsed.records ?? []).map(normalize), audit: parsed.audit ?? [] }
    }
  } catch {
    /* 落回演示数据 */
  }
  return { records: deepClone(seedRecords), audit: deepClone(seedAudit) }
}

export const useInspectionStore = defineStore('inspection', () => {
  const initial = readPersisted()
  const records = ref<InspectionRecord[]>(initial.records)
  const audit = ref<AuditEntry[]>(initial.audit)
  const crewList = ref<Crew[]>(deepClone(crews))
  const keyword = ref('')
  const status = ref<InspectionStatus | '全部'>('全部')
  const area = ref('全部')
  const liveMessage = ref('本地实时通道已就绪')
  const offlineQueue = ref<OfflineOperation[]>(readQueue())

  const crewName = (id: string | null) => crewList.value.find((crew) => crew.id === id)?.name ?? '未安排'
  const crewById = (id: string | null) => crewList.value.find((crew) => crew.id === id) ?? null

  const filtered = computed(() => records.value.filter((record) => {
    const haystack = `${record.id} ${record.deviceCode} ${record.deviceName} ${record.inspector} ${record.assignedTo}`.toLowerCase()
    return (!keyword.value || haystack.includes(keyword.value.toLowerCase()))
      && (status.value === '全部' || record.status === status.value)
      && (area.value === '全部' || record.area === area.value)
  }))

  /** 占用同一班组排班时段（待重排/已关闭的工单已让出时段，不占资源） */
  function occupiesSlot(record: InspectionRecord) {
    return record.crewId && record.slotStart && record.slotEnd
      && record.status !== '待重排' && record.status !== '已关闭'
  }

  function findOverlap(record: InspectionRecord, crewId: string | null, start: string | null, end: string | null): InspectionRecord | undefined {
    if (!crewId || !start || !end) return undefined
    return records.value.find((other) => other.id !== record.id
      && occupiesSlot(other) && other.crewId === crewId
      && start < (other.slotEnd as string) && (other.slotStart as string) < end)
  }

  /** 值班主管视角：当前全部同班组同时段冲突 */
  const scheduleConflicts = computed<ConflictInfo[]>(() => {
    const result: ConflictInfo[] = []
    const active = records.value.filter(occupiesSlot)
    active.forEach((record) => {
      const other = active.find((candidate) => candidate.id > record.id
        && candidate.crewId === record.crewId
        && (record.slotStart as string) < (candidate.slotEnd as string)
        && (candidate.slotStart as string) < (record.slotEnd as string))
      if (other) result.push({ record, other })
    })
    return result
  })

  /** 班组占用日历：每个班组当前承担的排班 */
  const crewOccupancy = computed(() => crewList.value.map((crew) => ({
    crew,
    jobs: records.value
      .filter((record) => record.crewId === crew.id && occupiesSlot(record))
      .sort((a, b) => (a.slotStart ?? '').localeCompare(b.slotStart ?? ''))
  })))

  const stats = computed(() => ({
    total: records.value.length,
    blocked: records.value.filter((item) => item.stopped).length,
    overdue: records.value.filter((item) => item.dueDate < '2026-09-30' && !['已关闭'].includes(item.status)).length,
    closed: records.value.filter((item) => item.status === '已关闭').length,
    waitingReschedule: records.value.filter((item) => item.status === '待重排').length,
    conflicts: scheduleConflicts.value.length,
    pendingSync: offlineQueue.value.length
  }))

  function addRecord(draft: InspectionDraft) {
    const record = createOfflineInspection(draft)
    records.value.unshift(record)
    addAudit(record.id, '创建检验记录', draft.inspector, '新建设备班次检验任务')
    return record
  }

  function addRevision(record: InspectionRecord, reason: string, operator: string) {
    record.revisions.push({
      id: uid('rev'),
      version: record.version,
      reason,
      operator,
      crewId: record.crewId,
      crewName: crewName(record.crewId),
      shift: record.shift,
      slotStart: record.slotStart,
      slotEnd: record.slotEnd,
      requiredQuals: [...record.requiredQuals],
      disposition: record.disposition,
      evidenceCount: record.evidenceCount,
      createdAt: record.updatedAt
    })
  }

  function bump(record: InspectionRecord) {
    record.version += 1
    record.updatedAt = new Date().toISOString()
  }

  /** 安排/调整班组、时段与资质要求；同一班组同一时段只能接一项 */
  function assignCrew(id: string, patch: SchedulePatch, operator = '值班主管'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (patch.crewId && (!patch.slotStart || !patch.slotEnd)) {
      return { ok: false, message: '请补全处置开始与结束时间' }
    }
    if (patch.slotStart && patch.slotEnd && patch.slotStart >= patch.slotEnd) {
      return { ok: false, message: '结束时间必须晚于开始时间' }
    }
    const crew = crewById(patch.crewId)
    if (patch.crewId && !crew) return { ok: false, message: '班组不存在' }
    const missing = patch.requiredQuals.filter((qual) => crew && !crew.quals.includes(qual))
    if (missing.length) {
      return { ok: false, message: `${crew!.name}不具备资质：${missing.join('、')}，不能派单` }
    }
    const clash = findOverlap(record, patch.crewId, patch.slotStart, patch.slotEnd)
    if (clash) {
      return {
        ok: false,
        message: `${crew!.name}在该时段已承担 ${clash.deviceName}（${fmt(clash.slotStart)}-${fmt(clash.slotEnd)}），同一时段只能接一项`
      }
    }

    record.crewId = patch.crewId
    record.assignedTo = crew?.name ?? '未安排'
    record.slotStart = patch.slotStart
    record.slotEnd = patch.slotEnd
    record.requiredQuals = [...patch.requiredQuals]
    if (record.status === '待重排') record.status = '需整改'
    bump(record)
    addRevision(record, patch.reason || `排班：${crew?.name ?? '未安排'} ${patch.slotStart ? fmt(patch.slotStart) : ''}`, operator)
    addAudit(id, '排班派单', operator, `${record.deviceName} → ${crew?.name ?? '未安排'}，时段 ${patch.slotStart ? `${fmt(patch.slotStart)}-${fmt(patch.slotEnd)}` : '待定'}，资质 ${patch.requiredQuals.join('、') || '无'}（V${record.version}）`)
    return { ok: true, message: `已安排给${crew?.name ?? '未安排'}` }
  }

  /** 紧急缺陷顶替低风险计划：被顶缺陷保留原班次与证据，进入待重排 */
  function preempt(urgentId: string, targetId: string, operator = '值班主管'): ActionResult {
    const urgent = records.value.find((item) => item.id === urgentId)
    const target = records.value.find((item) => item.id === targetId)
    if (!urgent || !target) return { ok: false, message: '记录不存在' }
    if (RISK_RANK[urgent.risk] >= RISK_RANK[target.risk]) {
      return { ok: false, message: '只有更高风险（紧急）缺陷才能顶替低风险计划' }
    }
    if (!target.crewId || !target.slotStart || !target.slotEnd) {
      return { ok: false, message: '被顶替缺陷尚未排班' }
    }

    // 原班次、时段、资质、证据全部快照保留
    const snapshot = {
      crewId: target.crewId as string,
      crewName: target.assignedTo,
      shift: target.shift,
      slotStart: target.slotStart as string,
      slotEnd: target.slotEnd as string,
      requiredQuals: [...target.requiredQuals],
      reason: `被紧急缺陷 ${urgent.id}（${urgent.deviceName}）顶替`,
      evidenceCount: target.evidenceCount,
      preemptedBy: urgent.id,
      preemptedAt: new Date().toISOString()
    }
    target.preemption = snapshot
    const crew = crewById(snapshot.crewId)
    const snapshotReason = target.disposition
    target.status = '待重排'
    target.crewId = null
    target.slotStart = null
    target.slotEnd = null
    target.assignedTo = '待重排'
    bump(target)
    addRevision(target, `被紧急缺陷顶替，进入待重排（原班组 ${crew?.name}，证据 ${snapshot.evidenceCount} 份保留）`, operator)
    addAudit(targetId, '紧急顶替', operator, `${target.deviceName}原计划（${snapshot.slotStart.slice(5, 16).replace('T', ' ')}）让出给${urgent.deviceName}，原班次与证据已保留（V${target.version}）`)

    urgent.crewId = snapshot.crewId
    urgent.assignedTo = snapshot.crewName
    urgent.slotStart = snapshot.slotStart
    urgent.slotEnd = snapshot.slotEnd
    urgent.status = '整改中'
    bump(urgent)
    addRevision(urgent, `紧急顶替：占用${snapshot.crewName}原排班处理${target.deviceName}的让出时段`, operator)
    addAudit(urgentId, '紧急顶替', operator, `${urgent.deviceName}顶替${target.deviceName}，占用 ${snapshot.slotStart.slice(5, 16).replace('T', ' ')} 时段（V${urgent.version}）；被顶替工单处置背景：${snapshotReason || '无'}`)
    return { ok: true, message: `${urgent.deviceName}已顶替${target.deviceName}，原工单进入待重排` }
  }

  /** 待重排工单重新安排班组时段 */
  function reschedule(id: string, patch: Omit<SchedulePatch, 'reason'>, operator = '值班主管'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    const result = assignCrew(id, { ...patch, reason: '待重排工单重新排班' }, operator)
    if (result.ok) {
      addAudit(id, '重新排班', operator, `${record.deviceName}已重新安排，原顶替记录保留在修订时间线`)
    }
    return result
  }

  /** 台内在线保存处置（每次保存都生成一条沿班组/时段可查的修订） */
  function saveDisposition(id: string, patch: {
    disposition: string
    items: InspectionRecord['items']
    risk: InspectionRecord['risk']
    dueDate: string
    reason: string
  }, operator = '当前用户'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    record.disposition = patch.disposition
    record.items = patch.items
    record.risk = patch.risk
    record.dueDate = patch.dueDate
    bump(record)
    addRevision(record, patch.reason || '台内修改处置记录', operator)
    addAudit(id, '保存处置记录', operator, `${record.deviceName}保存修订 V${record.version}：${patch.reason || patch.disposition || '检验项调整'}`)
    return { ok: true, message: '已保存为新修订版本' }
  }

  /** 停用/恢复是设备级状态：同一设备编号下的所有缺陷单保持一致 */
  function setDeviceStopped(id: string, stopped: boolean, operator = '当前用户'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (!stopped) {
      const open = openDefectsForDevice(record.deviceCode)
      if (open.length) {
        return { ok: false, message: `${record.deviceName}仍有 ${open.length} 条未关闭缺陷（${open.map((item) => item.id).join('、')}），不能恢复开放` }
      }
    }
    const siblings = records.value.filter((item) => item.deviceCode === record.deviceCode)
    if (siblings.every((item) => item.stopped === stopped)) return { ok: true, message: '设备状态未变化' }
    siblings.forEach((item) => { item.stopped = stopped })
    bump(record)
    addRevision(record, stopped ? '执行停用隔离' : '缺陷清零，设备恢复开放', operator)
    addAudit(id, stopped ? '停用隔离' : '恢复开放', operator, `${record.deviceName}${stopped ? '已停用挂牌' : '恢复对外开放'}（V${record.version}）`)
    return { ok: true, message: stopped ? '设备已停用隔离' : '设备已恢复开放' }
  }

  function openDefectsForDevice(deviceCode: string) {
    return records.value.filter((item) => item.deviceCode === deviceCode
      && OPEN_DEFECT_STATUSES.includes(item.status))
  }

  /** 复测通过：关闭缺陷；设备无其他未关闭缺陷时才恢复开放 */
  function recheckPass(id: string, operator = '当前用户'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (record.conflict) return { ok: false, message: '两侧修改尚未合并取舍，存在双版本冲突，不能关闭' }
    if (record.items.some((item) => item.result === '异常')) {
      return { ok: false, message: '仍有异常项，复测未通过，不能关闭' }
    }
    record.status = '已关闭'
    const others = openDefectsForDevice(record.deviceCode)
    const released = others.length === 0
    if (released) {
      // 设备级放行：同设备编号的全部记录同步解除停用
      records.value.filter((item) => item.deviceCode === record.deviceCode).forEach((item) => { item.stopped = false })
    }
    bump(record)
    addRevision(record, released ? '复测通过，关闭缺陷并恢复设备开放' : `复测通过，关闭缺陷；设备仍有 ${others.length} 条未关闭缺陷，维持停用`, operator)
    addAudit(id, '复测闭环', operator, released
      ? `${record.deviceName}复测合格，缺陷关闭并恢复开放（V${record.version}）`
      : `${record.deviceName}本缺陷关闭，但仍有 ${others.map((item) => item.id).join('、')} 未关闭，维持停用（V${record.version}）`)
    return {
      ok: true,
      message: released ? '复测通过，缺陷关闭，设备已恢复开放' : '缺陷已关闭，但设备仍有其他未关闭缺陷，维持停用'
    }
  }

  /** 旧版通用状态流转（保留关闭校验，关闭统一走复测闭环） */
  function transition(id: string, next: InspectionStatus, detail: string): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record) return { ok: false, message: '记录不存在' }
    if (next === '已关闭') return recheckPass(id)
    if (next === '待复测' && record.conflict) return { ok: false, message: '存在双版本冲突，请先合并取舍' }
    record.status = next
    bump(record)
    addRevision(record, `状态流转：${next}`, '当前用户')
    addAudit(id, `状态流转：${next}`, '当前用户', detail)
    return { ok: true, message: `已流转至${next}` }
  }

  /** 断网入队发生在服务层（直接写本地存储），回台前刷新队列视图 */
  function refreshOfflineQueue() {
    offlineQueue.value = readQueue()
  }

  /** 班组断网完成处置 → 回台同步合并：幂等去重 + 同时修改双版本 */
  function syncOfflineQueue(operator = '班组回台同步') {
    const queue = readQueue()
    offlineQueue.value = queue
    const alreadyMerged = new Set(readMergedOpIds())
    let merged = 0
    let duplicated = 0
    let created = 0
    const conflicts: string[] = []

    for (const op of queue) {
      // 重复记录只入一次：同一 opId 重复同步直接跳过
      if (alreadyMerged.has(op.opId)) {
        duplicated += 1
        continue
      }

      if (op.type === 'create') {
        const existing = records.value.find((item) => item.id === op.recordId)
        if (existing) {
          duplicated += 1
          alreadyMerged.add(op.opId)
          continue
        }
        const now = new Date().toISOString()
        records.value.unshift({
          id: op.recordId,
          deviceCode: op.deviceCode ?? 'UNKNOWN',
          deviceName: op.deviceName ?? '断网登记设备',
          area: op.area ?? '未分区',
          shift: '早班',
          inspector: op.crewName,
          inspectedAt: op.queuedAt,
          status: '需整改',
          risk: op.risk ?? '中',
          stopped: true,
          assignedTo: op.crewName,
          crewId: crewList.value.find((crew) => crew.name === op.crewName)?.id ?? null,
          slotStart: null,
          slotEnd: null,
          requiredQuals: [],
          dueDate: op.queuedAt.slice(0, 10),
          items: createOfflineInspection({
            deviceCode: '', deviceName: '', area: '', shift: '早班', inspector: op.crewName,
            risk: op.risk ?? '中', assignedTo: op.crewName, dueDate: now.slice(0, 10)
          }).items,
          evidenceCount: op.evidenceCount,
          version: 1,
          disposition: op.disposition,
          revisions: [{
            id: uid('rev'), version: 1, reason: '班组断网期间现场登记，回台同步入库',
            operator: op.crewName, crewId: null, crewName: op.crewName, shift: '早班',
            slotStart: null, slotEnd: null, requiredQuals: [],
            disposition: op.disposition, evidenceCount: op.evidenceCount, createdAt: now
          }],
          preemption: null, conflict: null, conflictResolvedWith: null,
          createdAt: op.queuedAt, updatedAt: now
        })
        addAudit(op.recordId, '离线同步入库', operator, `${op.crewName}断网期间登记的新缺陷回台合并（${op.opId}）`)
        created += 1
        alreadyMerged.add(op.opId)
        continue
      }

      const record = records.value.find((item) => item.id === op.recordId)
      if (!record) {
        duplicated += 1
        alreadyMerged.add(op.opId)
        continue
      }

      // 同一缺陷两侧同时修改：基线版本落后于台内版本 → 保留两版并阻止关闭
      if (record.version > op.baseVersion) {
        const deskBranch: ConflictBranch = {
          side: '台内值班端',
          version: record.version,
          operator: '台内值班人员',
          reason: record.disposition,
          disposition: record.disposition,
          evidenceCount: record.evidenceCount,
          items: deepClone(record.items),
          updatedAt: record.updatedAt
        }
        const fieldBranch: ConflictBranch = {
          side: '班组离线端',
          version: op.baseVersion,
          operator: op.crewName,
          reason: op.disposition,
          disposition: op.disposition,
          evidenceCount: op.evidenceCount,
          items: deepClone(op.items ?? record.items),
          updatedAt: op.queuedAt
        }
        record.conflict = { branches: [deskBranch, fieldBranch], createdAt: new Date().toISOString() }
        bump(record)
        addRevision(record, `检测到两侧同时修改（台内 V${deskBranch.version} / 离线基于 V${op.baseVersion}），双版本并存，关闭已锁定`, operator)
        addAudit(record.id, '同步冲突', operator, `${op.crewName}离线修改与台内修改冲突，两版均保留，需人工取舍后才能关闭（V${record.version}，操作 ${op.opId}）`)
        conflicts.push(record.id)
        alreadyMerged.add(op.opId)
        continue
      }

      // 无冲突：快进合并离线处置
      record.items = deepClone(op.items ?? record.items)
      record.evidenceCount = Math.max(record.evidenceCount, op.evidenceCount)
      record.disposition = op.disposition
      if (record.status !== '待复测') record.status = '待复测'
      bump(record)
      addRevision(record, `断网处置回台合并：${op.disposition}`, op.crewName)
      addAudit(record.id, '离线同步合并', operator, `${op.crewName}断网处置结果已合并，证据 ${op.evidenceCount} 份，状态→待复测（V${record.version}，操作 ${op.opId}）`)
      merged += 1
      alreadyMerged.add(op.opId)
    }

    rememberMergedOpIds([...alreadyMerged])
    offlineQueue.value = []
    saveQueue([])

    return { merged, duplicated, created, conflicts }
  }

  /** 双版本冲突人工取舍：保留其中一版，解锁关闭 */
  function resolveConflict(id: string, side: ConflictBranch['side'], operator = '值班主管'): ActionResult {
    const record = records.value.find((item) => item.id === id)
    if (!record?.conflict) return { ok: false, message: '该记录没有待处理的双版本冲突' }
    const chosen = record.conflict.branches.find((branch) => branch.side === side)
    if (!chosen) return { ok: false, message: '选择的版本不存在' }
    record.items = deepClone(chosen.items)
    record.disposition = chosen.disposition
    record.evidenceCount = chosen.evidenceCount
    record.conflictResolvedWith = side
    record.conflict = null
    bump(record)
    addRevision(record, `冲突取舍：采用${side}版本（${chosen.operator}：${chosen.reason || '无说明'}）`, operator)
    addAudit(id, '冲突取舍', operator, `${record.deviceName}采用${side}版本，另一版保留在修订历史，关闭锁定解除（V${record.version}）`)
    return { ok: true, message: `已采用${side}版本，可以继续复测闭环` }
  }

  function addAudit(recordId: string, action: string, operator: string, detail: string) {
    audit.value.unshift({
      id: uid(recordId),
      recordId,
      action,
      operator,
      detail,
      createdAt: new Date().toISOString()
    })
  }

  function resetDemo() {
    records.value = deepClone(seedRecords)
    audit.value = deepClone(seedAudit)
    offlineQueue.value = []
    clearSyncMemory()
  }

  watch([records, audit], () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: records.value, audit: audit.value }))
  }, { deep: true })

  return {
    records,
    audit,
    crews: crewList,
    keyword,
    status,
    area,
    liveMessage,
    offlineQueue,
    filtered,
    stats,
    scheduleConflicts,
    crewOccupancy,
    crewName,
    crewById,
    refreshOfflineQueue,
    addRecord,
    assignCrew,
    preempt,
    reschedule,
    saveDisposition,
    setDeviceStopped,
    recheckPass,
    transition,
    syncOfflineQueue,
    resolveConflict,
    addAudit,
    resetDemo
  }
})

function fmt(value: string | null): string {
  if (!value) return ''
  return value.slice(5, 16).replace('T', ' ')
}
