<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDataTable, NDatePicker, NForm, NFormItem, NInput, NInputNumber, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { useQuery } from '@tanstack/vue-query'
import { useInspectionStore } from '../stores/inspection'
import { loadInspectionSnapshot } from '../services/api'
import type { InspectionDraft, RiskLevel } from '../types'

const store = useInspectionStore()
const router = useRouter()
const message = useMessage()
const showCreate = ref(false)
const draft = ref<InspectionDraft>({ deviceCode: '', deviceName: '', area: 'A区', shift: '早班', inspector: '周宁', risk: '中', assignedTo: '维修一组', dueDate: '2026-09-30' })

const { isFetching } = useQuery({
  queryKey: ['inspection-snapshot'],
  queryFn: () => loadInspectionSnapshot(store.records),
  staleTime: 60_000
})

const statusOptions = ['全部', '待检验', '需整改', '整改中', '待复测', '已关闭', '停用'].map((value) => ({ label: value, value }))
const areaOptions = ['全部', ...new Set(store.records.map((item) => item.area))].map((value) => ({ label: value, value }))
const riskOptions: Array<{ label: RiskLevel; value: RiskLevel }> = ['低', '中', '高', '紧急'].map((value) => ({ label: value as RiskLevel, value: value as RiskLevel }))

const columns = [
  { title: '检验编号', key: 'id', width: 145 },
  { title: '设备', key: 'deviceName', width: 130, render: (row: any) => `${row.deviceName} / ${row.deviceCode}` },
  { title: '区域', key: 'area', width: 90 },
  { title: '状态', key: 'status', width: 90, render: (row: any) => h(NTag, { type: row.stopped ? 'error' : row.status === '已关闭' ? 'success' : row.status === '待重排' ? 'warning' : 'default', bordered: false }, { default: () => row.status }) },
  { title: '风险', key: 'risk', width: 70 },
  {
    title: '班组 / 时段 / 资质', key: 'schedule', width: 260,
    render: (row: any) => h('div', { class: 'cell-schedule' }, [
      h('strong', row.assignedTo),
      h('small', row.slotStart ? `${row.slotStart.slice(5, 16).replace('T', ' ')} ~ ${row.slotEnd?.slice(11, 16)}` : '未排时段'),
      h('small', (row.requiredQuals ?? []).join('、') || '无资质要求')
    ])
  },
  {
    title: '提示', key: 'flags', width: 120,
    render: (row: any) => {
      const flags: string[] = []
      if (store.scheduleConflicts.some((c) => c.record.id === row.id || c.other.id === row.id)) flags.push('时段冲突')
      if (row.conflict) flags.push('双版本')
      if (row.status === '待重排') flags.push('待重排')
      return flags.length ? h(NTag, { type: 'error', size: 'small', bordered: false }, { default: () => flags.join('·') }) : '—'
    }
  },
  { title: '', key: 'actions', width: 80, render: (row: any) => h(NButton, { size: 'small', tertiary: true, onClick: () => router.push(`/records/${row.id}`) }, { default: () => '打开' }) }
]

const riskType = (risk: RiskLevel) => risk === '紧急' ? 'error' : risk === '高' ? 'warning' : 'default'
const validDraft = computed(() => draft.value.deviceCode && draft.value.deviceName && draft.value.assignedTo && draft.value.dueDate)

function createRecord() {
  if (!validDraft.value) return
  const record = store.addRecord(draft.value)
  showCreate.value = false
  message.success(`已创建 ${record.id}`)
  router.push(`/records/${record.id}`)
}
</script>

<template>
  <section class="content">
    <div class="metric-strip">
      <article><span>今日检验任务</span><strong>{{ store.stats.total }}</strong><small>含复用演示记录</small></article>
      <article><span>停用设备</span><strong>{{ store.stats.blocked }}</strong><small>未关闭缺陷清零前禁止开放</small></article>
      <article><span>待重排 / 冲突</span><strong>{{ store.stats.waitingReschedule }} / {{ store.stats.conflicts }}</strong><small>被紧急顶替让出时段的工单</small></article>
      <article><span>已闭环</span><strong>{{ store.stats.closed }}</strong><small>异常项复测合格后恢复开放</small></article>
    </div>

    <div class="toolbar">
      <NInput v-model:value="store.keyword" clearable placeholder="搜索设备、编号、检验员或责任人" />
      <NSelect v-model:value="store.status" :options="statusOptions" />
      <NSelect v-model:value="store.area" :options="areaOptions" />
      <NButton type="primary" @click="showCreate = true">新建检验任务</NButton>
      <span class="query-state">{{ isFetching ? '正在同步' : '本地数据已加载' }}</span>
    </div>

    <NDataTable :columns="columns" :data="store.filtered" :bordered="false" :row-key="(row: any) => row.id" size="small" />

    <NModal v-model:show="showCreate" preset="card" title="新建日常检验任务" style="width: 620px">
      <NForm label-placement="left" label-width="92">
        <div class="form-grid">
          <NFormItem label="设备编号" required><NInput v-model:value="draft.deviceCode" placeholder="例如 RC-009" /></NFormItem>
          <NFormItem label="设备名称" required><NInput v-model:value="draft.deviceName" /></NFormItem>
          <NFormItem label="区域"><NSelect v-model:value="draft.area" :options="areaOptions.filter((item) => item.value !== '全部')" /></NFormItem>
          <NFormItem label="班次"><NSelect v-model:value="draft.shift" :options="['早班', '中班', '晚班'].map((value) => ({ label: value, value }))" /></NFormItem>
          <NFormItem label="检验员"><NInput v-model:value="draft.inspector" /></NFormItem>
          <NFormItem label="风险等级"><NSelect v-model:value="draft.risk" :options="riskOptions" /></NFormItem>
          <NFormItem label="整改责任"><NInput v-model:value="draft.assignedTo" /></NFormItem>
          <NFormItem label="截止日期"><NDatePicker v-model:formatted-value="draft.dueDate" value-format="yyyy-MM-dd" type="date" /></NFormItem>
        </div>
      </NForm>
      <template #footer>
        <div class="modal-actions">
          <span v-if="!validDraft" class="validation">设备编号、名称、责任人和截止日期必填</span>
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="!validDraft" @click="createRecord">创建并进入检验</NButton>
        </div>
      </template>
    </NModal>
  </section>
</template>
