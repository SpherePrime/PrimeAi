export type ModelKind = "text" | "image" | "video";

export interface PublicModel {
  id: string;
  name: string;
  routeCount: number;
  kind: ModelKind;
  supportsVision?: boolean;
  generationLimit?: { hours: number; requests: number };
}

export type GenerationKind = Exclude<ModelKind, "text">;

export interface GenerationResult {
  assets: Array<{ url?: string; base64?: string }>;
  providerName: string;
  publicModelId: string;
  upstreamModelId: string;
  substituted: boolean;
  limitRemaining?: number;
}

export interface GenerationRequest {
  kind: GenerationKind;
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  durationSeconds?: number;
  clientId?: string;
}

export interface ModelTestResult {
  ok: boolean;
  latencyMs: number;
  modelId?: string;
  error?: string;
}

export type RouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface RouterMessage {
  role: string;
  content: string | null | RouterContentPart[];
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; argumentsJson: string }>;
}

export interface RouterCompletionRequest {
  model: string;
  messages: RouterMessage[];
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  showReasoning?: boolean;
  strictModel?: boolean;
}

export type RouterEvent =
  | { type: "route"; providerName: string; modelId: string; substituted: boolean }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: { id: string; name: string; argumentsJson: string } }
  | { type: "done" }
  | { type: "error"; code: string; retryable: boolean; detail?: string };
