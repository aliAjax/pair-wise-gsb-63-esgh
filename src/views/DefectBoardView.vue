<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NModal, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { crews, formatSlot } from '../data/crews'
import ScheduleForm from '../components/ScheduleForm.vue'
import type { InspectionRecord, Qualification, ScheduleSlot } from '../types'

const store = useInspectionStore()
const router = useRouter()
const dialog = useDialog()
const message = useMessage()

const columns = ['需整改', '待重排', '整改中', '待复测', '已关闭'] as const
const riskOrder = { 紧急: 0, 高: 1, 中: 2, 低: 3 }
const riskType: Record<string, 'error' | 'warning' | 'default'> = { 紧急: 'error', 高: 'warning', 中: 'default', 低: 'default' }

const grouped = computed(() =>
  Object.fromEntries(columns.map((column) => [
    column,
    store.records.filter((item) => item.status === column)
      .sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || (a.slot?.start ?? '').localeCompare(b.slot?.start ?? ''))
  ]))
)

/** 班组占用：值班主管一眼看出谁已被占用、占用时段是什么 */
const occupancy = computed(() => crews.map((crew) => {
  const jobs = store.records
    .filter((item) => item.crewId === crew.id && item.slot && !['已关闭', '待重排'].includes(item.status))
    .sort((a, b) => a.slot!.start.localeCompare(b.slot!.start))
  return { crew, jobs, busy: jobs.length > 0 }
}))

const pendingConflicts = computed(() => store.records.flatMap((record) =>
  record.conflicts.filter((entry) => entry.status === '待裁决').map((entry) => ({ record, entry }))))

/* ---------------- 派工弹窗 ---------------- */
const assigning = ref<InspectionRecord | null>(null)
const showAssign = ref(false)
const submitting = ref(false)

function openAssign(record: InspectionRecord) {
  assigning.value = record
  showAssign.value = true
}

function handleAssign(payload: { crewId: string; slot: ScheduleSlot; requiredQuals: Qualification[] }) {
  if (!assigning.value) return
  const target = assigning.value
  const probe = store.planAssignment(target.id, { ...payload })
  if (probe.ok) {
    message.success(probe.message)
    showAssign.value = false
    assigning.value = null
    return
  }
  if (probe.code === 'preempt-available') {
    dialog.warning({
      title: `紧急顶替确认`,
      content: () => h('div', { style: 'line-height:1.9' }, [
        h('p', { style: 'margin:0 0 6px' }, probe.message),
        h('p', { style: 'margin:0;color:#8a5a16' }, '被顶替的低风险计划将保留原班次与现场证据，摘下班组时段进入「待重排」泳道。')
      ]),
      positiveText: '执行顶替并派工',
      negativeText: '取消',
      onPositiveClick: () => {
        const result = store.planAssignment(target.id, { ...payload, force: true })
        result.ok ? message.success(result.message) : message.error(result.message)
        if (result.ok) {
          showAssign.value = false
          assigning.value = null
        }
      }
    })
    return
  }
  message.error(probe.message)
}

/* ---------------- 离线回台同步 ---------------- */
const pendingOps = computed(() => store.fieldState.ops.filter((op) => !op.synced))
const syncedOps = computed(() => store.fieldState.ops.filter((op) => op.synced))

function syncNow() {
  if (!pendingOps.value.length) {
    message.info('离线队列已空')
    return
  }
  const summary = store.syncFieldOps()
  message[summary.conflicts ? 'warning' : 'success'](
    `同步完成：新并入 ${summary.imported} 条、直接并轨 ${summary.fastForwarded} 条、重复去重 ${summary.duplicated} 条、保留两版 ${summary.conflicts} 处`
  )
  summary.messages.forEach((line) => message.info(line))
}
</script>

<template>
  <section class="content">
    <div class="board-intro">
      <div><h2>缺陷处置泳道</h2><p>每条缺陷按班组、时段和资质派工；同一班组同一时段只能接一项，紧急缺陷可顶替低风险计划。</p></div>
      <div class="board-tools">
        <NButton v-if="pendingConflicts.length" type="warning" secondary @click="router.push(`/records/${pendingConflicts[0].record.id}`)">
          {{ pendingConflicts.length }} 处两版待裁决
        </NButton>
        <NButton @click="store.resetDemo()">恢复演示数据</NButton>
      </div>
    </div>

    <div class="kanban kanban-5">
      <div v-for="column in columns" :key="column" class="kanban-column">
        <header>
          <span :class="{ 'lane-reschedule': column === '待重排' }">{{ column }}</span>
          <b>{{ (grouped as any)[column].length }}</b>
        </header>
        <article v-for="record in (grouped as any)[column]" :key="record.id" @click="router.push(`/records/${record.id}`)">
          <div>
            <NTag :type="riskType[record.risk]" size="small" :bordered="false">{{ record.risk }}风险</NTag>
            <small>V{{ record.version }}<i v-if="record.conflicts.some((c: any) => c.status === '待裁决')" class="conflict-dot" /></small>
          </div>
          <h3>{{ record.deviceName }}</h3>
          <p>{{ record.deviceCode }} · {{ record.area }}</p>
          <div class="card-schedule">
            <span>{{ record.assignedTo }}</span>
            <small>{{ formatSlot(record.slot) }}</small>
          </div>
          <div v-if="record.requiredQuals.length" class="card-quals">
            <NTag v-for="qual in record.requiredQuals" :key="qual" size="tiny" :bordered="false">{{ qual }}</NTag>
          </div>
          <footer>
            <span :class="{ overdue: record.dueDate <= store.today }">{{ record.dueDate }} 截止</span>
            <NButton size="tiny" tertiary @click.stop="openAssign(record)">
              {{ record.status === '待重排' ? '重新排班' : record.crewId ? '改派' : '派工' }}
            </NButton>
          </footer>
        </article>
        <div v-if="!(grouped as any)[column].length" class="kanban-empty">暂无任务</div>
      </div>
    </div>

    <div class="board-grid">
      <section class="conflict-table">
        <h3>班组占用一览（值班主管视角）</h3>
        <p class="section-hint">按时段排序，跨班重叠的排工会在派工时被拦截；同班组同时段只能接一项。</p>
        <div class="occupancy-list">
          <div v-for="row in occupancy" :key="row.crew.id" class="occupancy-row">
            <div class="occ-crew">
              <strong>{{ row.crew.name }}</strong>
              <small>资质：{{ row.crew.quals.join('、') || '无' }}</small>
              <NTag size="tiny" :type="row.busy ? 'warning' : 'success'" :bordered="false">{{ row.busy ? `占用 ${row.jobs.length} 项` : '可派' }}</NTag>
            </div>
            <div class="occ-jobs">
              <span v-if="!row.jobs.length" class="occ-idle">当前时段表空闲</span>
              <span v-for="job in row.jobs" :key="job.id" class="occ-job" @click="router.push(`/records/${job.id}`)">
                <em>{{ formatSlot(job.slot) }}</em>{{ job.deviceName }} · {{ job.risk }}风险
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="conflict-table offline-panel">
        <h3>班组断网回台同步</h3>
        <p class="section-hint">班组断网完成处置后记录暂存现场终端，回台一键合并：重复记录只入一次；同缺陷两侧同时修改时保留两版并阻止关闭。</p>
        <div class="offline-actions">
          <NButton type="primary" size="small" :disabled="!pendingOps.length" @click="syncNow">
            网络恢复·同步合并（{{ pendingOps.length }} 条待传）
          </NButton>
          <NButton size="small" tertiary :disabled="!syncedOps.length" @click="store.clearSyncedFieldOps()">清空已传记录</NButton>
        </div>
        <ul class="offline-list">
          <li v-for="op in store.fieldState.ops" :key="op.opId + op.createdAt">
            <NTag size="tiny" :type="op.synced ? 'success' : 'default'" :bordered="false">{{ op.synced ? '已同步' : '离线暂存' }}</NTag>
            <span class="op-client">{{ op.clientName }}</span>
            <span class="op-body">{{ op.type === 'create' ? `新建缺陷：${op.draft?.deviceName}` : `处置完成：${op.note}` }}</span>
            <small v-if="op.synced">{{ op.outcome }}</small>
            <button v-else class="link-btn" @click="store.duplicatePendingOp(op.opId)">模拟网络重发</button>
          </li>
          <li v-if="!store.fieldState.ops.length" class="offline-empty">暂无离线作业，可在缺陷详情页模拟「断网处置」</li>
        </ul>
      </section>
    </div>

    <NModal v-model:show="showAssign" preset="card" :title="`派工安排 · ${assigning?.deviceName ?? ''}`" style="width: 720px"
      @update:show="(value: boolean) => { if (!value) assigning = null }">
      <ScheduleForm v-if="assigning" :record="assigning" :submitting="submitting" @submitted="handleAssign" />
    </NModal>
  </section>
</template>
