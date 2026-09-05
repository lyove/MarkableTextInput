/**
 * Library build entry for IIFE/UMD single-file distribution.
 */
import "./styles/styles.css";
import { SSMLEditor } from "./editor";
import { ssmlToModel, modelToSSML } from "./utils/ssml";
import { createEmptyModel, plainToModel, modelToPlain, isEmptyModel } from "./utils/serialize";
import { resolveFeatures } from "./core/features";

const Creator = SSMLEditor as typeof SSMLEditor & {
  ssmlToModel: typeof ssmlToModel;
  modelToSSML: typeof modelToSSML;
  createEmptyModel: typeof createEmptyModel;
  plainToModel: typeof plainToModel;
  modelToPlain: typeof modelToPlain;
  isEmptyModel: typeof isEmptyModel;
  resolveFeatures: typeof resolveFeatures;
};

Creator.ssmlToModel = ssmlToModel;
Creator.modelToSSML = modelToSSML;
Creator.createEmptyModel = createEmptyModel;
Creator.plainToModel = plainToModel;
Creator.modelToPlain = modelToPlain;
Creator.isEmptyModel = isEmptyModel;
Creator.resolveFeatures = resolveFeatures;

export default Creator;
