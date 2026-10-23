import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export function parseTestOutput(output) {
  const text = String(output || "");
  const failures = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const pytest = line.match(/^FAILED\s+(\S+?)::(.+?)(?:\s+-\s+(.*))?$/);
    if (pytest) {
      const file = pytest[1].replaceAll("\\", "/");
      const key = `${file}:${pytest[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        failures.push({ path: file, line: 1, name: pytest[2], message: pytest[3] || "Failed" });
      }
      continue;
    }
    const unit = line.match(/^(FAIL|ERROR):\s+(\S+)/);
    if (unit) {
      const key = unit[2];
      if (!seen.has(key)) {
        seen.add(key);
        failures.push({ path: "", line: 1, name: unit[2], message: unit[1] === "ERROR" ? "Error" : "Failed" });
      }
    }
    const fileLine = line.match(/File "([^"]+)", line (\d+)/);
    if (fileLine && failures.length) {
      const last = failures[failures.length - 1];
      if (!last.path) {
        last.path = fileLine[1].replaceAll("\\", "/").split("/").slice(-2).join("/");
        last.line = Number(fileLine[2]) || 1;
      }
    }
  }
  return failures.slice(0, 40);
}

function run(cwd, command) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let out = "";
    const take = (buf) => {
      if (out.length < 40000) out += buf.toString();
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 1, output: `${out}\nTimed out.` });
    }, 60000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, output: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: out });
    });
  });
}

async function commandFor(root) {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const script = String(raw.scripts?.test || "");
    if (script && !/no test specified/i.test(script)) return "npm test";
  } catch {
    /* not a node project */
  }
  let names = [];
  try {
    names = await fs.readdir(root);
  } catch {
    return "";
  }
  if (names.some((name) => /^test_.*\.py$/i.test(name) || name === "tests")) return "python -m unittest discover -s . -p test_*.py -v";
  return "";
}

export async function runTests(root) {
  const command = await commandFor(root);
  if (!command) return { command: "", code: 1, failures: [], output: "No tests found. Add test_*.py or an npm test script." };
  const result = await run(root, command);
  return { command, code: result.code, failures: parseTestOutput(result.output), output: result.output.slice(-8000) };
}
