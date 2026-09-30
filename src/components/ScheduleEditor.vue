<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NSelect } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import type { InspectionRecord, Qualification } from '../types'

const props = defineProps<{ record?: InspectionRecord | null; submitText?: string }>()
const emit = defineEmits<{
  submit: [payload: {
    crewId: string | null
    slotStart: string | null
    slotEnd: string | null
    requiredQuals: Qualification[]
    reason: string
  }]
}>()

const store = useInspectionStore()
const qualOptions = ['高空', '电气', '液压', '焊接', '制动'].map((value) => ({ label: value, value }))
const crewOptions = computed(() => store.crews.map((crew) => ({
  label: `${crew.name}（资质：${crew.quals.join('、') || '—'}）`,
  value: crew.id
})))

const crewId = ref<string | null>(null)
const slotStart = ref<string | null>(null)
const slotEnd = ref<string | null>(null)
const requiredQuals = ref<Qualification[]>([])
const reason = ref('')

watch(() => props.record, (record) => {
  if (record) {
    crewId.value = record.crewId
    slotStart.value = record.slotStart
    slotEnd.value = record.slotEnd
    requiredQuals.value = [...record.requiredQuals]
  }
}, { immediate: true })

function submit() {
  emit('submit', {
    crewId: crewId.value,
    slotStart: slotStart.value,
    slotEnd: slotEnd.value,
    requiredQuals: requiredQuals.value,
    reason: reason.value
  })
}
</script>

<template>
  <div class="schedule-editor">
    <label>
      <span>处置班组</span>
      <NSelect v-model:value="crewId" :options="crewOptions" placeholder="选择维修班组" clearable />
    </label>
    <label>
      <span>开始时间</span>
      <input v-model="slotStart" class="native-datetime" type="datetime-local" />
    </label>
    <label>
      <span>结束时间</span>
      <input v-model="slotEnd" class="native-datetime" type="datetime-local" />
    </label>
    <label class="quals">
      <span>资质要求</span>
      <NSelect v-model:value="requiredQuals" :options="qualOptions" multiple placeholder="该缺陷所需资质" />
    </label>
    <label class="reason">
      <span>排班/修订原因</span>
      <NInput v-model:value="reason" type="textarea" :autosize="{ minRows: 2 }" placeholder="例如：紧急顶替后重新排班 / 按资质调整班组" />
    </label>
    <NButton type="primary" @click="submit">{{ submitText ?? '确认排班' }}</NButton>
  </div>
</template>

<style scoped>
.schedule-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.schedule-editor label { font-size: 12px; color: #63726f; display: grid; gap: 6px; }
.schedule-editor .quals, .schedule-editor .reason { grid-column: 1 / -1; }
.schedule-editor .native-datetime { width: 100%; height: 34px; border: 1px solid #d8dfdc; border-radius: 3px; padding: 0 8px; background: white; }
.schedule-editor .reason { margin-bottom: 2px; }
.schedule-editor button { grid-column: 1 / -1; justify-self: end; }
</style>
