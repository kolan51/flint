export function slugId(name, existing) {
  const base = String(name || "model")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || "model";
  let id = base;
  let n = 2;
  while (existing[id]) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}
