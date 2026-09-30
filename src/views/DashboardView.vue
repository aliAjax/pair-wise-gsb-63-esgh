<script setup lang="ts">
import { computed, h, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCheckbox, NCheckboxGroup, NDataTable, NDatePicker, NForm, NFormItem, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useQuery } from '@tanstack/vue-query'
import { useInspectionStore } from '../stores/inspection'
import { loadInspectionSnapshot } from '../services/api'
import { ALL_QUALIFICATIONS, crews, formatSlot, presetSlot } from '../data/crews'
import type { InspectionDraft, Qualification, RiskLevel } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const showCreate = ref(false)

const draft = reactive<InspectionDraft & { shiftPreset: string; quals: Qualification[] }>({
  deviceCode: '', deviceName: '', area: 'A区北侧', shift: '早班', inspector: '周宁',
  risk: '中', assignedTo: '', dueDate: '2026-09-30',
  crewId: null, slot: null, requiredQuals: [], shiftPreset: '早班', quals: []
})

const { isFetching } = useQuery({
  queryKey: ['inspection-snapshot'],
  queryFn: () => loadInspectionSnapshot(store.records),
  staleTime: 60_000
})

const statusOptions = ['全部', '待检验', '需整改', '待重排', '整改中', '待复测', '已关闭', '停用'].map((value) => ({ label: value, value }))
const areaOptions = ['全部', ...new Set(store.records.map((item) => item.area))].map((value) => ({ label: value, value }))
const crewOptions = crews.map((crew) => ({ label: `${crew.name}（${crew.quals.join('/') || '无特殊资质'}）`, value: crew.id }))

const riskType: Record<string, 'error' | 'warning' | 'success' | 'default'> = { 紧急: 'error', 高: 'warning', 中: 'default', 低: 'default' }

const columns = [
  { title: '检验编号', key: 'id', width: 145 },
  { title: '设备', key: 'deviceName', width: 130, render: (row: any) => `${row.deviceName} / ${row.deviceCode}` },
  { title: '区域', key: 'area', width: 90 },
  { title: '状态', key: 'status', width: 95, render: (row: any) => h(NTag, { type: row.status === '已关闭' ? 'success' : row.stopped ? 'error' : row.status === '待重排' ? 'warning' : 'default', bordered: false, size: 'small' }, { default: () => row.status }) },
  { title: '风险', key: 'risk', width: 70, render: (row: any) => h(NTag, { type: riskType[row.risk], bordered: false, size: 'small' }, { default: () => row.risk }) },
  { title: '承担班组', key: 'assignedTo', width: 100 },
  { title: '处置时段', key: 'slot', width: 165, render: (row: any) => formatSlot(row.slot) },
  { title: '截止', key: 'dueDate', width: 105 },
  { title: '版本', key: 'version', width: 65, render: (row: any) => `V${row.version}` },
  { title: '', key: 'actions', width: 70, render: (row: any) => h(NButton, { size: 'tiny', tertiary: true, onClick: () => router.push(`/records/${row.id}`) }, { default: () => '打开' }) }
]

const validDraft = computed(() => draft.deviceCode && draft.deviceName && draft.dueDate)

function buildDraft(): InspectionDraft {
  const crew = crews.find((item) => item.id === draft.crewId)
  return {
    deviceCode: draft.deviceCode,
    deviceName: draft.deviceName,
    area: draft.area,
    shift: draft.shiftPreset,
    inspector: draft.inspector,
    risk: draft.risk,
    assignedTo: crew?.name ?? '',
    dueDate: draft.dueDate,
    crewId: draft.crewId ?? null,
    slot: draft.crewId ? presetSlot(draft.shiftPreset, draft.dueDate) : null,
    requiredQuals: draft.quals
  }
}

function resetDraft() {
  draft.deviceCode = ''
  draft.deviceName = ''
  draft.risk = '中'
  draft.crewId = null
  draft.quals = []
  draft.shiftPreset = '早班'
}

function createRecord() {
  if (!validDraft.value) return
  const payload = buildDraft()
  const record = store.addRecord(payload)
  showCreate.value = false
  resetDraft()
  message.success(`已创建 ${record.id}，已按班组/时段派工`)
  router.push(`/records/${record.id}`)
}

/** 模拟班组断网在现场新建：先进离线队列，回台同步后合并（重发只入一次） */
function createOffline() {
  if (!validDraft.value) return
  const payload = buildDraft()
  const crew = crews.find((item) => item.id === draft.crewId)
  const op = store.enqueueOfflineCreate(payload, `${crew?.name ?? '现场班组'}·现场平板01`)
  showCreate.value = false
  resetDraft()
  message.success(`现场已暂存新建记录（操作号 ${op.opId.slice(-6)}），请到「缺陷处置」页回台同步`)
}
</script>

<template>
  <section class="content">
    <div class="metric-strip metric-strip-5">
      <article><span>缺陷总数</span><strong>{{ store.stats.total }}</strong><small>含复用演示记录</small></article>
      <article><span>停用设备</span><strong>{{ store.stats.blocked }}</strong><small>未复测放行前隔离</small></article>
      <article><span>临近超期</span><strong>{{ store.stats.overdue }}</strong><small>按整改截止日计算</small></article>
      <article><span>待重排</span><strong>{{ store.stats.pendingReschedule }}</strong><small>被紧急缺陷顶替</small></article>
      <article><span>已闭环</span><strong>{{ store.stats.closed }}</strong><small>复测合格恢复开放</small></article>
    </div>

    <div class="toolbar toolbar-wide">
      <NInput v-model:value="store.keyword" clearable placeholder="搜索设备、编号、检验员或班组" />
      <NSelect v-model:value="store.status" :options="statusOptions" />
      <NSelect v-model:value="store.area" :options="areaOptions" />
      <NButton type="primary" @click="showCreate = true">新建缺陷/检验</NButton>
      <span class="query-state">
        {{ store.stats.pendingFieldOps ? `${store.stats.pendingFieldOps} 条离线作业待回传` : isFetching ? '正在同步' : '本地数据已加载' }}
      </span>
    </div>

    <NDataTable :columns="columns" :data="store.filtered" :bordered="false" :row-key="(row: any) => row.id" size="small" />

    <NModal v-model:show="showCreate" preset="card" title="新建缺陷 / 检验任务" style="width: 680px">
      <NForm label-placement="left" label-width="92">
        <div class="form-grid">
          <NFormItem label="设备编号" required><NInput v-model:value="draft.deviceCode" placeholder="例如 RC-009" /></NFormItem>
          <NFormItem label="设备名称" required><NInput v-model:value="draft.deviceName" /></NFormItem>
          <NFormItem label="区域"><NSelect v-model:value="draft.area" :options="areaOptions.filter((item) => item.value !== '全部')" /></NFormItem>
          <NFormItem label="检验员"><NInput v-model:value="draft.inspector" /></NFormItem>
          <NFormItem label="风险等级">
            <NSelect v-model:value="draft.risk" :options="['低', '中', '高', '紧急'].map((value) => ({ label: value, value: value as RiskLevel }))" />
          </NFormItem>
          <NFormItem label="截止日期"><NDatePicker v-model:formatted-value="draft.dueDate" value-format="yyyy-MM-dd" type="date" /></NFormItem>
          <NFormItem label="处置班组">
            <NSelect v-model:value="draft.crewId" clearable :options="crewOptions" placeholder="不选则暂不派工" />
          </NFormItem>
          <NFormItem label="处置班次">
            <NSelect v-model:value="draft.shiftPreset" :options="['早班', '中班', '晚班'].map((value) => ({ label: value, value }))" />
          </NFormItem>
        </div>
        <NFormItem label="资质要求">
          <NCheckboxGroup v-model:value="draft.quals">
            <NCheckbox v-for="qual in ALL_QUALIFICATIONS" :key="qual" :value="qual" :label="qual" />
          </NCheckboxGroup>
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="modal-actions">
          <span v-if="!validDraft" class="validation">设备编号、名称和截止日期必填</span>
          <NButton @click="showCreate = false">取消</NButton>
          <NButton secondary @click="createOffline" :disabled="!validDraft">模拟班组离线新建</NButton>
          <NButton type="primary" :disabled="!validDraft" @click="createRecord">创建并派工</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
