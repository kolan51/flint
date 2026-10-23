export function chapterTitle(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  let cleaned = raw;
  let previous = "";
  while (cleaned && cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned
      .replace(/^(ok|pls|please|hey|hi|yo)\b[\s,.]*/i, "")
      .replace(/^(can you|could you|would you|i want you to|i want|make me|help me)\b[\s,]*/i, "")
      .replace(/^(here|a nice|a)\b[\s,]*/i, "")
      .trim();
  }
  const words = (cleaned || raw).split(" ").filter(Boolean).slice(0, 5);
  const title = words.join(" ");
  if (!title) return "New session";
  const short = title.length > 42 ? `${title.slice(0, 40).trim()}…` : title;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

export function sessionTitle(messages, fallback = "New session") {
  const user = (messages || []).find((message) => message.role === "user" && message.content && !message.passedFrom);
  const line = String(user?.content || "").split("\n").map((row) => row.trim()).find(Boolean);
  if (!line) return fallback;
  return chapterTitle(line);
}

function blank(id, title, messages = []) {
  const now = Date.now();
  return { id, title: String(title || "Session").slice(0, 80), created: now, updated: now, messages };
}

export function toBook(value) {
  if (Array.isArray(value)) {
    const item = blank("s_current", sessionTitle(value, "Current"), value);
    return { active: item.id, items: [item] };
  }
  if (value && value.sessions && typeof value.sessions === "object") {
    const items = Object.entries(value.sessions).map(([id, item]) => ({
      id: String(item?.id || id),
      title: String(item?.title || "Session").slice(0, 80),
      created: item?.created || Date.now(),
      updated: item?.updated || Date.now(),
      messages: Array.isArray(item?.messages) ? item.messages : [],
      ...(String(item?.summary || "").trim() ? { summary: String(item.summary).trim().slice(0, 4000) } : {}),
      ...(Number(item?.covered) > 0 ? { covered: Number(item.covered) } : {}),
    }));
    const active = items.some((item) => item.id === value.active) ? value.active : (items[0]?.id || "s_current");
    if (!items.length) items.push(blank(active, "New session"));
    return { active, items };
  }
  return { active: "s_current", items: [blank("s_current", "New session")] };
}

export function tidyChapters(books) {
  let changed = false;
  const next = {};
  for (const [agentId, book] of Object.entries(books || {})) {
    next[agentId] = {
      ...book,
      items: (book.items || []).map((item) => {
        if (item.titleEdited) return item;
        const title = String(item.title || "");
        const short = sessionTitle(item.messages || [], "");
        if (!short || short === "New session" || short === title) return item;
        if (title.length < 48 && !/^(ok|pls|please|hey)\b/i.test(title)) return item;
        changed = true;
        return { ...item, title: short };
      }),
    };
  }
  return { books: next, changed };
}

export function unpackChats(raw) {
  const books = {};
  const active = {};
  for (const [agentId, value] of Object.entries(raw || {})) {
    const book = toBook(value);
    books[agentId] = book;
    active[agentId] = book.items.find((item) => item.id === book.active)?.messages || [];
  }
  return { books, active };
}

export function packChats(books, activeMap) {
  const payload = {};
  const ids = new Set([...Object.keys(books || {}), ...Object.keys(activeMap || {})]);
  for (const agentId of ids) {
    const book = books?.[agentId] || toBook(activeMap?.[agentId] || []);
    const sessions = {};
    for (const item of book.items) {
      sessions[item.id] = {
        ...item,
        messages: item.id === book.active ? (activeMap?.[agentId] || []) : (item.messages || []),
        updated: item.id === book.active ? Date.now() : item.updated,
      };
    }
    if (!sessions[book.active]) {
      sessions[book.active] = blank(book.active, "New session", activeMap?.[agentId] || []);
    }
    payload[agentId] = { active: book.active, sessions };
  }
  return payload;
}

export function appendAgentMessages(chats, agentId, extra) {
  const book = toBook(chats?.[agentId]);
  const items = book.items.map((item) => (
    item.id === book.active
      ? { ...item, messages: [...item.messages, ...extra], updated: Date.now() }
      : item
  ));
  const sessions = {};
  for (const item of items) sessions[item.id] = item;
  return { ...(chats || {}), [agentId]: { active: book.active, sessions } };
}
