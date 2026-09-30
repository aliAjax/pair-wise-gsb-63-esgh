<script setup lang="ts">
import { computed, h, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NDataTable, NInput, NSelect, NTag, useDialog, useMessage } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { deepClone } from '../services/api'
import type { CheckResult, InspectionRecord, Qualification } from '../types'
import ScheduleEditor from '../components/ScheduleEditor.vue'

const route = useRoute()
const router = useRouter()
const store = useInspectionStore()
const message = useMessage()
const dialog = useDialog()
const record = computed(() => store.records.find((item) => item.id === route.params.id))
const form = reactive({
  risk: '低' as InspectionRecord['risk'],
  dueDate: '',
  disposition: '',
  items: [] as InspectionRecord['items'],
  reason: ''
})

watch(record, (value) => {
  if (value) {
    form.risk = value.risk
    form.dueDate = value.dueDate
    form.disposition = value.disposition
    form.items = deepClone(value.items)
    form.reason = ''
  }
}, { immediate: true, deep: true })

const openSiblings = computed(() => record.value
  ? store.records.filter((item) => item.deviceCode === record.value!.deviceCode
      && !['已关闭'].includes(item.status))
  : [])

const clashingJob = computed(() => {
  if (!record.value) return undefined
  return store.records.find((other) => other.id !== record.value!.id
    && other.crewId === record.value!.crewId && record.value!.crewId
    && record.value!.slotStart && record.value!.slotEnd
    && (record.value!.slotStart as string) < (other.slotEnd ?? '')
    && (other.slotStart ?? '') < (record.value!.slotEnd as string))
})

const fmt = (value: string | null) => value ? value.slice(5, 16).replace('T', ' ') : '未排时段'

function handleSchedule(payload: {
  crewId: string | null
  slotStart: string | null
  slotEnd: string | null
  requiredQuals: Qualification[]
  reason: string
}) {
  if (!record.value) return
  const result = store.assignCrew(record.value.id, payload)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function saveDisposition() {
  if (!record.value) return
  if (!form.reason.trim()) {
    message.error('请填写本次修订原因，修订时间线需要留痕')
    return
  }
  const result = store.saveDisposition(record.value.id, {
    disposition: form.disposition,
    items: form.items,
    risk: form.risk,
    dueDate: form.dueDate,
    reason: form.reason
  })
  result.ok ? message.success(result.message) : message.error(result.message)
  if (result.ok) form.reason = ''
}

function confirmStop(stopped: boolean) {
  if (!record.value) return
  dialog.warning({
    title: stopped ? '确认停用隔离' : '确认恢复开放',
    content: stopped
      ? '停用后设备将挂牌隔离，值班台禁止排乘。'
      : '系统会校验该设备是否仍有未关闭缺陷，存在未关闭缺陷时将阻止恢复开放。',
    positiveText: '确认',
    negativeText: '取消',
    onPositiveClick: () => {
      const result = store.setDeviceStopped(record.value!.id, stopped)
      result.ok ? message.success(result.message) : message.error(result.message)
    }
  })
}

function recheck() {
  if (!record.value) return
  const result = store.recheckPass(record.value.id)
  result.ok ? message.success(result.message, { duration: 5000 }) : message.error(result.message, { duration: 5000 })
}

function resolveConflict(side: '台内值班端' | '班组离线端') {
  if (!record.value) return
  const result = store.resolveConflict(record.value.id, side)
  result.ok ? message.success(result.message) : message.error(result.message)
}

function preemptClash() {
  if (!record.value || !clashingJob.value) return
  const result = store.preempt(record.value.id, clashingJob.value.id)
  result.ok ? message.success(result.message) : message.error(result.message)
}

const columns = [
  { title: '检验项', key: 'name', width: 130 },
  { title: '结果', key: 'result', width: 120, render: (row: any) => h(NSelect, {
    value: row.result,
    options: ['正常', '异常', '不适用'].map((value) => ({ label: value, value })),
    onUpdateValue: (value: CheckResult) => { row.result = value }
  }) },
  { title: '实测值', key: 'reading', width: 160, render: (row: any) => h(NInput, { value: row.reading, onUpdateValue: (value: string) => { row.reading = value } }) },
  { title: '判定标准', key: 'limit', width: 150 },
  { title: '备注', key: 'note', render: (row: any) => h(NInput, { value: row.note, onUpdateValue: (value: string) => { row.note = value } }) }
]

const hasAbnormal = computed(() => form.items.some((item) => item.result === '异常'))
const revisionsDesc = computed(() => [...(record.value?.revisions ?? [])].reverse())

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
          <p>{{ record.deviceCode }} · {{ record.area }} · {{ record.shift }}</p>
          <h2>{{ record.deviceName }}</h2>
        </div>
        <div class="head-actions">
          <NTag :type="record.stopped ? 'error' : record.status === '已关闭' ? 'success' : 'warning'" :bordered="false">
            {{ record.stopped ? '设备已停用' : record.status }}
          </NTag>
          <NButton @click="exportRecord">导出记录</NButton>
        </div>
      </div>

      <!-- 被顶替保留信息 -->
      <div v-if="record.preemption" class="preemption-banner">
        <NTag type="warning" :bordered="false">已被顶替 · 待重排</NTag>
        <p>
          原班次 <b>{{ record.preemption.shift }} · {{ record.preemption.crewName }}</b>，
          原时段 {{ fmt(record.preemption.slotStart) }} ~ {{ record.preemption.slotEnd?.slice(11, 16) }}，
          资质 {{ record.preemption.requiredQuals.join('、') || '无' }}，证据 {{ record.preemption.evidenceCount }} 份均已保留。
          {{ record.preemption.reason }}
        </p>
      </div>

      <!-- 双版本冲突 -->
      <div v-if="record.conflict" class="conflict-panel">
        <header><NTag type="error" :bordered="false">两侧同时修改 · 双版本并存</NTag><span>缺陷关闭已锁定，请人工取舍（另一版仍保留在修订历史）</span></header>
        <div class="branches">
          <div v-for="branch in record.conflict.branches" :key="branch.side" class="branch">
            <h4>{{ branch.side }} <small>基于 V{{ branch.version }} · {{ branch.operator }}</small></h4>
            <p>{{ branch.disposition || '无处置说明' }}</p>
            <small>证据 {{ branch.evidenceCount }} 份 · 异常项 {{ branch.items.filter((i) => i.result === '异常').length }} 项</small>
            <NButton size="small" type="primary" secondary @click="resolveConflict(branch.side)">采用此版本</NButton>
          </div>
        </div>
      </div>

      <!-- 排班：班组 / 时段 / 资质 -->
      <div class="schedule-block">
        <h3>处置排班</h3>
        <p class="block-hint">同一班组同一时段只能接一项；资质不匹配或时段重叠将被拒绝。</p>
        <ScheduleEditor :record="record" @submit="handleSchedule" />
        <div v-if="clashingJob" class="clash-hint">
          <NTag type="error" size="small" :bordered="false">时段冲突</NTag>
          <span>该时段已被 {{ clashingJob.deviceName }} 占用。</span>
          <NButton v-if="record.risk === '紧急'" size="small" type="error" secondary @click="preemptClash">
            紧急缺陷顶替「{{ clashingJob.deviceName }}」
          </NButton>
        </div>
      </div>

      <div class="form-band">
        <label>风险等级
          <NSelect v-model:value="form.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value }))" />
        </label>
        <label>截止日期 <input v-model="form.dueDate" class="native-date" type="date" /></label>
        <label class="wide">处置说明 <NInput v-model:value="form.disposition" type="textarea" :autosize="{ minRows: 1, maxRows: 3 }" /></label>
      </div>

      <h3>逐项检验结果</h3>
      <NDataTable :columns="columns" :data="form.items" :bordered="false" size="small" />

      <div class="evidence-panel">
        <div><strong>现场证据</strong><span>{{ record.evidenceCount }} 份证据随修订留痕，断网期间证据离线保存、回台合并。</span></div>
        <div class="evidence-list">
          <span>锁止间隙近景</span><span>设备铭牌</span><span>制动测试仪表</span>
          <button @click="record.evidenceCount += 1; message.success('已模拟上传现场照片')">上传照片</button>
        </div>
      </div>

      <div class="revision-save">
        <label>本次修订原因（必填）
          <NInput v-model:value="form.reason" placeholder="例如：复测读数修正 / 备件到货继续整改 / 调整处置说明" />
        </label>
        <NButton type="primary" :disabled="!!record.conflict" @click="saveDisposition">保存为新修订版本</NButton>
      </div>

      <!-- 修订时间线：沿班组、时段和修订号追溯每次原因 -->
      <div class="revision-history">
        <h3>修订时间线（班组 / 时段 / 修订原因）</h3>
        <div v-for="rev in revisionsDesc" :key="rev.id" class="revision-item">
          <div class="revision-meta">
            <NTag size="small" :bordered="false">V{{ rev.version }}</NTag>
            <strong>{{ rev.crewName || '未派班组' }}</strong>
            <span>{{ rev.shift }}{{ rev.slotStart ? ` · ${fmt(rev.slotStart)}~${rev.slotEnd?.slice(11, 16)}` : '' }}</span>
            <small v-if="rev.requiredQuals.length">资质：{{ rev.requiredQuals.join('、') }}</small>
          </div>
          <p>{{ rev.reason }}</p>
          <small class="revision-foot">{{ rev.operator }} · {{ rev.createdAt.replace('T', ' ').slice(0, 16) }} · 证据 {{ rev.evidenceCount }} 份{{ rev.disposition ? ` · ${rev.disposition}` : '' }}</small>
        </div>
      </div>
    </div>

    <aside class="detail-side">
      <div>
        <span class="side-label">当前流程</span>
        <strong>{{ record.status }}</strong>
        <small>版本 V{{ record.version }} · 更新于 {{ record.updatedAt.replace('T', ' ').slice(0, 16) }}</small>
      </div>

      <div class="release-card" :class="{ released: !record.stopped }">
        <span class="side-label">设备放行</span>
        <strong>{{ record.stopped ? '停用隔离中' : '正常开放' }}</strong>
        <p v-if="openSiblings.length" class="blocked-note">
          同设备另有 {{ openSiblings.length }} 条未关闭缺陷：{{ openSiblings.map((item) => item.id).join('、') }}
        </p>
        <NButton v-if="record.stopped" block secondary @click="confirmStop(false)">申请恢复开放</NButton>
        <NButton v-else block secondary @click="confirmStop(true)">执行停用隔离</NButton>
      </div>

      <div class="recheck-card">
        <span class="side-label">复测闭环</span>
        <p v-if="record.conflict" class="blocked-note">存在双版本冲突，已阻止关闭，请先在上方取舍。</p>
        <p v-else-if="hasAbnormal" class="blocked-note">仍有异常项，复测不通过，不能关闭。</p>
        <p v-else>全部检验项正常，复测通过后关闭缺陷；设备无其他未关闭缺陷时自动恢复开放。</p>
        <NButton block type="primary" :disabled="hasAbnormal || !!record.conflict || record.status === '已关闭'" @click="recheck">复测通过，关闭缺陷</NButton>
      </div>

      <div class="rule-note">
        <strong>闭环规则</strong>
        <p>① 同班组同时段只能一项；② 紧急可顶替低风险，被顶单留证进待重排；③ 断网合并幂等去重，双改留双版锁关闭；④ 设备有未关闭缺陷不得开放。</p>
      </div>
      <NButton block tertiary @click="router.push('/audit')">查看完整审计</NButton>
    </aside>
  </section>
  <section v-else class="content empty-state">未找到检验记录</section>
</template>
