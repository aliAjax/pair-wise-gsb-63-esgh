<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { crews, formatSlot, formatStamp } from '../data/crews'
import ScheduleForm from '../components/ScheduleForm.vue'
import type { CheckResult, InspectionRecord, InspectionStatus, Qualification, ScheduleSlot } from '../types'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()
const record = computed(() => store.findRecord(String(route.params.id)))
const form = reactive<Partial<InspectionRecord>>({})
const fieldClient = ref('维修一组·现场平板01')
const fieldNote = ref('已更换锁止销轴并复检，申请复测')

const stopState = computed({
  get: () => form.stopped ? '停用隔离' : '正常开放',
  set: (value: string) => { form.stopped = value === '停用隔离' }
})

watch(record, (value) => {
  if (value) Object.assign(form, structuredClone(value))
}, { immediate: true })

const items = computed(() => record.value?.items ?? [])
const transitions: InspectionStatus[] = ['待检验', '需整改', '整改中', '待复测', '待重排', '已关闭', '停用']

/** 同设备未关闭缺陷：设备恢复开放的联动闸门 */
const siblingOpenDefects = computed(() => record.value ? store.openDefectsOfDevice(record.value.deviceCode, record.value.id) : [])
const pendingConflicts = computed(() => record.value?.conflicts.filter((entry) => entry.status === '待裁决') ?? [])
const recordOps = computed(() => store.fieldState.ops.filter((op) => op.recordId === record.value?.id))
const clientOptions = crews.map((crew) => ({ label: `${crew.name}·现场平板`, value: `${crew.name}·现场平板01` }))

function save() {
  if (!record.value) return
  const result = store.updateRecord(record.value.id, {
    dueDate: form.dueDate,
    risk: form.risk,
    stopped: form.stopped,
    items: form.items
  })
  result.ok ? message.success(result.message) : message.error(result.message)
}

/** 主台在班组离线期间又改了记录：回传时基线版本落后，触发两版保留 */
function simulateMasterEditDuringOffline() {
  if (!record.value) return
  const result = store.updateRecord(record.value.id, { dueDate: record.value.dueDate }, '主台同步修改', '值班主管')
  if (result.ok) message.warning('主台已产生新版本；现场回传时将保留两版并阻止关闭')
}

function handleAssign(payload: { crewId: string; slot: ScheduleSlot; requiredQuals: Qualification[] }) {
  if (!record.value) return
  const target = record.value
  const probe = store.planAssignment(target.id, { ...payload })
  if (probe.ok) {
    message.success(probe.message)
    return
  }
  if (probe.code === 'preempt-available') {
    dialog.warning({
      title: '紧急顶替确认',
      content: () => h('div', { style: 'line-height:1.9' }, [
        h('p', { style: 'margin:0 0 6px' }, probe.message),
        h('p', { style: 'margin:0;color:#8a5a16' }, '被顶缺陷保留原班次与证据，进入「待重排」泳道。')
      ]),
      positiveText: '执行顶替并派工',
      negativeText: '取消',
      onPositiveClick: () => {
        const result = store.planAssignment(target.id, { ...payload, force: true })
        result.ok ? message.success(result.message) : message.error(result.message)
      }
    })
    return
  }
  message.error(probe.message)
}

function changeStatus(next: InspectionStatus) {
  if (!record.value) return
  if (next === '已关闭') {
    dialog.warning({
      title: '复测通过并关闭缺陷',
      content: '系统校验异常项、两版冲突和同设备未关闭缺陷；全部满足才关闭并恢复设备开放。',
      positiveText: '确认复测通过',
      negativeText: '取消',
      onPositiveClick: () => {
        const result = store.retestPass(record.value!.id)
        result.ok ? message.success(result.message) : message.error(result.message)
      }
    })
    return
  }
  dialog.warning({
    title: `确认流转至${next}`,
    content: '系统会校验异常项、停用状态和两版冲突，并写入修订链与操作审计。',
    positiveText: '确认流转',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.transition(record.value!.id, next, `由${record.value!.status}流转至${next}`)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

/** 班组断网：处置结果暂存现场终端 */
function offlineComplete() {
  if (!record.value) return
  const result = store.enqueueOfflineComplete(record.value.id, fieldClient.value, fieldNote.value)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function resolveConflict(conflictId: string, keep: 'field' | 'master') {
  if (!record.value) return
  const result = store.resolveConflict(record.value.id, conflictId, keep)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function addEvidence() {
  if (!record.value) return
  const result = store.updateRecord(record.value.id, { evidenceCount: record.value.evidenceCount + 1 }, '补充现场证据')
  if (result.ok) message.success('已上传现场照片并记入修订')
}

const columns = [
  { title: '检验项', key: 'name', width: 130 },
  { title: '结果', key: 'result', width: 120, render: (row: any, index: number) => h(NSelect, { value: row.result, options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })), onUpdateValue: (value: CheckResult) => { row.result = value } }) },
  { title: '实测值', key: 'reading', width: 160, render: (row: any) => h(NInput, { value: row.reading, onUpdateValue: (value: string) => { row.reading = value } }) },
  { title: '判定标准', key: 'limit', width: 150 },
  { title: '备注', key: 'note', render: (row: any) => h(NInput, { value: row.note, onUpdateValue: (value: string) => { row.note = value } }) }
]

function exportRecord() {
  if (!record.value) return
  const blob = new Blob([JSON.stringify(record.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${record.value.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <section v-if="record" class="content detail-layout">
    <div class="detail-main">
      <div class="section-head">
        <div>
          <p>{{ record.deviceCode }} · {{ record.area }} · 原检验班次 {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">
            {{ record.stopped ? '设备已停用隔离' : `${record.status} / 开放中` }}
          </NTag>
          <NButton @click="exportRecord">导出记录</NButton>
          <NButton type="primary" @click="save">保存新版本</NButton>
        </div>
      </div>

      <div v-if="record.stopped || siblingOpenDefects.length" class="gate-banner">
        <strong>设备放行联动</strong>
        <p v-if="record.stopped && siblingOpenDefects.length">
          {{ record.deviceName }} 仍有 {{ siblingOpenDefects.length }} 条未关闭缺陷（{{ siblingOpenDefects.map((item) => item.id).join('、') }}），
          本缺陷关闭后设备仍不能恢复开放。
        </p>
        <p v-else-if="record.stopped">设备处于停用隔离；本缺陷复测通过且无其他未关闭缺陷时，关闭即自动恢复开放。</p>
        <p v-else>同设备尚有未关闭缺陷，恢复开放操作将被拦截。</p>
      </div>

      <div class="schedule-card">
        <h3>派工安排（班组 / 时段 / 资质）</h3>
        <ScheduleForm :record="record" @submitted="handleAssign" />
      </div>

      <div class="form-band form-band-static">
        <label>当前承担班组 <NInput :value="record.assignedTo" readonly /></label>
        <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" /></label>
        <label>风险等级 <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" /></label>
        <label>设备状态 <NSelect v-model:value="stopState" :options="['正常开放', '停用隔离'].map((value) => ({ label: value, value }))" /></label>
      </div>

      <h3>逐项检验结果</h3>
      <NDataTable :columns="columns" :data="items" :bordered="false" size="small" />

      <div class="evidence-panel">
        <div><strong>现场证据</strong><span>{{ record.evidenceCount }} 份 · 证据随缺陷保留，顶替进待重排也不丢失</span></div>
        <div class="evidence-list">
          <span>锁止间隙近景</span><span>设备铭牌</span><span>制动测试仪表</span>
          <button @click="addEvidence">上传照片</button>
        </div>
      </div>

      <section v-if="record.conflicts.length" class="conflict-version-panel">
        <h3>两侧同时修改 · 版本并轨（保留两版，裁决前阻止关闭）</h3>
        <article v-for="conflict in record.conflicts" :key="conflict.id" class="conflict-version">
          <header>
            <div>
              <strong>{{ conflict.id }}</strong>
              <NTag size="small" :type="conflict.status === '待裁决' ? 'error' : 'default'" :bordered="false">{{ conflict.status }}</NTag>
            </div>
            <small>{{ conflict.clientName }} · {{ formatStamp(conflict.createdAt) }}</small>
          </header>
          <div class="version-grid">
            <div class="version-col version-field">
              <span>现场离线版（基线 V{{ conflict.baseRevision }}）</span>
              <p>状态：{{ (conflict.fieldPatch as any).status }} · 证据 {{ (conflict.fieldPatch as any).evidenceCount }} 份</p>
              <p>{{ conflict.fieldNote }}</p>
            </div>
            <div class="version-col version-master">
              <span>主台当前版（V{{ conflict.currentRevision }}）</span>
              <p>状态：{{ record.status }} · 证据 {{ record.evidenceCount }} 份</p>
              <p>主台在现场离线期间另有修改，两版均已留痕。</p>
            </div>
          </div>
          <div v-if="conflict.status === '待裁决'" class="version-actions">
            <NButton size="small" type="primary" @click="resolveConflict(conflict.id, 'field')">采用现场版并轨</NButton>
            <NButton size="small" @click="resolveConflict(conflict.id, 'master')">保留主台版（现场版归档）</NButton>
          </div>
          <p v-else class="version-resolved">已裁决：{{ conflict.status }} · {{ conflict.resolvedAt ? formatStamp(conflict.resolvedAt) : '' }}</p>
        </article>
      </section>

      <section class="offline-detail-panel">
        <h3>班组断网处置</h3>
        <div class="offline-detail-form">
          <label>现场终端
            <NSelect v-model:value="fieldClient" :options="clientOptions" />
          </label>
          <label class="offline-note">处置说明
            <NInput v-model:value="fieldNote" type="textarea" :autosize="{ minRows: 1, maxRows: 2 }" />
          </label>
          <NButton size="small" type="primary" :disabled="record.status === '已关闭'" @click="offlineComplete">断网完成处置·暂存回传队列</NButton>
          <NButton size="small" tertiary @click="simulateMasterEditDuringOffline">模拟主台同时修改</NButton>
        </div>
        <ul v-if="recordOps.length" class="offline-record-ops">
          <li v-for="op in recordOps" :key="op.opId + op.createdAt">
            <NTag size="tiny" :type="op.synced ? 'success' : 'default'" :bordered="false">{{ op.synced ? '已同步' : '待回传' }}</NTag>
            <span>{{ op.clientName }} · 基线 V{{ op.baseRevision }}</span>
            <small v-if="op.synced">{{ op.outcome }}</small>
            <button v-else class="link-btn" @click="store.duplicatePendingOp(op.opId)">模拟网络重发（重传去重）</button>
          </li>
        </ul>
        <p class="offline-tip">回台后到「缺陷处置」页点“网络恢复·同步合并”；同一操作号重复回传只入一次，基线落后则保留两版。</p>
      </section>

      <section class="revision-panel">
        <h3>修订与原因追溯（{{ record.revisions.length }} 版）</h3>
        <div class="revision-list">
          <article v-for="revision in [...record.revisions].reverse()" :key="revision.revision" class="revision-item">
            <div class="rev-index">V{{ revision.revision }}</div>
            <div class="rev-body">
              <header>
                <strong>{{ revision.action }}</strong>
                <NTag size="tiny" :type="revision.source === '班组离线回传' ? 'info' : 'default'" :bordered="false">{{ revision.source }}</NTag>
              </header>
              <p>{{ revision.reason }}</p>
              <small>
                {{ formatStamp(revision.at) }} · {{ revision.operator }} · 班组 {{ revision.crewName ?? '未派班' }} ·
                班次 {{ revision.shift }} · {{ formatSlot(revision.slot) }}
              </small>
            </div>
          </article>
        </div>
      </section>
    </div>

    <aside class="detail-side">
      <div>
        <span class="side-label">当前流程</span>
        <strong>{{ record.status }}</strong>
        <small>版本 V{{ record.version }} · 更新于 {{ formatStamp(record.updatedAt) }}</small>
      </div>
      <div class="flow-list">
        <button v-for="next in transitions" :key="next" :class="{ active: next === record.status }" @click="changeStatus(next)">
          <span>{{ next }}</span>
          <small>{{ next === record.status ? '当前状态' : next === '已关闭' ? '复测通过并放行' : '执行流转' }}</small>
        </button>
      </div>
      <div v-if="pendingConflicts.length" class="rule-note rule-warn">
        <strong>存在 {{ pendingConflicts.length }} 处待裁决两版</strong>
        <p>同一缺陷两侧同时修改已保留两版，裁决完成前阻止关闭。</p>
      </div>
      <div class="rule-note">
        <strong>闭环与放行校验</strong>
        <p>异常项清零、两版冲突已裁决、同设备无其他未关闭缺陷，复测通过后才关闭并恢复设备；任一不满足均拦截。</p>
      </div>
      <NButton block @click="router.push('/audit')">查看完整审计</NButton>
    </aside>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
