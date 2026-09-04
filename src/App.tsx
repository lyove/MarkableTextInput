/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SSMLEditor,
  modelToPlain,
  modelToSSML,
  valueToModel,
  ssmlToPlain,
} from "./components/SSML-Editor-Vanilla";
import type { AnnotationFeatures, SSMLEditorValue } from "./components/SSML-Editor-Vanilla";

import { SSMLEditor as ReactSSMLEditor } from "./components/SSML-Editor-React";
import type { SSMLEditorRef } from "./components/SSML-Editor-React";

const SSML_SAMPLE =
  '<speak><p><say-as interpret-as="characters">语音合成标记语言</say-as>（SSML）能<hint text="关键词：语速放慢、咬字清晰"><prosody rate="fast" pitch="medium" volume="medium">精确控制</prosody></hint>停顿、语速和发音。<break time="500ms"/>客服热线 <say-as interpret-as="telephone">4008-123-456</say-as>，<break time="200ms"/><say-as interpret-as="date">2026年9月1日</say-as>正式上线，<break time="300ms"/>广泛应用于<prosody rate="slow" pitch="high" volume="loud"><hint text="重音强调，语气上扬"><emphasis level="strong">智能客服</emphasis></hint>、<emphasis level="moderate">有声读物</emphasis>、<emphasis level="reduced">导航播报</emphasis></prosody>等场景。<break time="400ms"/><phoneme ph="chong2">重</phoneme>庆人喜欢音<phoneme ph="yue4">乐</phoneme>：<phoneme ph="zhong4">重</phoneme>读时，&quot;重&quot;读 zhòng，也可读 chóng。</p></speak>';

const FEATURE_KEYS: Array<keyof Required<AnnotationFeatures>> = [
  "phoneme",
  "break",
  "prosody",
  "emphasis",
  "sayAs",
  "hint",
];

const FEATURE_LABELS: Record<keyof Required<AnnotationFeatures>, string> = {
  phoneme: "音标",
  break: "停顿",
  prosody: "韵律",
  emphasis: "重音",
  sayAs: "读法",
  hint: "提示",
};

/**
 * Copy text to the clipboard.
 */
interface LegacyDocument extends Document {
  execCommand(commandId: string, showUI?: boolean, value?: string): boolean;
}

async function copyTextToClipboard(
  text: string,
  done: () => void,
  resetAll: Array<(v: boolean) => void>,
): Promise<void> {
  const finish = () => {
    done();
    setTimeout(() => resetAll.forEach((r) => r(false)), 1600);
  };
  try {
    await navigator.clipboard.writeText(text);
    finish();
    return;
  } catch {
    // Async Clipboard API unavailable — fall back to the legacy path below.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    (document as LegacyDocument).execCommand("copy");
  } finally {
    ta.remove();
  }
  finish();
}

// ---------------------------------------------------------------------------
// Vanilla Demo
// ---------------------------------------------------------------------------
function VanillaEditorSection() {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SSMLEditor | null>(null);

  const [value, setValue] = useState<SSMLEditorValue>(SSML_SAMPLE);
  const [readOnly, setReadOnly] = useState(false);
  const [showAllPinyin, setShowAllPinyin] = useState(false);
  const [features, setFeatures] = useState<Record<keyof Required<AnnotationFeatures>, boolean>>({
    phoneme: true,
    break: true,
    prosody: true,
    emphasis: true,
    sayAs: true,
    hint: true,
  });

  const featureConfig = useMemo<AnnotationFeatures>(
    () => ({
      ...features,
      phoneme: features.phoneme ? { showAll: showAllPinyin } : false,
    }),
    [features, showAllPinyin],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }

    // Init
    const editor = new SSMLEditor({
      el,
      value,
      onChange: setValue,
      placeholder: "请输入语音合成文本…",
      features: featureConfig,
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    editorRef.current?.setOptions({ features: featureConfig });
  }, [featureConfig]);

  useEffect(() => {
    editorRef.current?.setOptions({ readOnly });
  }, [readOnly]);

  const toggleFeature = (k: keyof Required<AnnotationFeatures>) =>
    setFeatures((p) => ({ ...p, [k]: !p[k] }));

  const ssml = useMemo(() => modelToSSML(valueToModel(value)), [value]);
  const plain = useMemo(
    () => (typeof value === "string" ? ssmlToPlain(value) : modelToPlain(value)),
    [value],
  );

  const [ssmlCopied, setSsmlCopied] = useState(false);
  const [plainCopied, setPlainCopied] = useState(false);

  const handleSsmlCopy = () =>
    copyTextToClipboard(ssml, () => setSsmlCopied(true), [setSsmlCopied, setPlainCopied]);

  const handlePlainCopy = () =>
    copyTextToClipboard(plain || "", () => setPlainCopied(true), [setSsmlCopied, setPlainCopied]);

  return (
    <section className="app-section">
      <div className="app-section-head">
        <h2 className="app-section-title">SSMLEditor</h2>
        <span className="app-section-desc">
          SSML 标注编辑器 · 选中文字右键添加拼音 / 停顿 / 韵律 / 重音 / 读法
        </span>
      </div>
      <div className="app-card app-card-row">
        <div className="app-pane">
          <div
            className="app-feature-toggles"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              padding: "8px 12px",
              fontSize: 12,
              color: "#475569",
            }}
          >
            <span style={{ fontWeight: 600, color: "#1e293b" }}>可用标注：</span>
            {FEATURE_KEYS.map((k) => (
              <label
                key={k}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={features[k]} onChange={() => toggleFeature(k)} />
                <span>{FEATURE_LABELS[k]}</span>
              </label>
            ))}
            <span style={{ fontWeight: 600, color: "#1e293b" }}>模式：</span>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showAllPinyin}
                disabled={!features.phoneme}
                onChange={(e) => setShowAllPinyin(e.target.checked)}
              />
              <span>全显拼音（自动注音，点击拼音可修改读音）</span>
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              <span>只读（可选文字，无光标，右键为系统菜单）</span>
            </label>
          </div>
          {/* Editor  */}
          <div id="vanilla-editor" ref={hostRef}></div>
        </div>
        <div className="app-pane app-pane-output">
          <div className="app-pane-head">
            <span className="app-pane-title">SSML</span>
            <button type="button" className="app-btn" onClick={handleSsmlCopy}>
              {ssmlCopied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="app-json">{ssml}</pre>
          <div className="app-pane-head">
            <span className="app-pane-title">Plain text</span>
            <button type="button" className="app-btn" onClick={handlePlainCopy}>
              {plainCopied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="app-json">{plain || "empty"}</pre>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// React wrapper demo
// ---------------------------------------------------------------------------

function ReactEditorSection() {
  const editorRef = useRef<SSMLEditorRef>(null);

  const [value, setValue] = useState<SSMLEditorValue>(SSML_SAMPLE);
  const [readOnly, setReadOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [features, setFeatures] = useState<Record<keyof Required<AnnotationFeatures>, boolean>>({
    phoneme: true,
    break: true,
    prosody: true,
    emphasis: true,
    sayAs: true,
    hint: true,
  });

  const featureConfig = useMemo<AnnotationFeatures>(
    () => ({ ...features, phoneme: features.phoneme ? { showAll } : false }),
    [features, showAll],
  );

  const toggleFeature = (k: keyof Required<AnnotationFeatures>) =>
    setFeatures((p) => ({ ...p, [k]: !p[k] }));

  const ssml = useMemo(() => modelToSSML(valueToModel(value)), [value]);
  const plain = useMemo(
    () => (typeof value === "string" ? ssmlToPlain(value) : modelToPlain(value)),
    [value],
  );

  const [ssmlCopied, setSsmlCopied] = useState(false);
  const [plainCopied, setPlainCopied] = useState(false);

  const handleSsmlCopy = () =>
    copyTextToClipboard(ssml, () => setSsmlCopied(true), [setSsmlCopied, setPlainCopied]);
  const handlePlainCopy = () =>
    copyTextToClipboard(plain || "", () => setPlainCopied(true), [setSsmlCopied, setPlainCopied]);

  return (
    <section className="app-section">
      <div className="app-section-head">
        <h2 className="app-section-title">SSMLEditor（React 封装）</h2>
        <span className="app-section-desc">
          基于 Vanilla 内核的 React 受控组件 · value 支持 SSML 串或 SSMLModel · onChange 给
          SSMLModel 快照
        </span>
      </div>
      <div className="app-card app-card-row">
        <div className="app-pane">
          <div
            className="app-feature-toggles"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              padding: "8px 12px",
              fontSize: 12,
              color: "#475569",
            }}
          >
            <span style={{ fontWeight: 600, color: "#1e293b" }}>可用标注：</span>
            {FEATURE_KEYS.map((k) => (
              <label
                key={k}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={features[k]} onChange={() => toggleFeature(k)} />
                <span>{FEATURE_LABELS[k]}</span>
              </label>
            ))}
            <span style={{ fontWeight: 600, color: "#1e293b" }}>模式：</span>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              <span>只读</span>
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showAll}
                disabled={!features.phoneme}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              <span>全显拼音（自动注音，点击拼音可修改读音）</span>
            </label>
          </div>
          <ReactSSMLEditor
            ref={editorRef}
            value={value}
            onChange={setValue}
            features={featureConfig}
            readOnly={readOnly}
            placeholder="请输入语音合成文本…"
          />
        </div>
        <div className="app-pane app-pane-output">
          <div className="app-pane-head">
            <span className="app-pane-title">SSML</span>
            <button type="button" className="app-btn" onClick={handleSsmlCopy}>
              {ssmlCopied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="app-json">{ssml}</pre>
          <div className="app-pane-head">
            <span className="app-pane-title">Plain text</span>
            <button type="button" className="app-btn" onClick={handlePlainCopy}>
              {plainCopied ? "已复制 ✓" : "复制"}
            </button>
          </div>
          <pre className="app-json">{plain || "empty"}</pre>
        </div>
      </div>
    </section>
  );
}

// ===========================================================================
// App render
// ===========================================================================
export default function App() {
  return (
    <div className="app">
      <VanillaEditorSection />
      {/* <ReactEditorSection /> */}
      <div className="app-foot">
        SSML-Editor · phoneme / break / prosody / emphasis / say-as / hint annotation ·
        multi-instance safe · Cmd/Ctrl+Z to undo
      </div>
    </div>
  );
}
