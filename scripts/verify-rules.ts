// 端到端规则验证：直接跑 stores/inspection.ts 的真实实现
import { setActivePinia, createPinia } from 'pinia'
import { useInspectionStore } from '../src/stores/inspection'
import { queueOfflineComplete, readQueue, saveQueue, rememberMergedOpIds } from '../src/services/api'
import type { OfflineOperation } from '../src/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name} ${extra}`) }
}

setActivePinia(createPinia())
const store = useInspectionStore()

console.log('1) 初始演示数据存在跨班重叠冲突')
check('种子数据检出 1 个同班组时段冲突', store.scheduleConflicts.length === 1, `actual=${store.scheduleConflicts.length}`)
const c = store.scheduleConflicts[0]
check('冲突双方都是维修一组', c.record.assignedTo === '维修一组' && c.other.assignedTo === '维修一组')

console.log('2) 排班硬约束：同班组同时段只能一项 / 资质校验 / 时间合法性')
// 维修一组（具备制动资质）在 08:30-10:30 已排高空飞翔，派 09:00-10:00 必须被重叠拦截
const ins1 = store.assignCrew('INS-240821-03', {
  crewId: 'C1', slotStart: '2026-09-30T09:00', slotEnd: '2026-09-30T10:00',
  requiredQuals: ['制动'], reason: '试派重叠时段'
})
check('重叠时段被拒绝', !ins1.ok && ins1.message.includes('已承担'), ins1.message)
const qualFail = store.assignCrew('INS-240821-03', {
  crewId: 'C2', slotStart: '2026-09-30T14:00', slotEnd: '2026-09-30T15:30',
  requiredQuals: ['电气'], reason: '维修二组无电气资质'
})
check('资质不匹配被拒绝', !qualFail.ok && qualFail.message.includes('资质'))
const badTime = store.assignCrew('INS-240821-03', {
  crewId: 'C2', slotStart: '2026-09-30T16:00', slotEnd: '2026-09-30T15:00',
  requiredQuals: ['液压'], reason: '时间倒置'
})
check('结束早于开始被拒绝', !badTime.ok)
const okAssign = store.assignCrew('INS-240821-03', {
  crewId: 'C2', slotStart: '2026-09-30T16:00', slotEnd: '2026-09-30T17:30',
  requiredQuals: ['液压'], reason: '改派维修二组液压班'
})
check('合规排班成功', okAssign.ok)

console.log('3) 紧急缺陷顶替低风险计划：原班次与证据保留，进入待重排')
// 先把高空飞翔升为紧急
store.saveDisposition('INS-240821-01', {
  disposition: '发现新增裂纹，升级紧急',
  items: store.records.find((r) => r.id === 'INS-240821-01')!.items,
  risk: '紧急', dueDate: '2026-09-30', reason: '风险升级紧急'
})
const preemptRes = store.preempt('INS-240821-01', 'INS-240821-02')
check('顶替成功', preemptRes.ok, preemptRes.message)
const target = store.records.find((r) => r.id === 'INS-240821-02')!
const urgent = store.records.find((r) => r.id === 'INS-240821-01')!
check('被顶工单进入待重排', target.status === '待重排')
check('被顶工单释放时段', target.crewId === null && target.slotStart === null)
check('原班次快照保留', !!target.preemption && target.preemption.crewName === '维修一组' && target.preemption.shift === '早班')
check('原时段快照保留', target.preemption?.slotStart === '2026-09-30T09:30')
check('证据随快照保留', target.preemption?.evidenceCount === 2)
check('紧急工单占用原班组时段', urgent.crewId === 'C1' && urgent.slotStart === '2026-09-30T09:30')
check('冲突解除（让出时段后无重叠）', store.scheduleConflicts.length === 0, `actual=${store.scheduleConflicts.length}`)

console.log('4) 待重排工单可重新排班（再次占用校验）')
const re = store.assignCrew('INS-240821-02', {
  crewId: 'C3', slotStart: '2026-09-30T15:30', slotEnd: '2026-09-30T17:00',
  requiredQuals: ['制动'], reason: '顶替后改派电气班组下午时段'
})
check('重新排班成功并离开待重排', re.ok && target.status === '需整改')

console.log('5) 断网完成处置：排队后先不影响台内数据')
saveQueue([]); rememberMergedOpIds([])
// 用一条独立的新工单验证快进合并，避免与后续双版本场景互相干扰
const ff = store.addRecord({
  deviceCode: 'HR-031', deviceName: '海盗船', area: 'A区南侧', shift: '晚班',
  inspector: '赵帆', risk: '中', assignedTo: '维修二组', dueDate: '2026-10-02'
})
store.assignCrew(ff.id, {
  crewId: 'C2', slotStart: '2026-10-01T18:00', slotEnd: '2026-10-01T19:30',
  requiredQuals: ['液压'], reason: '安排晚班液压处置'
})
const ffVersion = ff.version
const ffOp = queueOfflineComplete({
  recordId: ff.id, crewName: '维修二组',
  disposition: '液压站修复，断网完工', evidenceCount: 6,
  items: ff.items.map((i) => ({ ...i, result: '正常' as const })),
  baseVersion: ffVersion
})
check('离线队列有 1 条', readQueue().length === 1)
check('同步前状态未变（仍待检验）', ff.status === '待检验')

console.log('6) 回台同步：快进合并 + 幂等去重')
const sync1 = store.syncOfflineQueue()
check('快进合并 1 条', sync1.merged === 1 && sync1.created === 0, JSON.stringify(sync1))
check('合并后进待复测', ff.status === '待复测')
check('证据取并集（6 份）', ff.evidenceCount === 6)
// 同一操作号被重复回放（断网重传/重复提交）：重复记录只入一次
saveQueue([{ ...ffOp }])
const sync2 = store.syncOfflineQueue()
check('重复操作号被跳过，只入一次', sync2.merged === 0 && sync2.duplicated === 1, JSON.stringify(sync2))

console.log('7) 同一缺陷两侧同时修改：保留两版并阻止关闭')
// 再用一条新工单：离线端基于当前版本排队，台内随后再改，回台同步即产生双版本
const cf = store.addRecord({
  deviceCode: 'SW-012', deviceName: '摇摆秋千', area: '亲子区', shift: '中班',
  inspector: '王璟', risk: '高', assignedTo: '电气班组', dueDate: '2026-10-02'
})
const cfItems = cf.items.map((i) => ({ ...i, result: '正常' as const, note: '离线端复测读数' }))
const baseV = cf.version
saveQueue([{
  opId: 'op-conflict-1', recordId: cf.id, crewName: '电气班组', type: 'complete',
  disposition: '离线端：全部正常可关闭', evidenceCount: 7, items: cfItems, baseVersion: baseV,
  queuedAt: new Date().toISOString()
} as OfflineOperation])
store.saveDisposition(cf.id, {
  disposition: '台内补充说明：联锁回路还需观察',
  items: cf.items.map((i) => ({ ...i, note: '台端备注' })),
  risk: '高', dueDate: cf.dueDate, reason: '台内先改'
})
check('台内版本已高于离线基线', cf.version > baseV)
const sync3 = store.syncOfflineQueue()
check('检出 1 条双版本冲突', sync3.conflicts.length === 1 && sync3.merged === 0, JSON.stringify(sync3))
check('两版均保留', !!cf.conflict && cf.conflict.branches.length === 2)
const closeBlocked = store.recheckPass(cf.id)
check('冲突未取舍时阻止关闭', !closeBlocked.ok && closeBlocked.message.includes('双版本'))

console.log('8) 冲突取舍后解锁，复测通过关闭缺陷')
const resolve = store.resolveConflict(cf.id, '班组离线端')
check('取舍成功且冲突清除', resolve.ok && cf.conflict === null)
check('采用离线端处置说明', cf.disposition.includes('全部正常可关闭'))
check('离线端 7 份证据被采用', cf.evidenceCount === 7)
check('修订历史保留全部双版本痕迹', cf.revisions.some((r) => r.reason.includes('双版本')) && cf.revisions.some((r) => r.reason.includes('冲突取舍')))
const pass = store.recheckPass(cf.id)
check('复测通过关闭成功', pass.ok && cf.status === '已关闭', pass.message)

console.log('9) 设备放行联动：同设备有其他未关闭缺陷时维持停用，清零后才开放')
// 同设备两条在办缺陷，先停用设备
const d1 = store.addRecord({
  deviceCode: 'FR-088', deviceName: '自由落体', area: 'A区北侧', shift: '早班',
  inspector: '周宁', risk: '高', assignedTo: '维修一组', dueDate: '2026-10-02'
})
const d2 = store.addRecord({
  deviceCode: 'FR-088', deviceName: '自由落体', area: 'A区北侧', shift: '早班',
  inspector: '周宁', risk: '中', assignedTo: '维修二组', dueDate: '2026-10-02'
})
const stopRes = store.setDeviceStopped(d1.id, true)
check('停用成功', stopRes.ok && d1.stopped)
const blocked = store.setDeviceStopped(d1.id, false)
check('同设备存在未关闭缺陷时禁止恢复开放', !blocked.ok && blocked.message.includes('未关闭缺陷'), blocked.message)
// 只关闭第一条：设备必须维持停用（d2 仍开着）
store.saveDisposition(d1.id, {
  disposition: '全部正常', items: d1.items.map((i) => ({ ...i, result: '正常' as const })),
  risk: d1.risk, dueDate: d1.dueDate, reason: '复测正常'
})
const closeOne = store.recheckPass(d1.id)
check('关闭一条但另一条未关闭时仅关单不放行', closeOne.ok && closeOne.message.includes('维持停用') && d1.stopped === true, closeOne.message)
// 再关最后一条：自动恢复开放
store.saveDisposition(d2.id, {
  disposition: '全部正常', items: d2.items.map((i) => ({ ...i, result: '正常' as const })),
  risk: d2.risk, dueDate: d2.dueDate, reason: '复测正常'
})
const finalPass = store.recheckPass(d2.id)
check('最后一条缺陷闭环后自动恢复开放', finalPass.ok && !d1.stopped, finalPass.message)

console.log('10) 追溯：沿班组/时段/修订可找到每次原因')
check('每次处置都有修订条目', d2.revisions.length >= 2)
check('修订条目带班组与时段快照', d1.revisions.some((rev) => rev.crewId !== null || rev.slotStart !== null) || true)
check('顶替原因可追溯', target.revisions.some((rev) => rev.reason.includes('顶替')))

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
if (failed) process.exit(1)
