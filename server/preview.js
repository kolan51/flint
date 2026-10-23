import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
};

let server = null;
let currentRoot = "";
let project = null;

function safeFile(root, urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]);
  const file = path.resolve(root, `.${rel}`);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return file;
}

export function startPreview(root) {
  currentRoot = root;
  if (server) return { url: "http://127.0.0.1:8799/" };
  server = http.createServer((req, res) => {
    const file = safeFile(currentRoot, req.url || "/");
    if (!file) {
      res.writeHead(403);
      res.end("Outside the folder");
      return;
    }
    fs.stat(file, (err, stat) => {
      const target = !err && stat.isDirectory() ? path.join(file, "index.html") : file;
      fs.readFile(target, (readErr, buf) => {
        if (readErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream" });
        res.end(buf);
      });
    });
  });
  server.listen(8799, "127.0.0.1");
  return { url: "http://127.0.0.1:8799/" };
}

export function startProject(root) {
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts || {};
  } catch {
    return { error: "This folder has no package.json." };
  }
  const script = scripts.dev ? "dev" : scripts.start ? "start" : "";
  if (!script) return { error: "package.json has no start or dev script." };
  if (project && !project.done) return { url: project.url, running: true };
  const child = spawn("npm", ["run", script], { cwd: root, shell: true, windowsHide: true });
  project = { child, url: "", done: false, output: "" };
  const take = (buf) => {
    project.output = (project.output + buf.toString()).slice(-8000);
    const found = project.output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/);
    if (found) project.url = found[0];
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  child.on("close", () => {
    if (project) project.done = true;
  });
  return { running: true, script };
}

export function projectStatus() {
  if (!project) return { running: false, url: "" };
  return { running: !project.done, url: project.url, output: project.output.slice(-500) };
}

export function stopProject() {
  if (project?.child && !project.done) project.child.kill();
  project = null;
  return { running: false };
}
