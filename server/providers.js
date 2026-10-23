function trimSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

export function chatCompletionsUrl(baseUrl) {
  const base = trimSlash(baseUrl);
  if (/\/(?:v1|openai)$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function modelsUrl(baseUrl) {
  const base = trimSlash(baseUrl);
  if (/\/(?:v1|openai)$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

function headers(provider) {
  const out = { "Content-Type": "application/json" };
  if (provider.apiKey) out.Authorization = `Bearer ${provider.apiKey}`;
  return out;
}

export function getProvider(settings, id) {
  const key = id || settings.activeProvider;
  const provider = settings.providers?.[key];
  if (!provider) throw new Error("Add a model in Models first.");
  return { ...provider, id: key, baseUrl: trimSlash(provider.baseUrl) };
}

export async function listModels(provider, signal) {
  if (provider.kind === "ollama") {
    const res = await fetch(`${provider.baseUrl}/api/tags`, { signal });
    if (!res.ok) throw new Error(await errorText(res, "Ollama models"));
    const data = await res.json();
    return (data.models || []).map((m) => m.name).filter(Boolean);
  }
  if (provider.kind === "anthropic") {
    if (!provider.apiKey) throw new Error("Claude needs an API key.");
    const res = await fetch(`${trimSlash(provider.baseUrl)}/v1/models`, {
      headers: {
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal,
    });
    if (!res.ok) throw new Error(await errorText(res, "Claude models"));
    const data = await res.json();
    return (data.data || []).map((m) => m.id).filter(Boolean);
  }

  const res = await fetch(modelsUrl(provider.baseUrl), { headers: headers(provider), signal });
  if (!res.ok) throw new Error(await errorText(res, "Model list"));
  const data = await res.json();
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

export async function probeProvider(provider, timeoutMs) {
  const host = String(provider.baseUrl || "");
  const remote = /^https:/i.test(host);
  const here = /127\.0\.0\.1|localhost|\[::1\]/i.test(host);
  const limit = timeoutMs || (remote ? 12000 : here ? 2500 : 8000);
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limit);
  try {
    const models = await listModels(provider, ctrl.signal);
    return { id: provider.id, ok: true, models, ms: Date.now() - started, error: "" };
  } catch (err) {
    const error = err.name === "AbortError" ? "Timed out" : err.message;
    return { id: provider.id, ok: false, models: [], ms: Date.now() - started, error };
  } finally {
    clearTimeout(timer);
  }
}

const gates = new Map();

function gateFor(key) {
  const name = String(key || "default");
  let gate = gates.get(name);
  if (!gate) {
    gate = { limit: 1, active: 0, waiters: [], learning: null, known: false };
    gates.set(name, gate);
  }
  return gate;
}

function pump(gate) {
  while (gate.waiters.length && gate.active < gate.limit) {
    gate.active += 1;
    const wake = gate.waiters.shift();
    wake();
  }
}

function releaseGate(gate) {
  gate.active = Math.max(0, gate.active - 1);
  pump(gate);
}

function acquireGate(key) {
  const gate = gateFor(key);
  if (gate.active < gate.limit) {
    gate.active += 1;
    return Promise.resolve(() => releaseGate(gate));
  }
  return new Promise((resolve) => {
    gate.waiters.push(() => resolve(() => releaseGate(gate)));
  });
}

async function learnSlots(provider) {
  const gate = gateFor(provider.baseUrl || provider.id);
  if (gate.known) return gate.limit;
  if (gate.learning) return gate.learning;
  gate.learning = (async () => {
    const base = trimSlash(provider.baseUrl);
    if (!base) return gate.limit;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${base}/slots`, { headers: headers(provider), signal: ctrl.signal });
      if (!res.ok) return gate.limit;
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : Number(data?.n_slots || data?.slots || 0);
      if (count > 0) {
        gate.limit = count;
        gate.known = true;
        pump(gate);
      }
    } catch {
      /* The next chat asks again. Until the server answers, one worker uses the model. */
    } finally {
      clearTimeout(timer);
      gate.learning = null;
    }
    return gate.limit;
  })();
  return gate.learning;
}

export async function* streamChat(provider, opts) {
  await learnSlots(provider);
  const release = await acquireGate(provider.baseUrl || provider.id);
  try {
    if (opts.signal?.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    if (provider.kind === "ollama") {
      yield* streamOllama(provider, opts);
      return;
    }
    if (provider.kind === "anthropic") {
      yield* streamAnthropic(provider, opts);
      return;
    }
    yield* streamOpenAI(provider, opts);
  } finally {
    release();
  }
}

function busyReply(err) {
  const text = String(err?.message || err || "");
  return /429|503|500|502|slot|busy|unavailable|overloaded|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|timed out/i.test(text);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(timer);
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
  });
}

async function fetchReady(url, options, label) {
  let last = new Error(`${label} failed`);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (options.signal?.aborted) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      last = new Error(await errorText(res, label));
      if (!busyReply(last)) throw last;
    } catch (err) {
      if (err?.name === "AbortError" || options.signal?.aborted) throw err;
      last = err;
      if (!busyReply(err)) throw err;
    }
    await wait(900 * (attempt + 1), options.signal);
  }
  throw last;
}

async function* streamOllama(provider, { model, messages, temperature, tools, signal }) {
  const body = {
    model,
    messages: toOllamaMessages(messages),
    stream: true,
    options: { temperature },
  };
  if (tools?.length) body.tools = tools;

  const res = await fetchReady(`${provider.baseUrl}/api/chat`, {
    method: "POST",
    headers: headers(provider),
    body: JSON.stringify(body),
    signal,
  }, "Ollama chat");

  const split = createThinkSplitter();
  const clock = { started: Date.now(), firstAt: 0, outChars: 0 };
  for await (const line of iterateLines(res.body)) {
    const parsed = parseStreamLine(line);
    if (!parsed?.chunk) continue;
    const chunk = parsed.chunk;
    const msg = chunk.message || {};
    if (msg.thinking) yield { type: "think", text: msg.thinking };
    if (msg.content) {
      noteOutput(clock, msg.content);
      for (const event of split.push(msg.content)) yield event;
    }
    if (msg.tool_calls?.length) yield { type: "tool_calls", tool_calls: normalizeOllamaTools(msg.tool_calls) };
    if (chunk.done) {
      for (const event of split.flush()) yield event;
      yield { type: "stats", stats: finishStats(clock, { ollama: chunk }) };
      yield { type: "done" };
    }
  }
}

async function* streamOpenAI(provider, { model, messages, temperature, tools, signal }) {
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    temperature,
    stream: true,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetchReady(chatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: headers(provider),
    body: JSON.stringify(body),
    signal,
  }, "Chat");

  const toolCalls = new Map();
  const split = createThinkSplitter();
  const clock = { started: Date.now(), firstAt: 0, outChars: 0 };
  let usage = null;
  let timings = null;

  for await (const line of iterateLines(res.body)) {
    const parsed = parseStreamLine(line);
    if (!parsed || parsed.done) {
      if (parsed?.done) break;
      continue;
    }
    const chunk = parsed.chunk;
    if (chunk.usage) usage = chunk.usage;
    if (chunk.timings) timings = chunk.timings;
    const delta = chunk.choices?.[0]?.delta || {};
    const thought = delta.reasoning_content || delta.reasoning || delta.thinking;
    if (thought) yield { type: "think", text: thought };
    if (delta.content) {
      noteOutput(clock, delta.content);
      for (const event of split.push(delta.content)) yield event;
    }
    if (delta.tool_calls) {
      for (const part of delta.tool_calls) {
        const idx = part.index ?? 0;
        const current = toolCalls.get(idx) || { id: "", type: "function", function: { name: "", arguments: "" } };
        if (part.id) current.id = part.id;
        if (part.function?.name) current.function.name += part.function.name;
        if (part.function?.arguments) current.function.arguments += part.function.arguments;
        toolCalls.set(idx, current);
      }
    }
    if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
      yield { type: "tool_calls", tool_calls: [...toolCalls.values()] };
    }
  }
  for (const event of split.flush()) yield event;
  yield { type: "stats", stats: finishStats(clock, { usage, timings }) };
  yield { type: "done" };
}

async function* streamAnthropic(provider, { model, messages, temperature, tools, signal }) {
  if (!provider.apiKey) throw new Error("Claude needs an API key.");
  const packed = toAnthropic(messages);
  const body = {
    model,
    max_tokens: 8192,
    temperature,
    stream: true,
    messages: packed.messages,
  };
  if (packed.system) body.system = packed.system;
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      name: tool.function?.name,
      description: tool.function?.description || "",
      input_schema: tool.function?.parameters || { type: "object", properties: {} },
    }));
  }
  const res = await fetchReady(`${trimSlash(provider.baseUrl)}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  }, "Claude");

  const blocks = new Map();
  const split = createThinkSplitter();
  const clock = { started: Date.now(), firstAt: 0, outChars: 0 };
  let usage = null;
  let stop = "";
  for await (const line of iterateLines(res.body)) {
    const parsed = parseStreamLine(line);
    if (!parsed?.chunk) continue;
    const chunk = parsed.chunk;
    if (chunk.type === "content_block_start") {
      const block = chunk.content_block || {};
      blocks.set(chunk.index, { type: block.type, id: block.id || "", name: block.name || "", json: "" });
    }
    if (chunk.type === "content_block_delta") {
      const delta = chunk.delta || {};
      if (delta.type === "text_delta" && delta.text) {
        noteOutput(clock, delta.text);
        for (const event of split.push(delta.text)) yield event;
      }
      if (delta.type === "thinking_delta" && delta.thinking) yield { type: "think", text: delta.thinking };
      if (delta.type === "input_json_delta" && delta.partial_json) {
        const block = blocks.get(chunk.index);
        if (block) block.json += delta.partial_json;
      }
    }
    if (chunk.type === "message_delta") {
      usage = chunk.usage || usage;
      stop = chunk.delta?.stop_reason || stop;
    }
  }
  if (stop === "tool_use") {
    const calls = [...blocks.values()].filter((block) => block.type === "tool_use").map((block, index) => ({
      id: block.id || `call_${index}`,
      type: "function",
      function: { name: block.name, arguments: block.json || "{}" },
    }));
    if (calls.length) yield { type: "tool_calls", tool_calls: calls };
  }
  for (const event of split.flush()) yield event;
  yield {
    type: "stats",
    stats: finishStats(clock, {
      usage: usage ? { completion_tokens: usage.output_tokens, prompt_tokens: usage.input_tokens } : null,
    }),
  };
  yield { type: "done" };
}

function toAnthropic(messages) {
  const system = [];
  const out = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = textOf(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === "tool" || message.tool_call_id) {
      const block = {
        type: "tool_result",
        tool_use_id: message.tool_call_id || "",
        content: textOf(message.content),
      };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      const content = [];
      const text = textOf(message.content);
      if (text) content.push({ type: "text", text });
      for (const call of message.tool_calls) {
        let input = {};
        try {
          input = JSON.parse(call.function?.arguments || "{}");
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: call.id, name: call.function?.name, input });
      }
      out.push({ role: "assistant", content });
      continue;
    }
    const text = textOf(message.content);
    const images = message.role === "user" ? (message.images || []) : [];
    if (images.length) {
      out.push({
        role: "user",
        content: [
          ...images.map((url) => {
            const match = String(url).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
            return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } } : null;
          }).filter(Boolean),
          { type: "text", text: text || " " },
        ],
      });
      continue;
    }
    out.push({ role: message.role === "assistant" ? "assistant" : "user", content: text || " " });
  }
  return { system: system.join("\n\n"), messages: out };
}

export function parseStreamLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  const payload = trimmed.replace(/^data:\s*/, "").trim();
  if (!payload || payload.startsWith(":")) return null;
  if (payload === "[DONE]") return { done: true };
  if (!payload.startsWith("{")) return null;
  try {
    return { chunk: JSON.parse(payload) };
  } catch {
    return null;
  }
}

function noteOutput(clock, text) {
  if (!clock.firstAt) clock.firstAt = Date.now();
  clock.outChars += String(text || "").length;
}

function finishStats(clock, { ollama, usage, timings } = {}) {
  const end = Date.now();
  const ms = Math.max(1, end - clock.started);
  const genMs = Math.max(1, end - (clock.firstAt || clock.started));
  const counted = ollama?.eval_count || usage?.completion_tokens || timings?.predicted_n || 0;
  const out = counted || Math.max(0, Math.round(clock.outChars / 4));
  const inn = ollama?.prompt_eval_count || usage?.prompt_tokens || timings?.prompt_n || 0;
  const tps = timings?.predicted_per_second
    || (ollama?.eval_count && ollama?.eval_duration ? ollama.eval_count / (ollama.eval_duration / 1e9) : 0)
    || (out ? out / (genMs / 1000) : 0);
  return {
    in: inn,
    out,
    ms,
    tps: Math.round(tps * 10) / 10,
    approx: !counted,
  };
}

function createThinkSplitter() {
  let mode = "answer";
  let carry = "";

  function push(text) {
    const events = [];
    let buf = carry + (text || "");
    carry = "";
    while (buf) {
      if (mode === "answer") {
        const open = buf.search(/<think(?:ing)?>/i);
        if (open < 0) {
          const hold = partialTag(buf);
          if (hold) {
            events.push({ type: "delta", text: buf.slice(0, -hold) });
            carry = buf.slice(-hold);
          } else {
            events.push({ type: "delta", text: buf });
          }
          break;
        }
        if (open > 0) events.push({ type: "delta", text: buf.slice(0, open) });
        buf = buf.slice(open).replace(/^<think(?:ing)?>/i, "");
        mode = "think";
      } else {
        const close = buf.search(/<\/think(?:ing)?>/i);
        if (close < 0) {
          const hold = partialTag(buf);
          if (hold) {
            events.push({ type: "think", text: buf.slice(0, -hold) });
            carry = buf.slice(-hold);
          } else {
            events.push({ type: "think", text: buf });
          }
          break;
        }
        if (close > 0) events.push({ type: "think", text: buf.slice(0, close) });
        buf = buf.slice(close).replace(/^<\/think(?:ing)?>/i, "");
        mode = "answer";
      }
    }
    return events.filter((event) => event.text);
  }

  function flush() {
    if (!carry) return [];
    const event = { type: mode === "think" ? "think" : "delta", text: carry };
    carry = "";
    return event.text ? [event] : [];
  }

  return { push, flush };
}

function partialTag(buf) {
  const start = buf.lastIndexOf("<");
  if (start < 0) return 0;
  const tail = buf.slice(start);
  if (tail.includes(">") || tail.length > 12) return 0;
  return /^<\/?t?h?i?n?k?i?n?g?$/i.test(tail) ? tail.length : 0;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
  return "";
}

function imageBytes(message) {
  return (message.images || [])
    .map((url) => String(url).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ""))
    .filter(Boolean);
}

function toOllamaMessages(messages) {
  return messages.map((m) => {
    const next = { role: m.role, content: textOf(m.content) };
    const images = imageBytes(m);
    if (images.length && m.role === "user") next.images = images;
    if (m.tool_call_id) next.tool_call_id = m.tool_call_id;
    if (m.tool_calls) next.tool_calls = m.tool_calls;
    return next;
  });
}

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role !== "user" || !m.images?.length) {
      return { ...m, content: textOf(m.content) };
    }
    return {
      role: "user",
      content: [
        { type: "text", text: textOf(m.content) },
        ...m.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    };
  });
}

function normalizeOllamaTools(calls) {
  return calls.map((call, i) => ({
    id: call.id || `call_${i}`,
    type: "function",
    function: {
      name: call.function?.name || call.name,
      arguments:
        typeof call.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments || call.arguments || {}),
    },
  }));
}

async function* iterateLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || "";
    for (const part of parts) yield part;
  }
  if (buffer.trim()) yield buffer;
}

export async function completeText(provider, model, messages, signal) {
  if (provider.kind === "ollama") {
    const res = await fetch(`${provider.baseUrl}/api/chat`, {
      method: "POST",
      headers: headers(provider),
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(messages),
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal,
    });
    if (!res.ok) throw new Error(await errorText(res, "Summary"));
    const data = await res.json();
    return data.message?.content || "";
  }
  if (provider.kind === "anthropic") {
    const packed = toAnthropic(messages);
    const res = await fetch(`${trimSlash(provider.baseUrl)}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0.2,
        system: packed.system,
        messages: packed.messages,
      }),
      signal,
    });
    if (!res.ok) throw new Error(await errorText(res, "Summary"));
    const data = await res.json();
    return (data.content || []).map((part) => part.text || "").join("");
  }
  const res = await fetch(chatCompletionsUrl(provider.baseUrl), {
    method: "POST",
    headers: headers(provider),
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(messages),
      temperature: 0.2,
      stream: false,
    }),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res, "Summary"));
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function errorText(res, label) {
  const text = await res.text();
  return `${label} failed (${res.status}): ${text.slice(0, 400)}`;
}
