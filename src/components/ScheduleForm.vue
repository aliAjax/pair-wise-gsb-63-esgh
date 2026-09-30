<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { NButton, NCheckboxGroup, NCheckbox, NSelect, NTag } from 'naive-ui'
import { useInspectionStore } from '../stores/inspection'
import { ALL_QUALIFICATIONS, crews, crewSatisfies, presetSlot, shiftOfSlot } from '../data/crews'
import type { InspectionRecord, Qualification, ScheduleSlot, ShiftPreset } from '../types'

const props = defineProps<{ record: InspectionRecord; submitting?: boolean }>()
const emit = defineEmits<{
  (event: 'submitted', payload: { crewId: string; slot: ScheduleSlot; requiredQuals: Qualification[] }): void
}>()

const store = useInspectionStore()

const crewOptions = crews.map((crew) => ({
  label: `${crew.name}（${crew.quals.join('/') || '无特殊资质'}）`,
  value: crew.id
}))

const form = reactive({
  crewId: props.record.crewId ?? '',
  date: (props.record.slot?.start ?? '2026-09-30').slice(0, 10),
  start: (props.record.slot?.start ?? '2026-09-30T08:00').slice(11, 16),
  end: (props.record.slot?.end ?? '2026-09-30T11:00').slice(11, 16),
  requiredQuals: [...props.record.requiredQuals] as Qualification[]
})

watch(() => props.record, (value) => {
  form.crewId = value.crewId ?? ''
  form.date = (value.slot?.start ?? '2026-09-30').slice(0, 10)
  form.start = (value.slot?.start ?? '2026-09-30T08:00').slice(11, 16)
  form.end = (value.slot?.end ?? '2026-09-30T11:00').slice(11, 16)
  form.requiredQuals = [...value.requiredQuals]
})

function applyPreset(shift: ShiftPreset) {
  const slot = presetSlot(shift, form.date)
  form.start = slot.start.slice(11, 16)
  form.end = slot.end.slice(11, 16)
}

const slot = computed<ScheduleSlot>(() => ({ start: `${form.date}T${form.start}`, end: `${form.date}T${form.end}` }))
const slotValid = computed(() => slot.value.start < slot.value.end)
const slotShift = computed(() => shiftOfSlot(slot.value))

const crewOk = computed(() => !form.crewId || crewSatisfies(form.crewId, form.requiredQuals))
const selectedCrew = computed(() => crews.find((crew) => crew.id === form.crewId))
const missingQuals = computed(() =>
  selectedCrew.value ? form.requiredQuals.filter((qual) => !selectedCrew.value!.quals.includes(qual)) : [])

const occupancy = computed(() => {
  if (!form.crewId || !slotValid.value) return []
  return store.scheduledConflicts(form.crewId, slot.value, props.record.id)
})

function submit() {
  if (!form.crewId || !slotValid.value) return
  emit('submitted', { crewId: form.crewId, slot: { ...slot.value }, requiredQuals: [...form.requiredQuals] })
}
</script>

<template>
  <div class="schedule-form">
    <div class="sf-row">
      <label>处置班组
        <NSelect v-model:value="form.crewId" :options="crewOptions" placeholder="选择维修班组（值班主管可见班组占用）" />
      </label>
      <label>资质要求
        <NCheckboxGroup v-model:value="form.requiredQuals" class="sf-quals">
          <NCheckbox v-for="qual in ALL_QUALIFICATIONS" :key="qual" :value="qual" :label="qual" />
        </NCheckboxGroup>
      </label>
    </div>
    <div class="sf-row">
      <label>处置日期
        <input v-model="form.date" class="native-date" type="date" />
      </label>
      <label>开始
        <input v-model="form.start" class="native-date" type="time" />
      </label>
      <label>结束
        <input v-model="form.end" class="native-date" type="time" />
      </label>
      <div class="sf-presets">
        <span>快捷班次：</span>
        <button type="button" @click="applyPreset('早班')">早班 08-16</button>
        <button type="button" @click="applyPreset('中班')">中班 16-24</button>
        <button type="button" @click="applyPreset('晚班')">晚班 00-08</button>
      </div>
    </div>
    <div class="sf-check">
      <NTag size="small" :bordered="false" :type="slotValid ? 'info' : 'error'">
        时段 {{ slot.start.replace('T', ' ') }} – {{ slot.end.slice(11) }}（按开始时间归{{ slotShift }}，跨班时段也会校验重叠）
      </NTag>
      <NTag v-if="form.crewId" size="small" :bordered="false" :type="crewOk ? 'success' : 'error'">
        {{ crewOk ? '班组资质满足要求' : `缺少资质：${missingQuals.join('、')}` }}
      </NTag>
      <NTag v-if="occupancy.length" size="small" type="warning" :bordered="false">
        班组占用：{{ occupancy.map((item) => `${item.deviceName} ${item.slot!.start.slice(11)}-${item.slot!.end.slice(11)}`).join('；') }}
      </NTag>
    </div>
    <div class="sf-actions">
      <NButton size="small" type="primary" :loading="submitting"
        :disabled="!form.crewId || !slotValid"
        @click="submit">
        {{ record.status === '待重排' ? '重新排班' : '确认派工' }}
      </NButton>
      <small v-if="record.status === '待重排'" class="sf-hint">该缺陷被顶替后保留了原班次 {{ record.shift }} 与 {{ record.evidenceCount }} 份证据</small>
    </div>
  </div>
</template>
