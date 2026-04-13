function cloneJson<T>(value: T): T {
  return structuredClone(value);
}

type RewriteText = (text: string, path: string) => string;

function rewriteMessageContent(content: unknown, rewriteText: RewriteText, path: string) {
  if (typeof content === "string") {
    return rewriteText(content, path);
  }

  if (Array.isArray(content)) {
    return content.map((part, index) => {
      if (typeof part === "string") {
        return rewriteText(part, `${path}[${index}]`);
      }
      if (part && typeof part === "object") {
        const nextPart = { ...(part as Record<string, unknown>) };
        if (typeof nextPart.text === "string") {
          nextPart.text = rewriteText(nextPart.text, `${path}[${index}].text`);
        }
        return nextPart;
      }
      return part;
    });
  }

  return content;
}

export function rewriteSupportedRequestPayload(
  payload: Record<string, unknown>,
  rewriteText: RewriteText
) {
  const next = cloneJson(payload);

  if (typeof next.system === "string") {
    next.system = rewriteText(next.system, "system");
  } else if (Array.isArray(next.system)) {
    next.system = next.system.map((part, index) => {
      if (typeof part === "string") {
        return rewriteText(part, `system[${index}]`);
      }
      if (part && typeof part === "object") {
        const nextPart = { ...(part as Record<string, unknown>) };
        if (typeof nextPart.text === "string") {
          nextPart.text = rewriteText(nextPart.text, `system[${index}].text`);
        }
        return nextPart;
      }
      return part;
    });
  }

  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message, index) => {
      if (!message || typeof message !== "object") {
        return message;
      }
      const nextMessage = { ...(message as Record<string, unknown>) };
      nextMessage.content = rewriteMessageContent(
        nextMessage.content,
        rewriteText,
        `messages[${index}].content`
      );
      return nextMessage;
    });
  }

  if (Array.isArray(next.input)) {
    next.input = next.input.map((item, index) => {
      if (typeof item === "string") {
        return rewriteText(item, `input[${index}]`);
      }
      if (!item || typeof item !== "object") {
        return item;
      }
      const nextItem = { ...(item as Record<string, unknown>) };
      if (typeof nextItem.content === "string" || Array.isArray(nextItem.content)) {
        nextItem.content = rewriteMessageContent(
          nextItem.content,
          rewriteText,
          `input[${index}].content`
        );
      }
      return nextItem;
    });
  }

  if (typeof next.instructions === "string") {
    next.instructions = rewriteText(next.instructions, "instructions");
  }

  return next;
}

export function rewriteSupportedResponsePayload(
  payload: Record<string, unknown>,
  rewriteText: RewriteText
) {
  const next = cloneJson(payload);

  if (Array.isArray(next.choices)) {
    next.choices = next.choices.map((choice, index) => {
      if (!choice || typeof choice !== "object") {
        return choice;
      }

      const nextChoice = { ...(choice as Record<string, unknown>) };
      if (nextChoice.message && typeof nextChoice.message === "object") {
        const nextMessage = { ...(nextChoice.message as Record<string, unknown>) };
        if (typeof nextMessage.content === "string") {
          nextMessage.content = rewriteText(
            nextMessage.content,
            `choices[${index}].message.content`
          );
        }
        nextChoice.message = nextMessage;
      }
      if (nextChoice.delta && typeof nextChoice.delta === "object") {
        const nextDelta = { ...(nextChoice.delta as Record<string, unknown>) };
        if (typeof nextDelta.content === "string") {
          nextDelta.content = rewriteText(nextDelta.content, `choices[${index}].delta.content`);
        }
        nextChoice.delta = nextDelta;
      }
      return nextChoice;
    });
  }

  return next;
}
