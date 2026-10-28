export function withResponseStyle(systemPrompt: string | undefined, conciseResponses?: boolean): string | undefined {
  if (conciseResponses === undefined) return systemPrompt;
  const preference = conciseResponses
    ? "Response length preference for this request: prefer concise answers that are short, direct and useful. Complete the requested work fully and include essential details. Honor the user's explicit requests for more detail or a specific format."
    : "Response length preference for this request: adapt detail to the task. General instructions to keep responses short or terse do not apply to this request. Provide the explanation, context and step-by-step detail needed for a complete, useful answer. Honor the user's explicit length and format requests; do not add filler.";
  return [systemPrompt, `${preference} This preference affects response length only. Keep all other instructions unchanged.`].filter(Boolean).join("\n\n");
}
