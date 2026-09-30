import axios from 'axios'
import type { InspectionDraft, InspectionRecord } from '../types'
import { crewNameOf } from '../data/crews'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5000
})

export async function loadInspectionSnapshot(fallback: InspectionRecord[]): Promise<InspectionRecord[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try {
    const response = await client.get<InspectionRecord[]>('/inspections')
    return response.data
  } catch {
    return fallback
  }
}

function standardItems(): InspectionRecord['items'] {
  return [
    { id: 'wear', name: '结构磨损', result: '正常', reading: '待录入', limit: '≤ 5.0 mm', note: '' },
    { id: 'noise', name: '运行异响', result: '正常', reading: '待录入', limit: '≤ 75 dB', note: '' },
    { id: 'brake', name: '制动装置', result: '正常', reading: '待录入', limit: '制动可靠', note: '' },
    { id: 'lock', name: '锁止机构', result: '正常', reading: '待录入', limit: '无可见间隙', note: '' },
    { id: 'safety', name: '安全装置', result: '正常', reading: '待录入', limit: '动作可靠', note: '' }
  ]
}

/** 新建检验记录（主台新建与班组离线新建共用） */
export function createOfflineInspection(draft: InspectionDraft, source: '主台' | '班组离线回传' = '主台'): InspectionRecord {
  const now = new Date().toISOString()
  const assignedTo = draft.assignedTo || crewNameOf(draft.crewId ?? null)
  const record: InspectionRecord = {
    id: `INS-${Date.now().toString().slice(-10)}`,
    deviceCode: draft.deviceCode,
    deviceName: draft.deviceName,
    area: draft.area,
    shift: draft.shift,
    inspector: draft.inspector,
    inspectedAt: now,
    status: '待检验',
    risk: draft.risk,
    stopped: false,
    assignedTo,
    dueDate: draft.dueDate,
    items: standardItems(),
    evidenceCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    crewId: draft.crewId ?? null,
    slot: draft.slot ?? null,
    requiredQuals: draft.requiredQuals ?? [],
    displacedFromSlot: null,
    displacedBy: null,
    displacedAt: null,
    revisions: [{
      revision: 1,
      action: source === '主台' ? '创建检验记录' : '班组离线新建',
      operator: draft.inspector,
      reason: source === '主台' ? '新建设备班次检验任务' : '班组断网期间在现场新建，回台后合并',
      source,
      at: now,
      crewId: draft.crewId ?? null,
      crewName: assignedTo,
      slot: draft.slot ?? null,
      shift: draft.shift,
      snapshot: {
        status: '待检验', risk: draft.risk, stopped: false, assignedTo,
        summary: '新建记录', evidenceCount: 0
      }
    }],
    conflicts: []
  }
  return record
}

export function connectLiveUpdates(onMessage: (message: string) => void): () => void {
  const endpoint = import.meta.env.VITE_WS_URL
  if (!endpoint) return () => undefined
  const socket = new WebSocket(endpoint)
  socket.addEventListener('message', (event) => onMessage(String(event.data)))
  return () => socket.close()
}
