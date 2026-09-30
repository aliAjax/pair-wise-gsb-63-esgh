import axios from 'axios'
import type { InspectionDraft, InspectionItem, InspectionRecord, OfflineOperation, RiskLevel } from '../types'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5000
})

const OFFLINE_QUEUE_KEY = 'gsb63:offline-queue'
const MERGED_OP_KEY = 'gsb63:merged-ops'

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 深拷贝：structuredClone 无法直接序列化 Vue reactive Proxy，统一走 JSON 拷贝 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const emptyItems = (): InspectionItem[] => [
  { id: 'wear', name: '结构磨损', result: '正常', reading: '待录入', limit: '≤ 5.0 mm', note: '' },
  { id: 'noise', name: '运行异响', result: '正常', reading: '待录入', limit: '≤ 75 dB', note: '' },
  { id: 'brake', name: '制动装置', result: '正常', reading: '待录入', limit: '制动可靠', note: '' },
  { id: 'lock', name: '锁止机构', result: '正常', reading: '待录入', limit: '无可见间隙', note: '' },
  { id: 'safety', name: '安全装置', result: '正常', reading: '待录入', limit: '动作可靠', note: '' }
]

export async function loadInspectionSnapshot(fallback: InspectionRecord[]): Promise<InspectionRecord[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try {
    const response = await client.get<InspectionRecord[]>('/inspections')
    return response.data
  } catch {
    return fallback
  }
}

/** 缺陷/检验单号：日期 + 当日递增序号，防止同一毫秒连建撞号 */
let recordSequence = 0
let recordSequenceDay = ''
export function nextRecordId(): string {
  const now = new Date()
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  if (day !== recordSequenceDay) {
    recordSequenceDay = day
    recordSequence = 0
  }
  recordSequence += 1
  return `INS-${day}-${String(recordSequence).padStart(3, '0')}`
}

export function createOfflineInspection(draft: InspectionDraft): InspectionRecord {
  const now = new Date().toISOString()
  return {
    id: nextRecordId(),
    ...draft,
    inspectedAt: now,
    status: '待检验',
    stopped: false,
    crewId: null,
    slotStart: null,
    slotEnd: null,
    requiredQuals: [],
    items: emptyItems(),
    evidenceCount: 0,
    version: 1,
    disposition: '',
    revisions: [{
      id: uid('rev'),
      version: 1,
      reason: '新建设备班次检验任务',
      operator: draft.inspector,
      crewId: null,
      crewName: draft.assignedTo,
      shift: draft.shift,
      slotStart: null,
      slotEnd: null,
      requiredQuals: [],
      disposition: '',
      evidenceCount: 0,
      createdAt: now
    }],
    preemption: null,
    conflict: null,
    conflictResolvedWith: null,
    createdAt: now,
    updatedAt: now
  }
}

/** 断网期间班组在本地登记的新缺陷 */
export function queueOfflineCreate(input: {
  recordId: string
  crewName: string
  deviceCode: string
  deviceName: string
  area: string
  risk: RiskLevel
  baseVersion: number
}): OfflineOperation {
  const op: OfflineOperation = {
    opId: uid('op'),
    recordId: input.recordId,
    crewName: input.crewName,
    type: 'create',
    disposition: '断网期间现场登记的新缺陷',
    evidenceCount: 2,
    items: null,
    deviceCode: input.deviceCode,
    deviceName: input.deviceName,
    area: input.area,
    risk: input.risk,
    baseVersion: input.baseVersion,
    queuedAt: new Date().toISOString()
  }
  saveQueue([...readQueue(), op])
  return op
}

/** 断网期间班组完成处置：处置说明、证据、逐项结果全部离线保存，回台再合并 */
export function queueOfflineComplete(input: {
  recordId: string
  crewName: string
  disposition: string
  evidenceCount: number
  items: InspectionItem[]
  baseVersion: number
}): OfflineOperation {
  const op: OfflineOperation = {
    opId: uid('op'),
    recordId: input.recordId,
    crewName: input.crewName,
    type: 'complete',
    disposition: input.disposition,
    evidenceCount: input.evidenceCount,
    items: input.items,
    baseVersion: input.baseVersion,
    queuedAt: new Date().toISOString()
  }
  saveQueue([...readQueue(), op])
  return op
}

export function readQueue(): OfflineOperation[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveQueue(queue: OfflineOperation[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
}

export function readMergedOpIds(): string[] {
  try {
    const raw = localStorage.getItem(MERGED_OP_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function rememberMergedOpIds(ids: string[]) {
  const merged = new Set([...readMergedOpIds(), ...ids])
  localStorage.setItem(MERGED_OP_KEY, JSON.stringify([...merged]))
}

export function clearSyncMemory() {
  localStorage.removeItem(OFFLINE_QUEUE_KEY)
  localStorage.removeItem(MERGED_OP_KEY)
}

export function connectLiveUpdates(onMessage: (message: string) => void): () => void {
  const endpoint = import.meta.env.VITE_WS_URL
  if (!endpoint) return () => undefined
  const socket = new WebSocket(endpoint)
  socket.addEventListener('message', (event) => onMessage(String(event.data)))
  return () => socket.close()
}
