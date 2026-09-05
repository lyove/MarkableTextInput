# SSML-Editor-Vanilla 深度审查报告

审查对象：`src/components/SSML-Editor-Vanilla`（约 10080 行：TS ≈9000 行 + CSS ≈1051 行）
审查方式：逐文件阅读 core / view / model / utils / components 全量代码、对照 README 声明、运行类型检查与测试、核对 git 历史。


---

## 一、先给结论

代码质量整体**中上**：单一不可变模型 + 事件总线 + 8 个服务分层、字符级 VNode 视图、Round-trip 序列化、特性开关、只读态、大文档分块绘制……这些设计在同类自研富文本组件里相当扎实，不是劣质代码。

但它存在 3 类结构性问题：

1. **"防御性/补丁式"过度修复**留下了大量永远不会走的代码路径（debug Proxy、冗余缓存字段、双路径 IME、多套相似 popover）；
2. **渲染模型以"每字符一个 DOM span"为代价换可标注性**，且 keyed diff 实际上没有做到增量，内容变更即整块 `replaceChildren`，性能上限被卡死；
3. **离"能用真实 TTS 引擎消费的 SSML 编辑器"还差一层 schema 校验与厂商标签能力**，这是它相比 Speech Studio 等业界产品最主要的差距。

---

## 二、功能与正确性核对

### 2.1 已确证的 BUG / 不一致

| # | 严重度 | 问题 | 证据 |
|---|--------|------|------|
| 1 | **P0** | hint 的**文档声明与实现矛盾**：README/类型注释声称 "提示不进入 SSML 输出"，但 `modelToSSML` 实际把 hint 序列化为自定义 `<hint text="...">` 标签并 round-trip 解析 | `README.md:28,47,70` 声称"不进入 SSML"；`utils/ssml.ts:60-62` 定义 hint 开闭标签、`:206-225` 显式输出、`:365-369` 解析 |
| 2 | **P1** | 后果：`getSSML()/modelToSSML` 的结果若直接喂给真实 TTS（demo 的 SSML 面板即如此），多数引擎（Polly/Azure/开源引擎）遇到未知 `<hint>` 标签会**解析报错或静默忽略**，用户标注内容丢失且无提示。缺少"纯标准输出"开关 | 承接 #2；`core/base.ts:212-214 getSSML()` |
| 3 | **P1** | 测试基建名存实亡：`npm test` 0 用例且退出码 1；`test:e2e` 引用不存在的 `verify-fix.mjs`（README 声称有 e2e 验证） | 实测输出；`package.json scripts.test / scripts.test:e2e` |
| 4 | **P2** | undo/redo 粒度不统一：连续打字合并到一处（ime.ts:130 merge=true），但用户敲了一段字想撤销到"更早的语义步骤"没有层级；跨块编辑撤销粒度缺乏可预期性 | `core/ime.ts:130-132`；`core/keyboard.ts:63-73` |
| 5 | **P2** | 大文档分段绘制（`requestIdleCallback`，>2000 段）会造成**首刷后段落逐批出现**的视觉跳变，且没有对滚动区域做同步策略说明；属设计隐患而非现成 bug | `core/render.ts:32,39-40` |
| 6 | **P2** | React 残留（`SSML-Editor-React/index.tsx` + `ReactEditorSection`）与 Vanilla 主实现并存的过渡状态没有收敛：Vite 下 React wrapper 依赖 Vanilla，却保留了整份独立代码历史，且主入口 demo 引用被注释，属"删一半留一半" | `src/App.tsx:245` 之后整段未使用；type-check 报错即由此来 |

### 2.2 抽查后确认 OK 的（避免误伤）

- SSML↔Model↔文本三者 round-trip（`phoneme` 的 alias/tone 往返、`break` 的插入位置、实体转义）逻辑自洽，`plainToModel → modelToSSML → ssmlToModel` 幂等性基本成立。
- IME 三来源（compositionend / beforeinput / input-fallback）共用 `commitTextInsert` 单一入口，配合 `isComposing / insertCompositionText` 过滤，重复插入风险控制到位（虽然代价是代码复杂）。
- 拖拽选区在 mouseup 时的边界吸附（对全角/中日韩字符按 35% 命中区翻转）实现细腻。
- 只读模式下彻底切断 IME 宿主与光标渲染，行为干净。
- 特性开关 `features` 会影响菜单/渲染/括号语义，联动一致。

---

## 三、代码臃肿与"过度修复"痕迹

### 3.1 死代码：State debug Proxy（约 100 行）

`core/state.ts:144-250` 维护了 `createEditorState(model, debug)` + `wrapGroup` Proxy 写追踪器 + 大段注释。实际调用只有一处 `core/base.ts:99`，且**从不传 `debug=true`**，全仓库没有任何出口能打开它。这是典型的"写着写着没用上"的死代码，建议直接删或通过 build-time 宏/`setOptions` 的 devtools 钩子再考虑。

### 3.2 渲染簿记字段（16 个 painted* 字段）与真实实现不匹配

`RenderState`（`core/state.ts:72-91`）维护 `paintedEls / paintedText / paintedAnn / paintedHints / paintedModel / paintedAnnList / paintedHintList / paintedVNodes / paintedDomRefs / lastSelSpans / paintedCaretEl ...` 十余个增量缓存，渲染脏检查也要比较 8 样东西（`core/render.ts:268-339`）。但真正的 VNode diff 快速路径要求**key 序列完全一致才增量 patch**，否则直接 `parent.replaceChildren(...materializeVNodes(next))`（`view/vnode.ts:547-565`）。

> 也就是说：投入了大量字段做"增量"设计，但**每一次真实输入都会让块内 VNode 序列长度变化 → 全量重建该行**。README 声称"按键控 diff 只物化变化节点"，实际只有"光标/选区变化不动内容"时才走增量（靠 `ime.ts:186 tryMoveCaretInDom` 直接把 `.se-caret` DOM 挪位置，根本没经过这些 painted* 缓存）。这套簿记明显是历史迭代留下的过度修复，真实收益被全量 replace 抵消。

### 3.3 层层防御的"组合爆炸"

- **事件绑定样板**：`core/base.ts:51-77` 手工预绑定 28 个 `boundXxx` 箭头字段（每个都要与 DomService 里 attach/detach 的 add/removeEventListener 成对维护），一旦漏一个就是泄漏，是纯样板。
- **全局监听 × 实例数**：document 级 `mousedown/copy/cut/selectionchange` capture、window 级 `mousemove/mouseup/scroll/resize/blur` capture 都按编辑器实例各注册一份。页面同时挂 2 个编辑器 = 双份全局 capture handler；mousemove/scroll 在 capture 阶段全部回调到每个实例。正确性 OK，但纯线性浪费。
- **模块级 clipboard 缓冲**：`ClipboardService` 里维护文档级 docClipboard 快照、双路径（handleInput fallback + inputHost 清空技巧 + `setTimeout`/标志位防抖），为兼容 Safari/WebKit 输入事件差异叠了 4-5 层保险，注释里也能看到"WebKit 不发 input"等补丁说明。
- **可选 hints 字段引发的空值样板**：`hints?: ModelHint[]` 可选，导致**整个模型层**到处 `(hints.length ? { hints } : {})`、`?? []`、`(hints ?? null)`、`model.hints ?? []` 两套形状，`utils/operations.ts` 中每个操作函数都在重复这个三行模式。若把 hints 改成恒为数组（空数组即可），可消灭几十处分支并简化渲染对比。

### 3.4 重复的 UI 基础设施

浮层家族（phoneme / break / prosody / say-as / emphasis / hint popover + context-menu + 冲突弹窗 + tooltip）各自独立实现：定位、遮罩、Esc/外点关闭、按钮栏样式等高度相似（子代理核对后确认多份相近实现）。`view/overlays.ts` 里的重叠冲突弹窗 / 跨边界提示 / 括号 tooltip / hoveredHint 等渲染对象也彼此相近。建议提取 `BasePopover` + 通用 positioner（含 viewport 翻转）。

### 3.5 样式层

约 1051 行 CSS：存在可合并的重复选择器；硬编码颜色/尺寸散落多处（同类颜色值重复多次，未走 CSS 变量）；字号/间距魔法数字较多。好在所有类名都有 `se-` 前缀，隔离策略是对的。

---

## 四、性能清单（按影响排序）

### P0 – 内容编辑 = 整行 DOM 重建
`view/vnode.ts:547-565`：只要 key 序列不完全一致就 `replaceChildren` 全新建。输入一个字符会让当前行全部字符 span 销毁重建。单行 50 字符感知不强，但**单行 500-1000 字（SSML 长段常见）时逐字键入会有可感知卡顿**。可改为 keyed 最小移动（同 key 保活 + insert/remove 少量节点）。

### P1 – 每字符一个 span 的内存模型
char VNode → 每个字符一个 `span.se-ch`（含多个 `data-*`、可含 `::before/::after` 拼音与下划线、可再包 `.se-py-line`）。1 万字符 ≈ 1 万+ DOM 节点。这是能精确到字的标注 / 选中 / 拼音浮标能力的前提，业界类似的"每字 span"实现也这样，但**建议面向 5k-50k 字档做虚拟化或 Canvas/装饰层方案储备**，并把"大文档"作为一等性能用例写进基准。

### P1 – render() 无条件重建浮动层
`core/render.ts:135,141`：每次 render（哪怕只是清一次脏标记）都无条件 `syncPopovers()` + `renderFloating()`，浮动层即便为空也会清空/重灌一次子节点。应把浮层渲染收敛为"仅当 overlay 状态变化时才执行"。

### P1 – 全局 scroll/mousemove capture 中的布局压力
window capture 阶段监听 scroll/mousemove，`boundScroll → positionInputHostToCursor()` 做 `getBoundingClientRect` + 样式写入（`core/base.ts:145`）。建议：滚动定位只在"输入宿主真正挂起/光标存在"时才计算 + `requestAnimationFrame` 节流 + `passive:true`。

### P2 – 每个块每次渲染重复做区间派生
块级渲染对每块构建 `breakAt`/`bracketsAt`/`phonemeAt` 查找结构（O(块标注数)），加上对 hints 的排序，随文档变化反复重建；多块同文标注时本可按文档级一次扫描派发。`snapDragBoundary` 在每次 mouseup 用 `querySelector([data-block-id=...][data-char-idx=...])` + `getBoundingClientRect` 反查 DOM 强制布局。

### P2 – 拼音逐字符转换
全显拼音走 `Array.from(block.text)` 逐字 `defaultPinyinFormats(char)`（`utils/pinyin.ts`），等于每字符一次 `pinyin-pro` 单字调用。已有字符缓存，但首次渲染大文档仍是数千次独立调用；应改为**按块一次 `pinyin(text,{type:'array',multiple:true})` 批处理**后建表。

### P2 – normalize 区间算法退化风险
`normalizeRangeNesting` 使用 while + 双层 for 的重复拆分循环并带 `<1000` 逃生上限，最坏接近 O(n³)。重叠标注很多（>1000）时直接放弃收敛。区间拆分建议改为 sweep-line/栈式一次扫描。

---

## 五、架构评价与改进建议

### 做得好的地方（不要推倒重来）

1. **模型即事实源**：`SSMLModel{blocks,annotations,hints}` 不可变更新 + History 统一入口；setValue 全量替换也走同一条 render 管线。这一点比大多数组件干净。
2. **事件总线**把 8 个服务解耦；bus 上的 `render:request/cursor:change/selection:change/overlay:close` 契约稳定。
3. **关注点拆分正确**：数据算法（operations/annotations/ssml）与 DOM/交互（dom/ime/pointer/render）物理分离，算法层几乎可无 DOM 单测。
4. 序列化三向转换是真正可交付的资产。

### 结构性建议

| 方向 | 具体动作 | 收益 |
|------|----------|------|
| 删除死代码 | 去掉 `state.ts` debug Proxy 整段； | tsc 转绿，行数 −300+ |
| 简化渲染簿记 | RenderState 收敛为「模型引用 + 每块文本 hash + 每块标注指纹 + 脏块 Set」约 4-6 字段，替换 16 字段；放弃"缓存与实际全量重建并存"的两套逻辑 | 可读性 + 内存显著 |
| 消灭空值样板 | `hints` 改为恒数组（`blocks/annotations/hints` 三字段全必填） | 删除几十处 `?? []/可选分支` |
| 统一浮层底座 | 提取 `BasePopover + positioner`（viewport 翻转、Esc/外点关闭、焦点陷阱统一实现） | 消重 6 个 popover 公共逻辑 |
| 事件收敛 | 用「每文档一次的全局委托 dispatcher + 实例注册表」替代 per-instance 全量 capture；destroy 通过注册表统一解绑 | 多实例内存/CPU 下降 |
| 纯标准输出开关 | `modelToSSML(model,{includeExtensions:false})` + `getSSML({strict:true})`；默认剥离 hint | 与 README 一致 + TTS 可消费 |
| 补测试 | 至少覆盖：ssml/operations/annotations 纯函数 round-trip + normalize 压力（含 1000+ 重叠逃生）、IME 三来源幂等、history 合并粒度 | 守住核心资产 |
| 引入 schema 校验层 | 对每个标签做属性范围/枚举/合法嵌套校验（见业界差距） | 产品级差异 |

---

## 六、与业界 SSML 编辑方案对标

业界有代表性的 SSML 编辑形态：微软 Azure Speech Studio（TTS 沙盒可视化编辑器 + XML 源码双模式）、AWS Polly 控制台（源码 + 语音预览）、ReadSpeaker / 各 TTS 厂商 web console、以及基于 ProseMirror/CKEditor 定制的富文本标注实现。对比结论：

| 维度 | 本项目现状 | 业界常见做法 | 差距 |
|------|-----------|-------------|------|
| 合法性校验 | 无 schema/XSD 校验：prosody 值域、say-as 枚举、break strength、可嵌入嵌套是否合法全靠"弹窗人工确认" | 源码模式对接 XSD/schema，属性与嵌套即时报错 | **高**：目前产出的 SSML 不保证引擎可解析 |
| 双模式编辑 | 仅可视化 | Speech Studio 等提供"可视化 ↔ XML 源码"双向同步 | **高**：无源码逃生通道，出问题难排 |
| 可访问性 | contenteditable 无 aria-label，焦点/朗读适配弱（逐项核对确认） | 编辑器一般按可访问规范做 | 中 |
| 大文档 | 字符级 span + 全量行替换，数万字符吃力 | 长文本转词法级编辑 + 虚拟化 | 高（性能模型瓶颈）|

### 本项目相对业界做得更好的点（写报告求客观）

- **真正的结构化 round-trip**：普通输入 → 结构化模型 → 标准 SSML 字符串，往返无损，比多数厂商"只在源码文本上正则高亮"的编辑器高一个层次；
- **零框架依赖、IIFE/UMD 可 script 引入**，与宿主集成成本极低；
- IME 中文输入、跨段选择、重叠冲突的交互深度，在开源同类里少见。

---

## 七、建议的行动优先级

1. **统一 hint 语义**：`modelToSSML/getSSML` 增加 strict 参数，默认剥离 hint，README/类型注释同步改正。
2. **砍死代码 + 收敛渲染簿记**：删 debug Proxy；把 RenderState 从 16 字段收敛到可维护状态；修 `renderFloating/syncPopovers` 仅在变化时触发。
3. **keyed diff 最小移动**：同 key 保活做插入/删除点位移，而不是 `replaceChildren`；这是大行输入不卡的关键。
4. **批量拼音 + 块级派生缓存**：pinyin-pro 按块批处理、建表，替换逐字调用。
5. **后续架构项**：事件全局委托、schema 校验层（对照目标 TTS 引擎文档做标签白名单/值域）、可访问性补齐。

---

## 附：验证复现方式

```bash
npm run type-check   # → error TS6133 App.tsx:245（已复现）
npm run dev          # 手动核验：添加 hint 后观察右侧 SSML 面板出现 <hint> 标签
```
