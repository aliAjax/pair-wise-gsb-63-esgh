<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { queueOfflineComplete, queueOfflineCreate, deepClone } from '../services/api'
import { RISK_RANK } from '../types'
import type { InspectionRecord, RiskLevel } from '../types'
import ScheduleEditor from '../components/ScheduleEditor.vue'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()

const columns = ['需整改', '整改中', '待复测', '待重排', '已关闭'] as const
const grouped = computed(() => Object.fromEntries(columns.map((status) => [
  status,
  store.records.filter((item) => item.status === status).sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk])
])))

const riskType = (risk: RiskLevel) => risk === '紧急' ? 'error' : risk === '高' ? 'warning' : 'default'
const fmt = (value: string | null) => value ? value.slice(5, 16).replace('T', ' ') : '未排时段'
const fmtTime = (value: string | null) => value ? value.slice(11, 16) : '—'

/* ---------- 改派 / 重排弹窗 ---------- */
const scheduling = ref<InspectionRecord | null>(null)
function openSchedule(record: InspectionRecord) {
  scheduling.value = record
}
function handleSchedule(payload: {
  crewId: string | null
  slotStart: string | null
  slotEnd: string | null
  requiredQuals: import('../types').Qualification[]
  reason: string
}) {
  if (!scheduling.value) return
  const result = store.assignCrew(scheduling.value.id, payload)
  result.ok ? message.success(result.message) : message.error(result.message)
  if (result.ok) scheduling.value = null
}

/* ---------- 紧急顶替 ---------- */
function doPreempt(urgentId: string, targetId: string) {
  const result = store.preempt(urgentId, targetId)
  result.ok ? message.success(result.message) : message.error(result.message)
}

/* ---------- 断网模拟与回台同步 ---------- */
const offlineRecordId = ref<string | null>(null)
const offlineDisposition = ref('断网完成现场处置：缺陷已消除，申请复测')
const offlineBaseVersion = ref<number | null>(null)
const offlineChoices = computed(() => store.records
  .filter((item) => !['已关闭'].includes(item.status))
  .map((item) => ({ label: `${item.id} ${item.deviceName}（当前 V${item.version}）`, value: item.id })))

const baseVersionOptions = computed(() => {
  const record = store.records.find((item) => item.id === offlineRecordId.value)
  if (!record) return []
  return Array.from({ length: record.version }, (_, index) => {
    const version = index + 1
    return { label: `V${version}${version === record.version ? '（当前）' : '（台内若再修改将产生双版本）'}`, value: version }
  })
})

function queueComplete() {
  const record = store.records.find((item) => item.id === offlineRecordId.value)
  if (!record) {
    message.error('请先选择缺陷工单')
    return
  }
  const baseVersion = offlineBaseVersion.value ?? record.version
  queueOfflineComplete({
    recordId: record.id,
    crewName: record.assignedTo === '待重排' ? '维修一组' : record.assignedTo,
    disposition: offlineDisposition.value,
    evidenceCount: record.evidenceCount + 1,
    items: deepClone(record.items).map((item) => ({ ...item, result: item.result === '异常' ? '正常' : item.result })),
    baseVersion
  })
  store.refreshOfflineQueue()
  message.warning(`已登记断网处置（基于 V${baseVersion}），回台后才会同步`)
}

const newDefect = ref({ deviceCode: 'RC-009', deviceName: '激流勇进', area: 'B区', risk: '高' as RiskLevel })
function queueCreate() {
  queueOfflineCreate({
    recordId: `INS-OFF-${Date.now().toString().slice(-6)}`,
    crewName: '维修二组',
    ...newDefect.value,
    baseVersion: 1
  })
  store.refreshOfflineQueue()
  message.warning('班组断网期间登记了一条新缺陷，等待回台入库')
}

function syncNow() {
  const summary = store.syncOfflineQueue()
  if (!summary.merged && !summary.created && !summary.conflicts.length && !summary.duplicated) {
    message.info('离线队列是空的')
    return
  }
  const parts = [
    summary.merged && `快进合并 ${summary.merged} 条`,
    summary.created && `新缺陷入库 ${summary.created} 条`,
    summary.conflicts.length && `双版本冲突 ${summary.conflicts.length} 条（已阻止关闭）`,
    summary.duplicated && `重复记录跳过 ${summary.duplicated} 条`
  ].filter(Boolean)
  message.success(`回台同步完成：${parts.join('，')}`, { duration: 6000 })
}
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div><h2>缺陷处置泳道</h2><p>每条缺陷按班组、跨班时段与资质派单；同一班组同一时段只能接一项。</p></div>
      <NButton @click="store.resetDemo()">恢复演示数据</NButton>
    </div>

    <!-- 班组占用视图：值班主管一眼看出谁被占用、哪里跨班重叠 -->
    <div class="crew-occupancy">
      <header><h3>班组占用时段</h3><small>红框 = 同班组时段冲突</small></header>
      <div class="crew-grid">
        <div v-for="row in store.crewOccupancy" :key="row.crew.id" class="crew-row">
          <div class="crew-meta">
            <strong>{{ row.crew.name }}</strong>
            <span>{{ row.crew.quals.join('、') || '无资质' }}</span>
            <b :class="{ busy: row.jobs.length }">{{ row.jobs.length }} 项在排</b>
          </div>
          <div class="crew-slots">
            <template v-if="row.jobs.length">
              <span
                v-for="job in row.jobs"
                :key="job.id"
                class="slot-chip"
                :class="{ clash: store.scheduleConflicts.some((c) => c.record.id === job.id || c.other.id === job.id), waiting: job.status === '待重排' }"
                @click="router.push(`/records/${job.id}`)"
              >
                <strong>{{ job.deviceName }}</strong>
                <small>{{ fmt(job.slotStart) }} ~ {{ fmtTime(job.slotEnd) }}</small>
                <small>{{ job.shift }} · {{ job.requiredQuals.join('、') || '无资质要求' }}</small>
              </span>
            </template>
            <em v-else>当前无排班</em>
          </div>
        </div>
      </div>
    </div>

    <!-- 冲突与顶替 -->
    <div v-if="store.scheduleConflicts.length" class="conflict-banner">
      <h3>排班冲突（{{ store.scheduleConflicts.length }}）</h3>
      <div v-for="({ record, other }) in store.scheduleConflicts" :key="record.id + other.id" class="conflict-row">
        <NTag type="error" :bordered="false">时段重叠</NTag>
        <p>
          <b>{{ record.assignedTo }}</b>：{{ record.deviceName }}（{{ fmt(record.slotStart) }}-{{ fmtTime(record.slotEnd) }}）
          与 {{ other.deviceName }}（{{ fmt(other.slotStart) }}-{{ fmtTime(other.slotEnd) }}）重叠
        </p>
        <template v-if="RISK_RANK[record.risk] < RISK_RANK[other.risk]">
          <NButton size="small" type="error" secondary @click="doPreempt(record.id, other.id)">紧急缺陷「{{ record.deviceName }}」顶替</NButton>
        </template>
        <template v-else-if="RISK_RANK[other.risk] < RISK_RANK[record.risk]">
          <NButton size="small" type="error" secondary @click="doPreempt(other.id, record.id)">紧急缺陷「{{ other.deviceName }}」顶替</NButton>
        </template>
        <NButton size="small" tertiary @click="openSchedule(RISK_RANK[record.risk] <= RISK_RANK[other.risk] ? other : record)">改派低风险工单</NButton>
      </div>
    </div>

    <div class="kanban five">
      <div v-for="column in columns" :key="column" class="kanban-column" :class="{ waitingCol: column === '待重排' }">
        <header><span>{{ column }}</span><b>{{ grouped[column].length }}</b></header>
        <article v-for="record in grouped[column]" :key="record.id" class="defect-card" @click="router.push(`/records/${record.id}`)">
          <div>
            <NTag :type="riskType(record.risk)" size="small" :bordered="false">{{ record.risk }}风险</NTag>
            <small>V{{ record.version }}{{ record.conflict ? ' · 双版本' : '' }}</small>
          </div>
          <h3>{{ record.deviceName }}</h3>
          <p>{{ record.deviceCode }} · {{ record.area }}</p>
          <p class="schedule-line">
            <b>{{ record.assignedTo }}</b><br />
            {{ fmt(record.slotStart) }} ~ {{ fmtTime(record.slotEnd) }}
          </p>
          <p v-if="record.requiredQuals.length" class="qual-line">
            <NTag v-for="qual in record.requiredQuals" :key="qual" size="small" :bordered="false">{{ qual }}</NTag>
          </p>
          <footer>
            <span>{{ record.dueDate }} 截止</span>
            <span v-if="record.stopped" class="stopped">已停用</span>
          </footer>
          <NTag v-if="record.status === '待重排'" type="warning" size="small" :bordered="false">原班次/证据已保留</NTag>
          <div class="card-actions" @click.stop>
            <NButton size="tiny" tertiary @click="openSchedule(record)">{{ record.status === '待重排' ? '重新排班' : '改派' }}</NButton>
          </div>
        </article>
        <div v-if="!grouped[column].length" class="kanban-empty">暂无任务</div>
      </div>
    </div>

    <!-- 断网处置：本地登记，回台合并（重复只入一次 / 两侧同改保留双版） -->
    <div class="offline-panel">
      <header>
        <h3>班组断网作业与回台同步</h3>
        <NTag :type="store.offlineQueue.length ? 'warning' : 'success'" :bordered="false">
          离线队列 {{ store.offlineQueue.length }} 条
        </NTag>
      </header>
      <div class="offline-body">
        <div class="offline-block">
          <strong>断网完成处置</strong>
          <NSelect v-model:value="offlineRecordId" :options="offlineChoices" placeholder="选择已派工的缺陷" size="small" />
          <NInput v-model:value="offlineDisposition" type="textarea" :autosize="{ minRows: 2 }" size="small" placeholder="处置说明" />
          <label>
            离线基线版本（台内继续改后同步会产生双版本冲突）
            <NSelect
              v-model:value="offlineBaseVersion"
              :options="baseVersionOptions"
              size="small"
              :consistent-menu-width="false"
              style="max-width: 260px"
              placeholder="默认当前版本"
              clearable
            />
          </label>
          <div class="inline-hint">
            <NButton size="small" secondary @click="queueComplete">登记断网处置</NButton>
            <span>证据离线保存，异常项按现场复测转为正常</span>
          </div>
        </div>
        <div class="offline-block">
          <strong>断网登记新缺陷</strong>
          <div class="offline-form">
            <NInput v-model:value="newDefect.deviceCode" size="small" placeholder="设备编号" />
            <NInput v-model:value="newDefect.deviceName" size="small" placeholder="设备名称" />
            <NInput v-model:value="newDefect.area" size="small" placeholder="区域" />
            <NSelect
              v-model:value="newDefect.risk"
              size="small"
              :options="(['低', '中', '高', '紧急'] as RiskLevel[]).map((value) => ({ label: value, value }))"
            />
          </div>
          <NButton size="small" secondary @click="queueCreate">登记新缺陷（离线）</NButton>
        </div>
        <div class="offline-block sync-block">
          <strong>回台同步合并</strong>
          <p>按操作号幂等去重，重复记录只入一次；同一缺陷两侧都改过则保留两版并锁定关闭。</p>
          <NButton type="primary" @click="syncNow">班组回台，立即同步</NButton>
        </div>
      </div>
    </div>

    <NModal v-if="scheduling" :show="true" preset="card" :title="`排班 / 改派：${scheduling.deviceName}`" style="width: 640px" @update:show="(value: boolean) => !value && (scheduling = null)">
      <ScheduleEditor :record="scheduling" submit-text="保存排班（校验时段与资质）" @submit="handleSchedule" />
    </NModal>
  </section>
</template>
