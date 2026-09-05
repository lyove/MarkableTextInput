/**
 * SSMLEditor — React wrapper around the framework-agnostic vanilla `SSMLEditor`.
 * No editor logic is reimplemented here; the vanilla class is instantiated and
 * driven as a controlled component. Vanilla styles are injected via import.
 *
 *   <SSMLEditor
 *     value="<speak><p>hello</p></speak>"   // SSML string or SSMLModel
 *     onChange={(model) => save(model)}
 *     onSSMLChange={(ssml) => save(ssml)}   // optional: SSML string directly
 *     features={{ phoneme: true, break: true, prosody: true }}
 *   />
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { SSMLEditor as VanillaSSMLEditor, modelToSSML, valueToModel } from "../SSML-Editor-Vanilla";
import type { AnnotationFeatures, SSMLModel, SSMLEditorValue } from "../SSML-Editor-Vanilla";

export {
  ssmlToModel,
  modelToSSML,
  valueToModel,
  ssmlToPlain,
  plainToModel,
  modelToPlain,
  createEmptyModel,
  isEmptyModel,
  cloneModel,
  resolveFeatures,
} from "../SSML-Editor-Vanilla";
export type {
  SSMLModel,
  SSMLEditorValue,
  SSMLBlock,
  SSMLAnnotation,
  AnnotationType,
  AnnotationFeatures,
  ToneFormat,
  ModelHint,
  Cursor,
  SelectionSpan,
} from "../SSML-Editor-Vanilla";

export interface SSMLEditorProps {
  /** Controlled value: an SSML string or a structured SSMLModel (normalized internally). */
  value: SSMLEditorValue;
  /** Fired with an SSMLModel snapshot whenever the content changes. */
  onChange?: (value: SSMLModel) => void;
  /** Convenience callback fired with the SSML serialization of the new content. */
  onSSMLChange?: (ssml: string) => void;
  /** Read-only mode, default false. */
  readOnly?: boolean;
  /** Placeholder shown when the editor is empty. */
  placeholder?: string;
  /** Class name applied to the host div. */
  className?: string;
  /** Inline style applied to the host div. */
  style?: CSSProperties;
  /**
   * Per-annotation-type toggles (default all on). `phoneme` may be an object
   * carrying `toneFormat` and `showAll` (auto pinyin ruby for every Han char).
   */
  features?: AnnotationFeatures;
}

/** Imperative handle exposed via ref. */
export interface SSMLEditorRef {
  /** Current SSMLModel snapshot. */
  getValue: () => SSMLModel;
  /** Current content serialized as an SSML string. */
  getSSML: () => string;
  /** Replace content (SSML string or SSMLModel). */
  setValue: (value: SSMLEditorValue) => void;
  /** Replace content with an SSML string. */
  setSSML: (xml: string) => void;
  /** Focus the editor. */
  focus: () => void;
  /** Escape hatch: the underlying vanilla instance, for methods not yet wrapped. */
  getEditor: () => VanillaSSMLEditor | null;
}

export const SSMLEditor = forwardRef<SSMLEditorRef, SSMLEditorProps>(function SSMLEditor(
  { value, onChange, onSSMLChange, readOnly = false, placeholder, className, style, features },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<VanillaSSMLEditor | null>(null);
  const appliedSSMLRef = useRef<string>("");
  const onChangeRef = useRef(onChange);
  const onSSMLChangeRef = useRef(onSSMLChange);

  onChangeRef.current = onChange;
  onSSMLChangeRef.current = onSSMLChange;

  // Mount the vanilla instance once.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) {
      return;
    }
    const editor = new VanillaSSMLEditor({
      el,
      value,
      onChange: (model) => {
        const ssml = modelToSSML(model);
        appliedSSMLRef.current = modelToSSML(model, { includeHints: true });
        onSSMLChangeRef.current?.(ssml);
        onChangeRef.current?.(model);
      },
      readOnly,
      placeholder,
      features,
    });
    editorRef.current = editor;
    appliedSSMLRef.current = modelToSSML(valueToModel(value), { includeHints: true });

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Sync the controlled value.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const incomingSSML = modelToSSML(valueToModel(value), { includeHints: true });
    if (incomingSSML === appliedSSMLRef.current) {
      return;
    }
    editor.setValue(value);
    appliedSSMLRef.current = incomingSSML;
  }, [value]);

  // Sync options.
  useEffect(() => {
    editorRef.current?.setOptions({
      readOnly,
      placeholder,
      features,
    });
  }, [readOnly, placeholder, features]);

  // Imperative handle.
  useImperativeHandle(
    ref,
    () => ({
      getValue: () => editorRef.current?.getValue() ?? { blocks: [], annotations: [], hints: [] },
      getSSML: () => editorRef.current?.getSSML() ?? "",
      setValue: (v) => {
        const ed = editorRef.current;
        if (!ed) {
          return;
        }
        ed.setValue(v);
        appliedSSMLRef.current = modelToSSML(valueToModel(v), { includeHints: true });
      },
      setSSML: (xml) => {
        const ed = editorRef.current;
        if (!ed) {
          return;
        }
        ed.setSSML(xml);
        appliedSSMLRef.current = modelToSSML(valueToModel(xml), { includeHints: true });
      },
      focus: () => editorRef.current?.focus(),
      getEditor: () => editorRef.current,
    }),
    [],
  );

  // Host div receives className/style; the vanilla editor builds and fills its own container inside.
  return <div ref={hostRef} className={className} style={style} />;
});
