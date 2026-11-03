function splitLines(text) {
  return String(text || "").split(/\r?\n/);
}

function newlineOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function norm(line) {
  return String(line || "").trim().replace(/[ \t]+/g, " ");
}

function tryExact(text, old) {
  if (!old) return null;
  const at = text.indexOf(old);
  if (at < 0) return null;
  if (text.indexOf(old, at + old.length) >= 0) return "many";
  return { at, old };
}

function spanAt(current, start, count) {
  const nl = newlineOf(current);
  const parts = splitLines(current);
  const before = parts.slice(0, start).join(nl);
  const slice = parts.slice(start, start + count).join(nl);
  const at = start === 0 ? 0 : before.length + nl.length;
  return { text: current, at, old: slice };
}

function tryLoose(current, old) {
  const file = splitLines(current);
  let needle = splitLines(String(old || "").replace(/\s+$/, ""));
  if (needle.length && needle[needle.length - 1] === "" && String(old).endsWith("\n")) needle = needle.slice(0, -1);
  if (!needle.length || needle.every((line) => !norm(line))) return null;
  const wanted = needle.map(norm);
  const hits = [];
  const last = file.length - wanted.length;
  for (let i = 0; i <= last; i += 1) {
    let ok = true;
    for (let j = 0; j < wanted.length; j += 1) {
      if (norm(file[i + j]) !== wanted[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    hits.push(i);
    if (hits.length > 1) return "many";
  }
  if (hits.length !== 1) return null;
  return spanAt(current, hits[0], wanted.length);
}

export function locateEdit(current, old) {
  const text = String(current || "");
  const from = String(old || "");
  if (!from) return null;
  const exact = tryExact(text, from);
  if (exact === "many") throw new Error("That span matched more than once. Include more surrounding lines.");
  if (exact) return { text, ...exact };
  if (text.includes("\r\n")) {
    const crlf = from.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    const again = tryExact(text, crlf);
    if (again === "many") throw new Error("That span matched more than once. Include more surrounding lines.");
    if (again) return { text, ...again };
  }
  const loose = tryLoose(text, from);
  if (loose === "many") throw new Error("That span matched more than once. Include more surrounding lines.");
  return loose;
}

export function applyUnifiedDiff(current, patch) {
  const source = String(current || "");
  const raw = String(patch || "").replace(/\r\n/g, "\n").split("\n");
  const hunks = [];
  let index = 0;
  while (index < raw.length) {
    const header = raw[index].match(/^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/);
    if (!header) {
      index += 1;
      continue;
    }
    const start = Math.max(1, Number(header[1]));
    index += 1;
    const body = [];
    while (index < raw.length && !raw[index].startsWith("@@")) {
      if (!raw[index].startsWith("\\")) body.push(raw[index]);
      index += 1;
    }
    hunks.push({ start, body });
  }
  if (!hunks.length) return null;
  const lines = splitLines(source);
  for (let hunkIndex = hunks.length - 1; hunkIndex >= 0; hunkIndex -= 1) {
    const hunk = hunks[hunkIndex];
    const at = hunk.start - 1;
    if (at < 0 || at > lines.length) return null;
    const rebuilt = [];
    let cursor = at;
    for (const row of hunk.body) {
      if (!row) continue;
      const mark = row[0];
      const rest = row.slice(1);
      if (mark === "+") {
        rebuilt.push(rest);
        continue;
      }
      if (mark !== "-" && mark !== " ") return null;
      if (cursor >= lines.length) return null;
      if (norm(lines[cursor]) !== norm(rest)) return null;
      if (mark === " ") rebuilt.push(lines[cursor]);
      cursor += 1;
    }
    lines.splice(at, cursor - at, ...rebuilt);
  }
  const nl = newlineOf(source);
  return lines.join(nl);
}
