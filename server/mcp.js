import { spawn } from "node:child_process";

function encode(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function openClient(server) {
  const args = String(server.args || "").trim() ? splitArgs(server.args) : [];
  const child = spawn(server.command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const waiters = new Map();

  function take() {
    while (buffer.length) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString("utf8");
      buffer = buffer.slice(start + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id != null && waiters.has(message.id)) {
        const { resolve, reject, timer } = waiters.get(message.id);
        clearTimeout(timer);
        waiters.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "MCP error"));
        else resolve(message.result);
      }
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    take();
  });
  child.on("error", (err) => {
    for (const { reject, timer } of waiters.values()) {
      clearTimeout(timer);
      reject(err);
    }
    waiters.clear();
  });

  function request(method, params, timeoutMs = 8000) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error(`${server.name || server.command} timed out`));
      }, timeoutMs);
      waiters.set(id, { resolve, reject, timer });
      child.stdin.write(encode({ jsonrpc: "2.0", id, method, params }));
    });
  }

  function notify(method, params) {
    child.stdin.write(encode({ jsonrpc: "2.0", method, params }));
  }

  function close() {
    child.kill();
  }

  return { request, notify, close, child };
}

function splitArgs(value) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|\S+/g;
  let match;
  while ((match = re.exec(String(value)))) args.push(match[1] || match[2] || match[0]);
  return args;
}

async function session(server, run) {
  const client = openClient(server);
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "flint", version: "0.1.0" },
    });
    client.notify("notifications/initialized", {});
    return await run(client);
  } finally {
    client.close();
  }
}

export function mcpToolName(server, tool) {
  return `mcp_${server.id}_${tool}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
}

export async function listMcpTools(servers = []) {
  const tools = [];
  const map = new Map();
  for (const server of servers) {
    if (!server?.command) continue;
    try {
      const result = await session(server, (client) => client.request("tools/list", {}));
      for (const tool of result?.tools || []) {
        const name = mcpToolName(server, tool.name);
        map.set(name, { server, tool: tool.name });
        tools.push({
          type: "function",
          function: {
            name,
            description: `[${server.name || server.command}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    } catch (err) {
      map.set(`mcp_error_${server.id}`, err.message);
    }
  }
  return { tools, map };
}

export async function callMcpTool(server, tool, args) {
  const result = await session(server, (client) => client.request("tools/call", { name: tool, arguments: args || {} }, 30000));
  const parts = result?.content || [];
  const text = parts.map((part) => part.text || "").filter(Boolean).join("\n").trim();
  return text || JSON.stringify(result).slice(0, 4000);
}
