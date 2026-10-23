import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function runHook(root, event, payload) {
  const dir = path.join(root, ".flint", "hooks");
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const scripts = names.filter((name) => name === event || name.startsWith(`${event}.`));
  for (const name of scripts) {
    const file = path.join(dir, name);
    const ext = path.extname(name).toLowerCase();
    const command = ext === ".js"
      ? `node "${file}"`
      : ext === ".ps1"
        ? `powershell -NoProfile -File "${file}"`
        : ext === ".cmd" || ext === ".bat" || ext === ".sh"
          ? `"${file}"`
          : "";
    if (!command) continue;
    await new Promise((resolve) => {
      const child = spawn(command, { cwd: root, shell: true, windowsHide: true });
      child.stdin?.end(JSON.stringify(payload || {}));
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 8000);
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
