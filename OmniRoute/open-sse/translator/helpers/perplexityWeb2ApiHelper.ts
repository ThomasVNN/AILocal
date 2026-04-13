import { extractTextContent } from "./geminiHelper.ts";

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeRole(role: unknown): string {
  return typeof role === "string" && role.trim().length > 0 ? role.trim().toLowerCase() : "user";
}

function formatRoleLabel(role: string): string {
  switch (role) {
    case "system":
      return "System";
    case "developer":
      return "Developer";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    default:
      return "User";
  }
}

function stringifyToolCalls(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return "";
  return toolCalls
    .map((toolCall) => {
      const tool = toRecord(toolCall);
      const fn = toRecord(tool.function);
      const name = toString(fn.name, "unknown_tool");
      const args = toString(fn.arguments);
      return args ? `${name}(${args})` : `${name}()`;
    })
    .filter(Boolean)
    .join("\n");
}

function stringifyMessageContent(message: JsonRecord): string {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    const text = extractTextContent(message.content).trim();
    if (text) return text;
  }

  if (message.role === "assistant") {
    const toolCalls = stringifyToolCalls(message.tool_calls);
    if (toolCalls) return `[Tool calls]\n${toolCalls}`;
  }

  if (message.role === "tool") {
    const toolId = toString(message.tool_call_id, "tool");
    const content =
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? "", null, 2);
    return `[Tool result: ${toolId}]\n${content}`.trim();
  }

  return "";
}

function extractResponsesInputText(input: unknown): string {
  if (typeof input === "string") return input.trim();

  if (Array.isArray(input)) {
    return input
      .map((item) => extractResponsesInputText(item))
      .filter((item) => item.length > 0)
      .join("\n\n")
      .trim();
  }

  const item = toRecord(input);
  if (typeof item.text === "string") return item.text.trim();

  if (Array.isArray(item.content)) {
    const text = item.content
      .map((part) => {
        const contentPart = toRecord(part);
        if (
          contentPart.type === "input_text" ||
          contentPart.type === "output_text" ||
          contentPart.type === "text"
        ) {
          return toString(contentPart.text);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
    if (text.trim()) return text.trim();
  }

  return "";
}

export function buildPerplexityWeb2ApiQuery(body: JsonRecord): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];

  if (messages.length === 0) {
    return extractResponsesInputText(body.input).trim();
  }

  const normalizedMessages = messages
    .map((value) => {
      const message = toRecord(value);
      const role = normalizeRole(message.role);
      const text = stringifyMessageContent(message);
      return { role, text };
    })
    .filter((message) => message.text.length > 0);

  if (normalizedMessages.length === 0) {
    return "";
  }

  if (normalizedMessages.length === 1 && normalizedMessages[0].role === "user") {
    return normalizedMessages[0].text;
  }

  const instructionLines = normalizedMessages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message) => message.text);

  const conversation = normalizedMessages.filter(
    (message) => message.role !== "system" && message.role !== "developer"
  );

  let currentUserRequest = "";
  if (conversation.length > 0 && conversation[conversation.length - 1].role === "user") {
    currentUserRequest = conversation[conversation.length - 1].text;
    conversation.pop();
  }

  const sections: string[] = [];

  if (instructionLines.length > 0) {
    sections.push(`System instructions:\n${instructionLines.join("\n\n")}`);
  }

  if (conversation.length > 0) {
    sections.push(
      `Conversation history:\n${conversation
        .map((message) => `${formatRoleLabel(message.role)}: ${message.text}`)
        .join("\n\n")}`
    );
  }

  if (currentUserRequest) {
    sections.push(`Current user request:\n${currentUserRequest}`);
  } else if (conversation.length === 0) {
    sections.push(
      normalizedMessages
        .map((message) => `${formatRoleLabel(message.role)}: ${message.text}`)
        .join("\n\n")
    );
  }

  return sections.join("\n\n").trim();
}

export function normalizePerplexityWeb2ApiModel(model: unknown): string {
  if (typeof model !== "string" || model.trim().length === 0) return "default";

  let normalized = model.trim();
  if (normalized.startsWith("pplx-w2a/")) {
    normalized = normalized.slice("pplx-w2a/".length);
  } else if (normalized.startsWith("perplexity-web2api/")) {
    normalized = normalized.slice("perplexity-web2api/".length);
  }

  switch (normalized) {
    case "gpt-4o":
    case "gpt4":
      return "gpt4";
    case "sonar":
    case "sonar-pro":
    case "claude-3.5-sonnet":
      return "default";
    default:
      return normalized;
  }
}

export function buildPerplexityWeb2ApiRequest(model: unknown, body: JsonRecord): JsonRecord {
  const query = buildPerplexityWeb2ApiQuery(body);
  if (!query) {
    const error = new Error("Perplexity Web2API requires a non-empty prompt") as Error & {
      statusCode: number;
      errorType: string;
    };
    error.statusCode = 400;
    error.errorType = "invalid_request_error";
    throw error;
  }

  return {
    query_str: query,
    params: {
      attachments: [],
      query_source: "home",
      model_preference: normalizePerplexityWeb2ApiModel(model),
    },
  };
}

function mergeTextAtOffset(currentText: string, offset: number, fragment: string): string {
  const safeOffset = Math.max(0, Math.min(offset, currentText.length));
  const prefix = currentText.slice(0, safeOffset);
  const suffixStart = safeOffset + fragment.length;
  const suffix = suffixStart < currentText.length ? currentText.slice(suffixStart) : "";
  const merged = `${prefix}${fragment}${suffix}`;

  if (merged.startsWith(currentText)) return merged;
  if (currentText.startsWith(merged)) return currentText;
  return merged.length >= currentText.length ? merged : currentText;
}

function extractStructuredAnswer(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "";

  try {
    const parsed = JSON.parse(value) as JsonRecord;
    if (typeof parsed.answer === "string" && parsed.answer.trim().length > 0) {
      return parsed.answer.trim();
    }

    if (Array.isArray(parsed.structured_answer)) {
      const text = parsed.structured_answer
        .map((block) => {
          const record = toRecord(block);
          return toString(record.text);
        })
        .filter(Boolean)
        .join("");
      if (text.trim().length > 0) return text.trim();
    }
  } catch {
    // Ignore nested JSON parse failures; fall back to the original string.
  }

  return value.trim();
}

function extractAnswerFromSerializedSteps(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "";

  try {
    const steps = JSON.parse(value);
    if (!Array.isArray(steps)) return "";

    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const step = toRecord(steps[i]);
      if (toString(step.step_type) !== "FINAL") continue;
      const content = toRecord(step.content);
      return extractStructuredAnswer(content.answer);
    }
  } catch {
    return "";
  }

  return "";
}

export function extractPerplexityWeb2ApiText(payload: unknown, currentText = ""): string {
  const response = toRecord(payload);
  let nextText = currentText;

  const blocks = Array.isArray(response.blocks) ? response.blocks : [];
  for (const blockValue of blocks) {
    const block = toRecord(blockValue);
    const markdownBlock = toRecord(block.markdown_block);
    if (Object.keys(markdownBlock).length === 0) continue;

    const answer = toString(markdownBlock.answer).trim();
    if (answer.length > 0) {
      if (answer.length >= nextText.length) {
        nextText = answer;
      }
      continue;
    }

    const chunks = Array.isArray(markdownBlock.chunks)
      ? markdownBlock.chunks.filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      : [];
    if (chunks.length === 0) continue;

    const fragment = chunks.join("");
    const offset = toNumber(markdownBlock.chunk_starting_offset, nextText.length);
    const merged = mergeTextAtOffset(nextText, offset, fragment);
    if (merged.length >= nextText.length) {
      nextText = merged;
    }
  }

  if (nextText.length > 0) {
    return nextText;
  }

  const serializedAnswer = extractAnswerFromSerializedSteps(response.text);
  if (serializedAnswer.length > 0) return serializedAnswer;

  const plainText = toString(response.text).trim();
  if (plainText.length > 0) return plainText;

  return nextText;
}

export function getPerplexityWeb2ApiModel(payload: unknown, fallback = "default"): string {
  const response = toRecord(payload);
  return (
    toString(response.source) ||
    toString(response.model) ||
    toString(response.user_selected_model) ||
    toString(response.display_model) ||
    fallback
  );
}

export function getPerplexityWeb2ApiMessageId(payload: unknown): string {
  const response = toRecord(payload);
  return (
    toString(response.uuid) ||
    toString(response.frontend_uuid) ||
    toString(response.context_uuid) ||
    toString(response.backend_uuid)
  );
}

export function isPerplexityWeb2ApiFinal(payload: unknown): boolean {
  const response = toRecord(payload);
  if (response.final_sse_message === true) return true;
  if (toString(response.step_type) === "FINAL") return true;
  if (toString(response.status).toUpperCase() === "COMPLETED") return true;

  if (response.text_completed === true) {
    const blocks = Array.isArray(response.blocks) ? response.blocks : [];
    return blocks.some((blockValue) => {
      const block = toRecord(blockValue);
      const markdownBlock = toRecord(block.markdown_block);
      return (
        toString(markdownBlock.progress).toUpperCase() === "DONE" ||
        toString(markdownBlock.answer).length > 0
      );
    });
  }

  return false;
}
