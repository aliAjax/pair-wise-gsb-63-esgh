<script setup lang="ts">
import { computed, ref } from 'vue'
import { NInput, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { crews, formatSlot } from '../data/crews'

const store = useInspectionStore()
const keyword = ref('')
const crewId = ref<string>('全部')
const source = ref('全部')

const crewOptions = [{ label: '全部班组', value: '全部' }, ...crews.map((crew) => ({ label: crew.name, value: crew.id }))]
const sourceOptions = ['全部', '主台', '班组离线回传'].map((value) => ({ label: value, value }))

const entries = computed(() => store.audit.filter((item) =>
  (!keyword.value || `${item.recordId} ${item.action} ${item.operator} ${item.detail}`.includes(keyword.value))
  && (crewId.value === '全部' || item.crewId === crewId.value)
  && (source.value === '全部' || item.source === source.value)
))
</script>

<template>
  <section class="content audit-layout">
    <div class="audit-head">
      <div><h2>操作审计与版本追溯</h2><p>沿班组、时段和修订可重新打开页面找到每次缺陷原因；重新打开页面数据仍在本地持久化。</p></div>
      <div class="audit-filters">
        <NSelect v-model:value="crewId" :options="crewOptions" size="small" style="width: 150px" />
        <NSelect v-model:value="source" :options="sourceOptions" size="small" style="width: 150px" />
        <NInput v-model:value="keyword" clearable size="small" placeholder="按编号、操作人、动作搜索" style="width: 240px" />
      </div>
    </div>
    <div class="timeline">
      <article v-for="entry in entries" :key="entry.id">
        <div class="time">{{ entry.createdAt.replace('T', ' ').slice(0, 16) }}</div>
        <i />
        <div class="audit-card">
          <header>
            <strong>{{ entry.action }}</strong>
            <span class="audit-tags">
              <NTag size="small" :bordered="false" :type="entry.source === '班组离线回传' ? 'info' : 'default'">{{ entry.source ?? '主台' }}</NTag>
              <NTag size="small" :bordered="false">{{ entry.recordId }}</NTag>
              <NTag v-if="entry.revision" size="small" type="warning" :bordered="false">V{{ entry.revision }}</NTag>
            </span>
          </header>
          <p>{{ entry.detail }}</p>
          <small>
            操作人：{{ entry.operator }}
            <template v-if="entry.crewId"> · 班组：{{ crews.find((c) => c.id === entry.crewId)?.name ?? entry.crewId }}</template>
            <template v-if="entry.slot"> · 时段：{{ formatSlot(entry.slot) }}</template>
          </small>
        </div>
      </article>
    </div>
  </section>
</template>
