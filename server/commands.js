export function commandMatches(command, allowed) {
  const left = String(command || "").trim().replace(/\s+/g, " ");
  const right = String(allowed || "").trim().replace(/\s+/g, " ");
  if (!left || !right) return false;
  if (right.endsWith("*")) return left.startsWith(right.slice(0, -1).trimEnd());
  return left === right;
}

export function commandAllowed(command, list) {
  return (Array.isArray(list) ? list : []).some((item) => commandMatches(command, item));
}
