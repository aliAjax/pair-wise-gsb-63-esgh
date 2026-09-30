# 游乐设施日常检验与缺陷闭环平台

基于Vue3、Naive UI、Pinia、Vue Router、TanStack Query、Axios、WebSocket和Vite的独立前端工程。数据默认保存在localStorage，无需后端即可演示。

## 功能

- 检验任务列表、关键词和状态/区域筛选、统计概览。
- 新建检验任务，逐项录入磨损、异响、制动、锁止和安全装置结果。
- 缺陷处置泳道、风险排序、责任人调整和资源冲突提示。
- **排班联动**：每条缺陷安排班组、跨班时段（精确到分钟）和资质要求；同一班组同一时段只能接一项，资质不符直接拒绝，看板顶部给出班组占用日历与重叠预警。
- **紧急顶替**：紧急缺陷可顶替低风险计划，被顶替工单保留原班次、时段、资质和证据快照并进入「待重排」，支持重新排班。
- **断网作业与回台同步**：班组断网期间离线登记新缺陷/完成处置，回台按操作号幂等合并，重复记录只入一次；同一缺陷两侧同时修改时保留双版本、锁定关闭，人工取舍后才能闭环。
- **设备放行联动**：设备仍有未关闭缺陷时不能恢复开放；复测通过关闭缺陷，同设备缺陷全部清零后才恢复开放。
- **修订追溯**：每次处置保存为修订版本，记录班组、班次时段、原因、操作人与证据；审计页可沿班组、班次和关键词回溯每次原因。
- JSON记录导出、版本号和完整操作时间线。

## 规则自检

```bash
./node_modules/.bin/esbuild scripts/verify-rules.ts --bundle --platform=node --format=esm \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" \
  --define:import.meta.env.VITE_API_BASE_URL=undefined \
  --define:import.meta.env.VITE_WS_URL=undefined \
  --outfile=/tmp/verify.mjs
node --input-type=module -e "globalThis.localStorage={_m:new Map(),getItem(k){return this._m.get(k)??null},setItem(k,v){this._m.set(k,String(v))},removeItem(k){this._m.delete(k)},clear(){this._m.clear()}}; import('/tmp/verify.mjs')"
```


## 启动

```bash
npm install
npm run dev
```

访问`http://localhost:18463`。

## 构建

```bash
npm run build
```
