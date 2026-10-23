import { spawn } from "node:child_process";
import fs from "node:fs";

const sessions = new Map();
let ptyModule;

function bashPath() {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "/bin/bash",
  ];
  return candidates.find((item) => item && fs.existsSync(item)) || "";
}

export function listShells() {
  const shells = [];
  if (process.platform === "win32") {
    shells.push({ id: "powershell", label: "PowerShell" }, { id: "cmd", label: "Command Prompt" });
    if (bashPath()) shells.push({ id: "bash", label: "Git Bash" });
  } else {
    shells.push({ id: "bash", label: "bash" });
  }
  return shells;
}

function spec(kind) {
  if (process.platform !== "win32") return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
  if (kind === "cmd") return { file: process.env.ComSpec || "cmd.exe", args: [] };
  if (kind === "bash") {
    const file = bashPath();
    if (!file) throw new Error("Git Bash is not installed.");
    return { file, args: ["--login", "-i"] };
  }
  return { file: "powershell.exe", args: ["-NoLogo"] };
}

async function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    const mod = await import("node-pty");
    ptyModule = mod.default || mod;
  } catch {
    ptyModule = null;
  }
  return ptyModule;
}

export async function openSession(cwd, kind = "powershell", size = {}) {
  const chosen = spec(kind);
  const id = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const pty = await loadPty();
  if (pty) {
    const term = pty.spawn(chosen.file, chosen.args, {
      name: "xterm-256color",
      cols: Math.max(20, Number(size.cols) || 80),
      rows: Math.max(8, Number(size.rows) || 24),
      cwd,
      env: process.env,
      useConpty: process.platform === "win32",
    });
    const session = { id, kind, pty: term, listeners: new Set(), buffer: "" };
    const push = (text) => {
      session.buffer = (session.buffer + text).slice(-30000);
      for (const listener of session.listeners) listener(text);
    };
    term.onData(push);
    term.onExit(({ exitCode }) => push(`\r\n[exited ${exitCode ?? "?"}]\r\n`));
    sessions.set(id, session);
    return { id, kind, pty: true };
  }

  const child = spawn(chosen.file, kind === "powershell" ? ["-NoLogo", "-NoProfile", "-Command", "-"] : chosen.args.length ? chosen.args : ["/Q", "/K"], {
    cwd,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const session = { id, kind, child, listeners: new Set(), buffer: "" };
  const push = (buf) => {
    const text = buf.toString();
    session.buffer = (session.buffer + text).slice(-30000);
    for (const listener of session.listeners) listener(text);
  };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  child.on("exit", (code) => push(`\n[exited ${code ?? "?"}]\n`));
  sessions.set(id, session);
  return { id, kind, pty: false };
}

export function writeSession(id, data) {
  const session = sessions.get(id);
  if (!session) throw new Error("That shell is closed.");
  const text = String(data ?? "");
  if (session.pty) {
    session.pty.write(text);
    return;
  }
  session.child.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
}

export function resizeSession(id, cols, rows) {
  const session = sessions.get(id);
  if (!session?.pty) return;
  const width = Math.max(20, Number(cols) || 80);
  const height = Math.max(8, Number(rows) || 24);
  session.pty.resize(width, height);
}

export function listenSession(id, listener) {
  const session = sessions.get(id);
  if (!session) throw new Error("That shell is closed.");
  session.listeners.add(listener);
  if (session.buffer) listener(session.buffer);
  return () => session.listeners.delete(listener);
}

export function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.pty) session.pty.kill();
  else session.child.kill();
}
