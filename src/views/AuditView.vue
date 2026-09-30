<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'

const store = useInspectionStore()
const keyword = ref('')
const crewId = ref<string | null>(null)
const shift = ref<string | null>(null)

const crewOptions = computed(() => store.crews.map((crew) => ({ label: crew.name, value: crew.id })))
const shiftOptions = ['早班', '中班', '晚班'].map((value) => ({ label: value, value }))

/** 按班组 / 班次（时段）过滤修订，再叠加关键词 */
const revisionTrace = computed(() => {
  const trace = store.records.flatMap((record) => record.revisions.map((rev) => ({ record, rev })))
  return trace
    .filter(({ record, rev }) => {
      const matchCrew = !crewId.value || rev.crewId === crewId.value || record.crewId === crewId.value
      const matchShift = !shift.value || rev.shift === shift.value || record.shift === shift.value
      const slotText = `${rev.slotStart ?? ''} ${rev.slotEnd ?? ''}`
      const haystack = `${record.id} ${record.deviceName} ${rev.crewName} ${rev.reason} ${rev.disposition} ${slotText}`
      const matchKeyword = !keyword.value || haystack.toLowerCase().includes(keyword.value.toLowerCase())
      return matchCrew && matchShift && matchKeyword
    })
    .sort((a, b) => b.rev.createdAt.localeCompare(a.rev.createdAt))
})

const entries = computed(() => store.audit.filter((item) => !keyword.value
  || `${item.recordId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value)))
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div><h2>操作审计与版本追溯</h2><p>沿班组、时段和修订号回溯每一次处置原因；同步冲突、顶替、放行均有留痕。</p></div>
      <div class="audit-filters">
        <NInput v-model:value="keyword" clearable placeholder="按编号、班组、原因搜索" style="max-width: 260px" />
        <NSelect v-model:value="crewId" clearable :options="crewOptions" placeholder="班组" style="width: 140px" />
        <NSelect v-model:value="shift" clearable :options="shiftOptions" placeholder="班次时段" style="width: 130px" />
      </div>
    </div>

    <h3 class="trace-title">修订追溯（{{ revisionTrace.length }}）</h3>
    <div class="trace-table">
      <div v-for="({ record, rev }) in revisionTrace" :key="rev.id" class="trace-row">
        <NTag size="small" :bordered="false">V{{ rev.version }}</NTag>
        <div>
          <strong>{{ record.deviceName }}（{{ record.id }}）</strong>
          <p>{{ rev.reason }}</p>
          <small>
            {{ rev.crewName || '未派班组' }} · {{ rev.shift || '无班次' }}
            <template v-if="rev.slotStart"> · {{ rev.slotStart.slice(5, 16).replace('T', ' ') }} ~ {{ rev.slotEnd?.slice(11, 16) }}</template>
            <template v-if="rev.requiredQuals.length"> · 资质 {{ rev.requiredQuals.join('、') }}</template>
            · {{ rev.operator }} · {{ rev.createdAt.replace('T', ' ').slice(0, 16) }} · 证据 {{ rev.evidenceCount }} 份
          </small>
        </div>
      </div>
      <div v-if="!revisionTrace.length" class="kanban-empty">没有匹配的修订记录</div>
    </div>

    <h3 class="trace-title">完整操作时间线</h3>
    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ entry.createdAt.replace('T', ' ').slice(0, 16) }}</div>
        <i />
        <div class="audit-card">
          <header><strong>{{ entry.action }}</strong><NTag size="small" :bordered="false">{{ entry.recordId }}</NTag></header>
          <p>{{ entry.detail }}</p>
          <small>操作人：{{ entry.operator }}</small>
        </div>
      </article>
    </div>
  </section>
</template>
