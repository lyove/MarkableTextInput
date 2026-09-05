# SSMLEditor

SSML（Speech Synthesis Markup Language · 语音合成标记语言）标注编辑器，用于将文本内容转换为自然流畅的人声输出。实现为**框架无关的 Vanilla TypeScript**（无 React、无富文本依赖），基于「轻量自研文档模型 + 虚拟光标 + 自绘选区」架构，行为完全可控。

## 快速开始

```bash
npm install
npm run dev         # 启动演示页（编辑器 + 实时 SSML / 纯文本预览）
npm run build       # 类型检查 + 构建产物到 dist/
npm run preview     # 预览构建产物
npm run type-check  # 仅 TypeScript 类型检查
```

演示页入口：`src/App.tsx`。页面上半区为 **SSMLEditor（Vanilla 版，本文档主线）**，工具栏提供 6 类标注的功能开关、
「全显拼音（自动注音）」与只读模式切换，右侧实时输出 SSML / 纯文本并可一键复制；下半区仍挂载一份
`SSML-Editor-React`（旧 React 实现，迁移期间保留对照，API/行为与 Vanilla 版独立）。若已迁移完成，
删除 `src/components/SSML-Editor-React/` 并移除 `src/App.tsx` 中 `ReactEditorSection` 及相关 import 即可。

## 特性

- **6 类标注能力**，覆盖 TTS 前端最常用需求，可通过 `features` 按需开关：
  - **注音（phoneme）**：逐字 `<phoneme ph="...">`，自动注音，多音字候选切换 + 手动输入；feature key 为 `phoneme`，子配置 `features.phoneme.toneFormat`（`symbol` 带声调符号 / `number` 数字声调）控制拼音显示格式，`features.phoneme.showAll` 开启「全显拼音」——无显式注音的汉字也自动生成拼音浮标，点击拼音即可修正多音字读音
  - **停顿（break）**：位置锚点 `<break time="400ms" strength="strong"/>`，时长 6 档（100ms~1s）/ 强度 4 档（弱/中/强/极强），均可省略
  - **韵律（prosody）**：`<prosody rate/pitch/volume>` 三维度——语速、音调各 5 档（极慢/慢/中/快/极快），音量 3 档（轻柔/中等/响亮）
  - **读法（say-as）**：`<say-as interpret-as="date|time|number|digits|telephone|characters">`
  - **重音（emphasis）**：`<emphasis level="reduced|moderate|strong">`（弱读/适中/重读）
  - **提示（hint）**：为任意选区附加提示文本（教学释义、备注等），不进入 SSML 输出
- **内联可视化**：区间标注以配对括号环绕文字并按类型着色——韵律 `[…]`、重音 `{…}`、读法 `(…)`；停顿以段落图标内联插入；提示（hint）以黄色点状下划线标识、悬停出释义气泡；带注音的汉字上方直接显示拼音浮标。hint 下划线绘制在字符 `::after`、拼音浮标在 `::before`，同一汉字上可同时呈现，互不遮蔽
- **回填编辑**：点击括号 / 括号内文字 / 停顿图标 / 提示下划线范围，弹窗自动回填上次参数，支持一键移除
- **标准 SSML 双向转换**：`modelToSSML()` / `ssmlToModel()`，支持 `<p>` / `<s>` 分段、`<break>` 空标签、单字 `<phoneme>` 包裹、嵌套范围标签正确顺序，解析失败自动回退为纯文本
- **字符串友好赋值**：`value` / `setValue()` 同时接受**原始 SSML 字符串**与结构化 `SSMLModel`——90% 的场景可直接 `value: "<speak>...</speak>"` 字符串进、`getSSML()` 字符串出，无需手动构造块与偏移量；`SSMLEditorValue = SSMLModel | string`
- **剪贴板友好**：复制/粘贴保留 SSML 语义，HTML 归一化后仍可正确解析；支持从外部**拖放**文本/HTML 到编辑器，按落点字符计算插入位置
- **冲突协调**：同类型区间标注彼此重叠时弹窗选择「替换」或「拆分共存」；新标注跨越已有同类标注边界时弹出确认框，不静默破坏既有数据
- **大文档性能**：块内容先编译为轻量 VNode 再按键控 diff 物化，配合块级快照缓存，普通输入只重画受影响行；段落超过 2000 时自动切换 `requestIdleCallback` 分块绘制，长文档不阻塞输入
- **完善的编辑体验**：虚拟光标 + 自绘选区，支持中文 IME、输入/删除/选区替换、Enter 分段、双击选词、全选/复制/剪切/拖放粘贴、撤销重做（`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y`）
- 支持只读模式、placeholder、自定义 className/style；样式由入口 `index.ts` 自动 `import`，接入打包器即随产物注入

## 数据模型（SSMLModel）

编辑器内部唯一完整的结构化值载体——纯文本块（blocks）与区间标注（annotations）完全分离的扁平模型，偏移量基于 Unicode code point：

```ts
interface SSMLModel {
  blocks: SSMLBlock[];           // 段落
  annotations: SSMLAnnotation[]; // 标注
  hints?: ModelHint[];            // 提示标注（可选，默认不进入 SSML；modelToSSML(model, { includeHints: true }) 可输出 <hint>）
}

/** 对外赋值时 accepted 的形状：可直接传 SSML 字符串，内部归一化为 SSMLModel */
type SSMLEditorValue = SSMLModel | string;

interface SSMLBlock {
  id: string;
  text: string;                  // 纯文本段落
}

/** 区间标注：[start, end)，code point 偏移。break 为点标注（start === end） */
interface SSMLAnnotation {
  id: string;
  type: 'phoneme' | 'break' | 'prosody' | 'sayAs' | 'emphasis';
  blockId: string;
  start: number;
  end: number;
  attrs: Record<string, string>;
  /** 内部字段：标注被编辑/分段操作拆成多个分片时，用 groupId 关联同源分片；宿主无需传入 */
  groupId?: string;
}

/** 提示标注：附加文本，不参与 SSML 序列化 */
interface ModelHint {
  id: string;
  blockId: string;
  start: number;
  end: number;
  text: string;
  /** 内部字段：同 SSMLAnnotation.groupId */
  groupId?: string;
}
```

### 各标注类型的 `attrs` 字段

| type | attrs | SSML 对应 |
|---|---|---|
| `phoneme` | `{ val: 'zhong', tone: 'zhong2' }` | `<phoneme ph="zhōng">`（逐字，单字符区间；val/tone 为汉语拼音记音） |
| `break` | `{ time?: '100ms'\|'200ms'\|'400ms'\|'500ms'\|'800ms'\|'1s', strength?: 'weak\|medium\|strong\|x-strong' }` | `<break time="400ms" strength="strong"/>`（点标注，start === end；time/strength 均可省略） |
| `prosody` | `{ rate?: 'x-slow'~'x-fast', pitch?: 'x-low'~'x-high', volume?: 'soft\|medium\|loud' }` | `<prosody rate="fast" pitch="high">` |
| `sayAs` | `{ interpretAs: 'date\|time\|number\|digits\|telephone\|characters', format?: 'ymd' }` | `<say-as interpret-as="date" format="ymd">` |
| `emphasis` | `{ level: 'reduced\|moderate\|strong' }` | `<emphasis level="strong">` |

> 编辑器内部对 value 一律按不可变处理：构造 / `setValue` 会归一化（`valueToModel`）并拷贝宿主传入对象，`getValue` / `onChange` 派发的是快照。宿主随意修改自己拿到的值，不会污染编辑器当前内容与撤销/重做历史。

### 三种数据格式与转换矩阵

| 格式 | 类型 | 说明 |
|---|---|---|
| 结构化文档 | `SSMLModel` | blocks + annotations + hints，编辑器内部唯一完整载体 |
| SSML 标签串 | `string` | `<speak>...</speak>`，喂给 TTS 引擎的标准格式 |
| 纯文本 | `string` | 去掉所有标注的可读文案 |

六个方向各有自解释的 `XToY` 转换函数（见下文「序列化 & 工具函数」）：`ssmlToModel` / `modelToSSML` / `valueToModel` / `ssmlToPlain` / `modelToPlain` / `plainToModel`。

## 使用

### 示例

**最简用法（推荐 90% 场景）—— SSML 字符串进、字符串出：**

```ts
import { SSMLEditor, modelToSSML } from './components/SSML-Editor-Vanilla';

const el = document.querySelector('#editor')!;

const editor = new SSMLEditor({
  el,
  value: '<speak><p>语音合成标记语言可以精确控制朗读效果。</p></speak>', // 直接喂 SSML 字符串
  onChange: (next) => console.log(modelToSSML(next)),                       // 拿 SSML 串
  placeholder: '输入文本，选中后右键添加 SSML 标注',
  features: { phoneme: true, break: true, prosody: true, sayAs: true, emphasis: true, hint: true },
});

editor.setValue('<speak><p>新的内容</p></speak>'); // 字符串或 SSMLModel 都行
editor.getSSML();                                   // => "<speak>…</speak>"

editor.destroy();
```

**高级用法 —— 传结构化 `SSMLModel`（程序化批量标注 / 存 hints / 协同编辑）：**

```ts
import { SSMLEditor, plainToModel } from './components/SSML-Editor-Vanilla';

const editor = new SSMLEditor({
  el,
  value: plainToModel('语音合成标记语言可以精确控制朗读效果。'),
  onChange: (next) => save(next), // next: SSMLModel
});

// 运行时更新配置（切换只读 / 功能开关 / phoneme 声调格式、全显拼音等）
editor.setOptions({
  readOnly: true,
  features: { phoneme: { toneFormat: 'number', showAll: true }, break: true },
});

editor.destroy();
```

### 配置项（`SSMLEditorOptions`）

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `el` | `HTMLElement` | 必填 | 挂载容器 |
| `value` | `SSMLEditorValue`（`SSMLModel \| string`） | 必填 | 初始值——传 SSML 字符串会被 `ssmlToModel` 解析；传 `SSMLModel` 直通（内部会拷贝） |
| `onChange` | `(value: SSMLModel) => void` | — | 值变化回调（收到 `SSMLModel` 快照） |
| `readOnly` | `boolean` | `false` | 只读模式 |
| `placeholder` | `string` | — | 空内容占位文本 |
| `className` | `string` | — | 根容器附加类名 |
| `style` | `Partial<CSSStyleDeclaration>` | — | 根容器内联样式 |
| `features` | `AnnotationFeatures` | 全部开启 | 按需禁用标注能力（见下） |

#### `features`（`AnnotationFeatures`）

```ts
interface PhonemeFeature {
  toneFormat?: 'symbol' | 'number';   // 声调显示格式，默认 'symbol'（ā）；'number' 为 a1
  showAll?: boolean;                  // 「全显拼音」：无显式注音的汉字也自动生成拼音浮标（点击可修正）
}

interface AnnotationFeatures {
  phoneme?: boolean | PhonemeFeature;  // 注音：false 关闭（隐藏拼音浮标+不显示右键菜单）；
                                         //  对象形式可额外指定 toneFormat / showAll
  break?: boolean;
  prosody?: boolean;
  sayAs?: boolean;
  emphasis?: boolean;
  hint?: boolean;
}
```

- `phoneme` 走 `boolean` 即开/关（关掉后拼音浮标与右键菜单项都不显示）；传对象可额外配置声调格式与全显拼音，如 `{ toneFormat: 'number', showAll: true }`。
- 其余 5 项均为简单布尔开关，缺省全部 `true`。

### 实例方法

| 方法 | 说明 |
|---|---|
| `setValue(value: SSMLEditorValue)` | 设置受控文档并重渲染——接受 SSML 字符串或 `SSMLModel`（内部归一化并拷贝） |
| `getValue(): SSMLModel` | 获取当前 `SSMLModel` 快照 |
| `getSSML(): string` | 便捷方法：当前文档序列化为 `<speak>…</speak>` SSML 串 |
| `setSSML(xml: string): void` | 便捷方法：用 SSML 串替换文档（等价于 `setValue(xml)`） |
| `setOptions(opts: Partial<SSMLEditorOptions>)` | 运行时更新 `readOnly` / `features` / `placeholder` / `className` |
| `focus()` | 聚焦编辑器隐藏输入宿主 |
| `destroy()` | 销毁：移除 DOM、解绑事件、销毁浮层 |

### 导出

入口 `src/components/SSML-Editor-Vanilla/index.ts`：

```ts
export { SSMLEditor } from './editor';
export type { SSMLEditorOptions } from './editor';
export { resolveFeatures } from './core/features';

// 序列化 / 转换工具（命名遵循 XToY 矩阵）
export { ssmlToModel, modelToSSML, valueToModel, ssmlToPlain };          // utils/ssml.ts
export { plainToModel, createEmptyModel, modelToPlain, isEmptyModel, cloneModel }; // utils/serialize.ts

// 类型
export type {
  SSMLModel, SSMLEditorValue, SSMLBlock, SSMLAnnotation, AnnotationType,
  AnnotationFeatures, PhonemeFeature, ResolvedAnnotationFeatures,
  ToneFormat, ModelHint, Cursor, SelectionSpan,
};
```

## 序列化 & 工具函数

六个方向的转换函数 + 两个辅助函数，命名统一遵循 `XToY`（源 → 目标）约定：

```ts
// utils/ssml.ts
ssmlToModel(xml: string): SSMLModel;       // SSML/HTML 串 → 结构化模型，失败回退纯文本
modelToSSML(model: SSMLModel, options?: { includeHints?: boolean }): string;  // 结构化模型 → 标准 <speak>...</speak> SSML（默认剥离 hint）
valueToModel(value: SSMLEditorValue): SSMLModel; // 入口归一化：string 走 ssmlToModel，SSMLModel 直通；空串给空模型
ssmlToPlain(xml: string): string;          // SSML 串 → 纯文本（= ssmlToModel + modelToPlain）

// utils/serialize.ts
plainToModel(text: string): SSMLModel;     // 纯文本 → 模型（\n 分段）
modelToPlain(model: SSMLModel): string;   // 模型 → 纯文本（段落以 \n 连接，剥离所有标注）
createEmptyModel(): SSMLModel;             // 空模型
isEmptyModel(model: SSMLModel): boolean;   // 是否无可见文本
cloneModel(model: SSMLModel): SSMLModel;   // 深拷贝模型快照（内部用于 get/setValue/onChange 隔离）
```

## 交互说明

**鼠标**

| 操作 | 行为 |
|---|---|
| 拖选 / 双击 | 选中文字（自绘高亮；双击选中连续英文/数字词，中文按单字，并抑制浏览器原生选词，避免先选中相邻字符再回跳的闪烁） |
| 选区内右键 | 菜单：音标 / 停顿 / 韵律 / 读法 / 重音 / 提示（可按 features 裁剪）；跨段选区时需单段的标注项置灰 |
| 光标位置右键（无选区） | 只能插入「停顿」（点标注） |
| 从外部拖入文本 / HTML | 在落点字符处插入（按落点计算光标位置），HTML 经 SSML 归一化解析；只读或浮层打开时忽略 |
| 点击括号 / 括号内文字 / 停顿图标 / 提示下划线范围 | 打开对应浮层，回填上次参数，可修改或移除；同类型重叠时弹出「替换 / 拆分共存」冲突弹窗 |
| 点击注音文字 | 注音编辑浮层（候选 / 手动 / 清除） |
| 悬停括号 / 停顿 / 提示 | 显示标注信息 tooltip；悬停标注时整段字符同步高亮，编辑后仍跟随 |

**键盘**

| 快捷键 | 行为 |
|---|---|
| 直接输入 / IME | 在光标处输入（支持中文输入法），有选区则替换 |
| `Backspace` / `Delete` | 删除光标前/后字符，有选区时删除选区 |
| `Enter` | 在光标处分段 |
| `Cmd/Ctrl + Shift + B` | 在光标处插入「停顿」 |
| 方向键 / `Home` / `End` | 移动虚拟光标（含上下跨段），有选区时收拢为光标 |
| `Cmd/Ctrl + A` | 全选 |
| `Cmd/Ctrl + C` | 复制选区（HTML + 纯文本写入剪贴板） |
| `Cmd/Ctrl + X` | 剪切选区 |
| `Cmd/Ctrl + Z` | 撤销 |
| `Cmd/Ctrl + Shift + Z` / `Cmd/Ctrl + Y` | 重做 |

## 目录结构

```
src/
  main.tsx / main.css / index.html   # Vite 入口（演示页）
  App.tsx                            # 演示页：Vanilla 版编辑器（功能开关/只读/实时预览）+ React 对照版

  components/SSML-Editor-React/      # （旧）React 实现——迁移期对照保留，非主线

  components/SSML-Editor-Vanilla/    # 编辑器本体（框架无关，零交叉引用）
    index.ts                         #   公共入口（顺带 import 样式），导出全部 API
    editor.ts                        #   兼容薄层：re-export core/base
    types/index.ts                   #   类型定义（SSMLModel / annotation / features 等）
    model/
      model.ts                       #   文档模型基础（uid / 块 id / 码点长度 / 光标清理）
      history.ts                     #   快照式撤销/重做栈（合并提交、100 上限）
    core/                            #   行为按 Service 拆分，统一面向 EditorContext 契约
      base.ts                        #   SSMLEditor 类：装配 Service、绑定事件、EventBus 接线、公共 API
      context.ts                     #   EditorContext 契约 + SSMLEditorOptions
      state.ts                       #   集中式 EditorState（model / cursor / spans / overlays / render / flags）
      event-bus.ts                   #   类型化发布订阅（model:change / render:request / cursor:change 等）
      dom.ts                         #   DOM 构建/挂载/全局事件绑定与销毁
      ime.ts                         #   隐藏输入宿主 + beforeinput/IME 合成 + 光标/拖选绘制调度
      keyboard.ts                    #   快捷键/方向键/删除/Enter
      pointer.ts                     #   鼠标/双击/右键菜单/悬停 tooltip 管线
      selection.ts                   #   选区维护与自绘高亮
      clipboard.ts                   #   复制/剪切/粘贴/拖放（SSML 语义 + HTML 归一化）
      actions.ts                     #   标注动作：弹层目标、冲突弹窗、标注确认/移除、回填
      render.ts                      #   渲染调度：块树重建、浮层同步、大文档空闲分块绘制
      features.ts                    #   features 解析（resolveFeatures）
    view/
      vnode.ts                       #   轻量 VNode 类型（char/bracket/break/caret/composing/hint-group）
      block-render.ts                #   块 → VNode 构建、键控 diff、DOM 物化与光标定位引用
      overlays.ts                    #   浮动层纯 DOM 构建（tooltip、重叠/跨边界冲突弹窗）
    components/
      index.ts                      #   barrel：统一 re-export 全部浮层与右键菜单
      base-popover.ts                #   浮层抽象基类 + 共享 PopoverOptions（表面/定位/Esc 关闭/销毁）
      phoneme-popover.ts             #   注音（phoneme）浮层：逐字候选/手动/声调
      break-popover.ts               #   停顿浮层
      prosody-popover.ts             #   韵律浮层
      say-as-popover.ts              #   读法浮层
      emphasis-popover.ts            #   重音浮层
      hint-popover.ts                #   提示浮层
      context-menu.ts                #   右键菜单
    utils/
      annotations.ts                 #   标注增删查 / 重叠拆分（groupId 关联分片）/ 偏移平移
      operations.ts                  #   文本/区块编辑操作（不可变）
      selection.ts                   #   选区工具函数（span 计算/比较/命中）
      serialize.ts                   #   纯文本 ↔ 值、快照克隆
      ssml.ts                        #   SSML ↔ 文档 双向序列化
      pinyin.ts                      #   pinyin-pro 引擎适配器
      tone.ts                        #   声调符号处理
    styles/styles.css                #   全部样式
```

## 技术栈

- 原生 TypeScript（编辑器本体，无 UI 框架依赖）
- [Vite](https://vitejs.dev/) 构建；演示页外壳使用 React（仅 App.tsx 侧）
- [pinyin-pro](https://github.com/zh-lx/pinyin-pro) 拼音引擎（编辑器唯一运行时依赖）

## 设计要点

1. **非 `contenteditable`**：容器本身不可编辑，而是通过隐藏的 `contenteditable` 宿主接收 IME 合成事件，所有渲染完全受控，避免浏览器默认行为的不确定性。
2. **虚拟光标 + 自绘选区**：光标是一个自绘的 DOM 元素，选区高亮为 `.se-sel` 类，不依赖原生 Selection 绘制；原生选区仅在拖选手势期间临时保留，手势结束后立即与虚拟状态对账。
3. **纯数据优先**：所有编辑动作先变更内部 Document，再由 Document 驱动渲染，保证序列化结果与视觉 1:1 一致；对外（构造 / setValue / getValue / onChange）一律快照隔离。
4. **扁平化标注列表**：annotations 与文本块分离，支持任意区间重叠；标注被编辑操作切开时各分片以 `groupId` 关联同源，序列化时通过扫描偏移量正确嵌套标签。
5. **VNode 增量渲染**：块文本先编译为轻量 VNode（char / bracket / break / caret / composing / hint-group），输入后按键控 diff 只物化变化节点，并缓存每块的 vnode→DOM 引用用于 O(1) 光标定位；普通按键/光标移动只重画受影响行。段落超过 2000 时自动切换 `requestIdleCallback` 分块绘制（每块约 400 段、10ms 预算），大文档输入不卡顿。
6. **Service + EventBus**：`SSMLEditor` 类本身只持有集中式 `EditorState`（文档 / 光标 / 选区 / 浮层 / 渲染记账 / 瞬态标志）与 8 个 Service——DOM / IME / 键盘 / 鼠标 / 选区 / 剪贴板 / 动作 / 渲染；Service 之间不直接互调，而是通过类型化 `EventBus`（`model:change` / `render:request` / `cursor:change` / `selection:change` / `overlay:close`）发布状态变化，由 `SSMLEditor` 统一接线，新增行为只需订阅事件。
