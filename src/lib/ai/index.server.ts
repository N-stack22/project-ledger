// Selector del proveedor de IA según AI_PROVIDER.
// Hoy soporta "ollama". Para añadir otro proveedor, crear una clase
// que implemente AIProvider y registrarla aquí.

import type { AIProvider } from "./types";
import { OllamaProvider } from "./providers/ollama.server";

export function getAIProvider(): AIProvider {
  const name = (process.env.AI_PROVIDER ?? "ollama").toLowerCase();
  switch (name) {
    case "ollama":
      return new OllamaProvider();
    default:
      // Fallback explícito: si la variable está mal configurada, igual usamos Ollama
      // para no romper la app. La llamada fallará claro si no está disponible.
      return new OllamaProvider();
  }
}
