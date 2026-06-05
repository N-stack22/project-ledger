// Selector del proveedor de IA según AI_PROVIDER.
// Soportados: "claude" (default), "ollama".

import type { AIProvider } from "./types";
import { OllamaProvider } from "./providers/ollama.server";
import { ClaudeProvider } from "./providers/claude.server";

export function getAIProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER ?? "claude").toLowerCase();
  switch (name) {
    case "ollama":
      return new OllamaProvider();
    case "claude":
    case "anthropic":
      return new ClaudeProvider();
    default:
      return new ClaudeProvider();
  }
}
