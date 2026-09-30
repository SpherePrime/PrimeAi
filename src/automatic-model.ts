import type { PublicModel } from "./types.js";

export const automaticModelId = "__primeai_auto__";

export function addAutomaticModel(models: PublicModel[]): PublicModel[] {
  const availableModels = models.filter((model) => model.id !== automaticModelId);
  if (availableModels.length === 0) return [];
  return [{
    id: automaticModelId,
    name: "Автоматически (наилучший пинг)",
    routeCount: availableModels.reduce((total, model) => total + model.routeCount, 0),
    kind: "text",
    supportsVision: availableModels.some((model) => (model.kind === "text" || model.kind === undefined) && model.supportsVision === true),
  }, ...availableModels];
}
