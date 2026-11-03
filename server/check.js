import path from "node:path";

export function checkCommandFor(settings, workspace) {
  const command = String(settings?.check?.command || "").trim();
  if (!command) return "";
  const root = String(settings?.check?.root || "").trim();
  if (root && path.resolve(root) !== path.resolve(workspace || "")) return "";
  return command;
}
