/**
 * SSMLEditor — framework-agnostic entry point.
 */
import "./styles/styles.css";
export {
  createEmptyModel,
  plainToModel,
  isEmptyModel,
  modelToPlain,
  cloneModel,
} from "./utils/serialize";
export { ssmlToModel, valueToModel, ssmlToPlain, modelToSSML } from "./utils/ssml";
export type { SSMLSerializeOptions } from "./utils/ssml";
export type {
  AnnotationFeatures,
  AnnotationType,
  Cursor,
  ModelHint,
  PhonemeFeature,
  ResolvedAnnotationFeatures,
  SelectionSpan,
  SSMLAnnotation,
  SSMLBlock,
  SSMLModel,
  SSMLEditorValue,
  ToneFormat,
} from "./types";
export { resolveFeatures } from "./core/features";
export type { SSMLEditorOptions } from "./editor";
export { SSMLEditor } from "./editor";
