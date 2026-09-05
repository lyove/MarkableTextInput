/**
 * Model helpers. The controlled value IS the SSMLModel, so only thin convenience
 * converters live here.
 */
import { type SSMLModel } from "../types";
import { createModelFromText } from "../model/model";

/** Model -> plain text (paragraphs joined by newline, annotations dropped) */
export function modelToPlain(model: SSMLModel): string {
  return model.blocks.map((b) => b.text).join("\n");
}

/** Plain text -> model */
export function plainToModel(text: string): SSMLModel {
  return createModelFromText(text);
}

/** Empty model */
export function createEmptyModel(): SSMLModel {
  return { blocks: [], annotations: [], hints: [] };
}

/** Whether the model has no visible text */
export function isEmptyModel(model: SSMLModel): boolean {
  return model.blocks.every((b) => b.text.length === 0);
}

/** Deep copy of a model snapshot. */
export function cloneModel(model: SSMLModel): SSMLModel {
  return {
    blocks: model.blocks.map((b) => ({ ...b })),
    annotations: model.annotations.map((a) => ({ ...a, attrs: { ...a.attrs } })),
    hints: model.hints.map((h) => ({ ...h })),
  };
}
