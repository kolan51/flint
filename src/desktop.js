export const desktop = window.desktop || {
  isDesktop: false,
  openFolder: async () => null,
  openFiles: async () => [],
  reveal: async () => {},
  minimize: () => {},
  toggleMaximize: async () => false,
  close: () => {},
  pathForFile: () => "",
  onMenu: () => () => {},
  onWindow: () => () => {},
};

export function dirname(filePath) {
  return String(filePath || "").replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "") || filePath;
}

export function relativeTo(root, absPath) {
  const left = String(root || "").replace(/[\\/]+$/, "").replaceAll("\\", "/").toLowerCase();
  const right = String(absPath || "").replaceAll("\\", "/");
  if (!left || !right) return null;
  if (right.toLowerCase() === left) return "";
  if (right.toLowerCase().startsWith(`${left}/`)) return right.slice(left.length + 1);
  return null;
}

export function joinPath(root, rel) {
  if (!rel) return root;
  const sep = String(root || "").includes("\\") ? "\\" : "/";
  return `${String(root).replace(/[\\/]+$/, "")}${sep}${String(rel).replaceAll("/", sep)}`;
}
