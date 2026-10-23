export const VENDORS = [
  { id: "ollama", label: "Ollama", hint: "On this machine", kind: "ollama", baseUrl: "http://127.0.0.1:11434", key: false },
  { id: "local", label: "Local server", hint: "llama.cpp, LM Studio", kind: "openai", baseUrl: "http://127.0.0.1:8080", key: "optional" },
  { id: "openai", label: "OpenAI", hint: "ChatGPT API", kind: "openai", baseUrl: "https://api.openai.com", key: true, match: /api\.openai\.com/i },
  { id: "anthropic", label: "Claude", hint: "Anthropic API", kind: "anthropic", baseUrl: "https://api.anthropic.com", key: true, match: /anthropic\.com/i },
  { id: "gemini", label: "Gemini", hint: "Google API", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", key: true, match: /googleapis\.com/i },
  { id: "deepseek", label: "DeepSeek", hint: "DeepSeek API", kind: "openai", baseUrl: "https://api.deepseek.com", key: true, match: /deepseek\.com/i },
  { id: "grok", label: "Grok", hint: "xAI API", kind: "openai", baseUrl: "https://api.x.ai", key: true, match: /api\.x\.ai/i },
  { id: "mistral", label: "Mistral", hint: "Mistral API", kind: "openai", baseUrl: "https://api.mistral.ai", key: true, match: /mistral\.ai/i },
  { id: "groq", label: "Groq", hint: "Groq API", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", key: true, match: /groq\.com/i },
  { id: "openrouter", label: "OpenRouter", hint: "One key, many models", kind: "openai", baseUrl: "https://openrouter.ai/api", key: true, match: /openrouter\.ai/i },
  { id: "together", label: "Together", hint: "Together API", kind: "openai", baseUrl: "https://api.together.xyz", key: true, match: /together\.(?:xyz|ai)/i },
  { id: "fireworks", label: "Fireworks", hint: "Fireworks API", kind: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", key: true, match: /fireworks\.ai/i },
  { id: "cerebras", label: "Cerebras", hint: "Cerebras API", kind: "openai", baseUrl: "https://api.cerebras.ai", key: true, match: /cerebras\.ai/i },
  { id: "cohere", label: "Cohere", hint: "Cohere API", kind: "openai", baseUrl: "https://api.cohere.ai/compatibility/v1", key: true, match: /cohere\.ai/i },
];

export function vendorById(id) {
  return VENDORS.find((item) => item.id === id) || VENDORS[0];
}

export function vendorOf(provider) {
  if (provider?.vendor && VENDORS.some((item) => item.id === provider.vendor)) return provider.vendor;
  if (provider?.kind === "ollama") return "ollama";
  if (provider?.kind === "anthropic") return "anthropic";
  const url = String(provider?.baseUrl || "");
  const hit = VENDORS.find((item) => item.match && item.match.test(url));
  return hit?.id || "local";
}

export function applyVendor(id, current) {
  const vendor = vendorById(id);
  const named = VENDORS.some((item) => item.label === current.name);
  return {
    ...current,
    vendor: vendor.id,
    kind: vendor.kind,
    baseUrl: vendor.baseUrl,
    name: current.name && !named ? current.name : vendor.label,
    apiKey: vendor.key === false ? "" : current.apiKey || "",
  };
}
