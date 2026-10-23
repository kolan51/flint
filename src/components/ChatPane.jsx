import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AgentFace from "./AgentFace.jsx";
import { agentJob, resolveAgent } from "../faces.js";
import { createPortal } from "react-dom";
import { useApp } from "../store.jsx";
import { nearBottom } from "../scroll.js";

function flattenFiles(nodes, into = []) {
  for (const node of nodes || []) {
    if (node.type === "dir") flattenFiles(node.children, into);
    else into.push(node);
  }
  return into;
}

const COMMANDS = [
  { id: "search", label: "Search the folder", args: true },
  { id: "diff", label: "Review edits", args: false },
  { id: "undo", label: "Undo the last run", args: false },
  { id: "plan", label: "Plan only", args: false },
  { id: "act", label: "Act on files", args: false },
  { id: "term", label: "Run in the terminal", args: true },
  { id: "git", label: "Git status", args: false },
  { id: "commit", label: "Commit the folder", args: true },
  { id: "pass", label: "Pass the plan to an agent", args: true },
  { id: "new", label: "New session", args: false },
  { id: "fork", label: "Fork this session", args: false },
  { id: "export", label: "Export this session", args: false },
];

function parseSlash(value) {
  const match = String(value || "").match(/^\/([^\s]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), rest: (match[2] || "").trim() };
}

export default function ChatPane() {
  const {
    chats,
    activeAgent,
    agents,
    sendChat,
    busy,
    activity,
    applyToEditor,
    tree,
    mode,
    setMode,
    runSlash,
    passPlan,
    stopChat,
    sessionBooks,
    skills,
    newSession,
    openSession,
    deleteSession,
    patchSession,
    ask,
    forkSession,
    exportSession,
    openFile,
    setDock,
    reviews,
    touches,
    commands,
    decideCommand,
    settings,
    setCommandMode,
  } = useApp();
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [soFar, setSoFar] = useState("");
  const soFarFocus = useRef(false);
  const [naming, setNaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const skipTitle = useRef(false);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionBox, setSessionBox] = useState(null);
  const sessionBar = useRef(null);
  const sessionMenu = useRef(null);
  const [sessionSlot, setSessionSlot] = useState(null);
  const [text, setText] = useState("");
  const [mention, setMention] = useState(null);
  const [images, setImages] = useState([]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [micNote, setMicNote] = useState("");
  const box = useRef(null);
  const imagePick = useRef(null);
  const cmdMenu = useRef(null);
  const hearingRef = useRef(false);
  const heardAny = useRef(false);
  useEffect(() => {
    if (!cmdOpen) return undefined;
    function onDown(event) {
      if (!cmdMenu.current?.contains(event.target)) setCmdOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [cmdOpen]);

  useEffect(() => {
    if (!hearing || !window.desktop?.onHeard) return undefined;
    return window.desktop.onHeard((line) => {
      const heard = String(line || "").trim();
      if (!heard) return;
      heardAny.current = true;
      setMicNote("");
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ${heard}` : heard));
    });
  }, [hearing]);

  async function toggleMic() {
    if (!window.desktop?.dictate) {
      setMicNote("The mic is in the Flint window.");
      return;
    }
    if (hearingRef.current) {
      hearingRef.current = false;
      setHearing(false);
      await window.desktop.dictateStop?.();
      return;
    }
    heardAny.current = false;
    hearingRef.current = true;
    setHearing(true);
    setMicNote("");
    let failed = false;
    try {
      await window.desktop.dictate();
    } catch (err) {
      failed = true;
      if (hearingRef.current) setMicNote(micMessage(err));
    } finally {
      const still = hearingRef.current;
      hearingRef.current = false;
      setHearing(false);
      if (still && !failed && !heardAny.current) setMicNote("Didn't catch that.");
    }
  }

  const messages = chats[activeAgent?.id] || [];
  const scroller = useRef(null);
  const pinned = useRef(true);

  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    pinned.current = nearBottom(node.scrollHeight, node.scrollTop, node.clientHeight);
  }

  useEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    pinned.current = true;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeAgent?.id]);

  const files = flattenFiles(tree)
    .filter((file) => mention == null || file.name.toLowerCase().includes(mention.toLowerCase()))
    .slice(0, 8);
  const typingSlash = text.startsWith("/") && !text.includes(" ");
  const slashName = typingSlash ? text.slice(1).toLowerCase() : "";
  const skillCommands = (skills || []).map((skill) => ({ id: skill.id, label: skill.label, args: true, skill: true }));
  const slashItems = typingSlash
    ? [...COMMANDS, ...skillCommands.filter((skill) => !COMMANDS.some((command) => command.id === skill.id))]
      .filter((command) => command.id.startsWith(slashName))
    : [];
  const book = sessionBooks?.[activeAgent?.id];
  const activeChapter = book?.items?.find((item) => item.id === book.active) || null;
  const sessionTitle = activeChapter?.title || "New session";

  useEffect(() => {
    if (soFarFocus.current) return;
    setSoFar(activeChapter?.summary || "");
  }, [activeAgent?.id, activeChapter?.id, activeChapter?.summary]);
  const sessionCount = book?.items?.length || 0;
  const sessionHits = (book?.items || []).filter((item) => {
    const thread = item.id === book?.active ? messages : (item.messages || []);
    const blob = `${item.title}\n${thread.map((message) => message.content || "").join("\n")}`.toLowerCase();
    return blob.includes(sessionQuery.trim().toLowerCase());
  }).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));

  function openTouched(file) {
    const path = file?.path || "";
    if (!path) return;
    openFile(path).catch(() => {});
    const review = (reviews || []).find((item) => item.path === path && item.status === "open");
    if (review) setDock("review");
  }

  function closeSessions() {
    setSessionsOpen(false);
    setSessionQuery("");
  }

  function saveSoFar() {
    const current = String(activeChapter?.summary || "");
    const next = soFar.trim().slice(0, 4000);
    if (!activeAgent || !activeChapter || next === current) return;
    patchSession(activeAgent.id, activeChapter.id, { summary: next });
  }

  function startRename(event) {
    event.stopPropagation();
    closeSessions();
    setDraftTitle(sessionTitle === "New session" ? "" : sessionTitle);
    setNaming(true);
  }

  async function commitTitle() {
    if (skipTitle.current) {
      skipTitle.current = false;
      setNaming(false);
      return;
    }
    const title = draftTitle.trim().slice(0, 80);
    setNaming(false);
    if (!title || !activeAgent || !activeChapter || title === sessionTitle) return;
    await patchSession(activeAgent.id, activeChapter.id, { title, titleEdited: true });
  }

  async function renameChapter() {
    const current = sessionTitle === "New session" ? "" : sessionTitle;
    const next = await ask({
      title: "Name this chat",
      body: "The header keeps this name.",
      input: true,
      value: current,
      confirm: "Save",
    });
    const title = String(next || "").trim().slice(0, 80);
    if (!title || !activeAgent || !activeChapter) return;
    await patchSession(activeAgent.id, activeChapter.id, { title, titleEdited: true });
  }

  function toggleSessions() {
    if (sessionsOpen) {
      saveSoFar();
      closeSessions();
      return;
    }
    const rect = sessionBar.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 300;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setSoFar(activeChapter?.summary || "");
    setSessionBox({ top: rect.bottom + 6, left, width });
    setSessionsOpen(true);
  }

  useEffect(() => {
    setSessionSlot(document.querySelector(".session-slot"));
  }, []);

  useEffect(() => {
    if (!sessionsOpen) return undefined;
    function close(event) {
      if (sessionBar.current?.contains(event.target) || sessionMenu.current?.contains(event.target)) return;
      closeSessions();
    }
    function onKey(event) {
      if (event.key === "Escape") closeSessions();
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [sessionsOpen]);

  function runCommand(value) {
    const parsed = parseSlash(value);
    const exact = [...COMMANDS, ...skillCommands].find((command) => command.id === parsed?.name);
    if (!exact && slashItems[0] && !parsed?.rest) {
      setText(`/${slashItems[0].id}${slashItems[0].args ? " " : ""}`);
      return;
    }
    if (!exact) return;
    setText("");
    setMention(null);
    runSlash(exact.id, parsed.rest);
  }

  function submit() {
    const next = text;
    const shots = images;
    if (!next.trim() && !shots.length) return;
    pinned.current = true;
    setText("");
    setMention(null);
    setImages([]);
    sendChat(next, shots);
  }

  function addImage(file) {
    if (!file || !file.type.startsWith("image/") || images.length >= 2) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", 0.8);
        setImages((prev) => (prev.length >= 2 ? prev : [...prev, url]));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function onType(value, cursor) {
    setText(value);
    const before = value.slice(0, cursor ?? value.length);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    setMention(match ? match[2] : null);
  }

  function insertFile(path) {
    const node = box.current;
    const cursor = node?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@([^\s@]*)$/, `@${path} `);
    const next = before + text.slice(cursor);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => node?.focus());
  }

  return (
    <>
      {sessionSlot && createPortal(
        <div className="session-bar" ref={sessionBar}>
          {naming ? (
            <input
              className="session-title-input"
              value={draftTitle}
              placeholder="Name this chat"
              aria-label="Chat name"
              autoFocus
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  skipTitle.current = true;
                  setNaming(false);
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <button type="button" className="session-current" title={sessionTitle} onClick={toggleSessions}>
              <span>{sessionTitle === "New session" ? "Empty chat" : sessionTitle}</span>
            </button>
          )}
          <button type="button" className="session-pen" aria-label="Rename chat" title="Rename" onClick={startRename}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
              <path d="M13.5 6.5l3 3" />
            </svg>
          </button>
        </div>,
        sessionSlot,
      )}
      {sessionsOpen && sessionBox && createPortal(
        <div
          className="session-menu"
          ref={sessionMenu}
          style={{ top: sessionBox.top, left: sessionBox.left, width: sessionBox.width }}
        >
          <button
            type="button"
            className="session-new"
            onClick={() => {
              if (activeAgent) newSession(activeAgent.id);
              closeSessions();
            }}
          >
            <span>New chat</span>
          </button>
          {sessionCount > 5 && (
            <input
              value={sessionQuery}
              onChange={(event) => setSessionQuery(event.target.value)}
              placeholder="Find a chat"
            />
          )}
          <div className="session-list">
            {sessionHits.map((item) => (
              <div className={`session-row${item.id === book?.active ? " on" : ""}`} key={item.id}>
                <button
                  type="button"
                  className="session-pick"
                  title={item.title}
                  onClick={() => {
                    openSession(activeAgent?.id, item.id);
                    closeSessions();
                  }}
                >
                  <span>{item.title === "New session" ? "Empty chat" : item.title}</span>
                </button>
                <button
                  type="button"
                  className="session-trash"
                  aria-label={`Delete ${item.title === "New session" ? "empty chat" : item.title}`}
                  title="Delete chat"
                  onClick={async () => {
                    const label = item.title === "New session" ? "Empty chat" : item.title;
                    const ok = await ask({ title: "Delete this chat", body: label, confirm: "Delete", danger: true });
                    if (!ok) return;
                    deleteSession(activeAgent?.id, item.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M9 7V5h6v2" />
                    <path d="M7 7l1 13h8l1-13" />
                  </svg>
                </button>
              </div>
            ))}
            {sessionHits.length === 0 && <p className="dir-label">{sessionCount > 1 ? "No matching chat" : "No earlier chat"}</p>}
          </div>
          <div className="session-foot">
            <button type="button" onClick={renameChapter}>Rename</button>
            <button type="button" onClick={() => { forkSession(activeAgent?.id); closeSessions(); }}>Fork</button>
            <button type="button" onClick={() => exportSession(activeAgent?.id)}>Export</button>
          </div>
        </div>,
        document.body,
      )}
      <div className="messages" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <b>{activeAgent?.name || "Agent"}</b>
            <p>{(book?.items?.length || 0) > 1
              ? "This chat is empty. The name above opens the earlier ones."
              : "Ask about the open file, or hand the work to another agent."}</p>
          </div>
        )}
        {messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            agent={activeAgent}
            live={busy === "chat" && index === messages.length - 1}
            activity={message.handoffs?.length || index === messages.length - 1 ? activity : null}
            settings={settings}
            onApply={applyToEditor}
            plan={mode === "plan" && index === messages.length - 1 && message.role === "assistant" && message.content}
            agents={agents}
            touches={touches}
            pending={busy === "chat" && index === messages.length - 1 ? commands : []}
            onOpenFile={openTouched}
            onDecide={decideCommand}
            onPass={(name) => passPlan(name, message.content)}
          />
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.startsWith("/")) runCommand(text);
          else submit();
        }}
      >
        {mention != null && files.length > 0 && (
          <div className="mentions">
            {files.map((file) => (
              <button type="button" key={file.path} onClick={() => insertFile(file.path)}>
                {file.path}
              </button>
            ))}
          </div>
        )}
        {slashItems.length > 0 && (
          <div className="mentions">
            {slashItems.map((command) => (
              <button
                type="button"
                key={command.id}
                onClick={() => {
                  if (command.args) {
                    setText(`/${command.id} `);
                    requestAnimationFrame(() => box.current?.focus());
                    return;
                  }
                  setText("");
                  runSlash(command.id);
                }}
              >
                /{command.id}
                <span>{command.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-box">
        <textarea
          ref={box}
          value={text}
          placeholder={`Message ${activeAgent?.name || "agent"}  ·  Enter to send`}
          onPaste={(event) => {
            const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
            if (file) {
              event.preventDefault();
              addImage(file);
            }
          }}
          onChange={(e) => onType(e.target.value, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if ((e.key !== "Enter" && e.code !== "NumpadEnter") || e.shiftKey) return;
            e.preventDefault();
            if (mention != null && files[0]) insertFile(files[0].path);
            else if (text.startsWith("/")) runCommand(text);
            else submit();
          }}
        />
        {images.length > 0 && (
          <div className="shots">
            {images.map((url) => (
              <button type="button" key={url.slice(-24)} className="shot" onClick={() => setImages((prev) => prev.filter((item) => item !== url))}>
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <span className="composer-tools">
            <button
              type="button"
              className={`chip ${mode === "plan" ? "active" : ""}`}
              onClick={() => setMode(mode === "plan" ? "act" : "plan")}
            >
              {mode === "plan" ? "Plan" : "Agent"}
            </button>
            <span className="cmd-pick" ref={cmdMenu}>
              <button
                type="button"
                className={`chip-note ${settings?.commands?.mode === "allow" ? "on" : ""}`}
                aria-expanded={cmdOpen}
                aria-haspopup="menu"
                title={settings?.commands?.mode === "allow" ? "Commands in this folder run without asking." : "Ask before each command."}
                onClick={() => setCmdOpen((open) => !open)}
              >
                {settings?.commands?.mode === "allow" ? "Allow all" : "Always ask"}
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {cmdOpen && (
                <span className="cmd-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={settings?.commands?.mode === "allow" ? "" : "on"}
                    onClick={() => { setCommandMode("ask"); setCmdOpen(false); }}
                  >
                    Always ask
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={settings?.commands?.mode === "allow" ? "on" : ""}
                    onClick={() => { setCommandMode("allow"); setCmdOpen(false); }}
                  >
                    Allow all
                  </button>
                </span>
              )}
            </span>
            <button
              type="button"
              className="icon-btn"
              title="Attach an image"
              aria-label="Attach an image"
              onClick={() => imagePick.current?.click()}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="4" y="5" width="16" height="14" rx="2" />
                <circle cx="9" cy="10" r="1.4" />
                <path d="M4 16l4.5-4 3.5 3 2.5-2 5 5" />
              </svg>
            </button>
            <button
              type="button"
              className={`icon-btn ${hearing ? "live" : ""}`}
              title={hearing ? "Listening. Click to stop." : "Speak into the chat"}
              aria-label={hearing ? "Stop the microphone" : "Speak into the chat"}
              aria-pressed={hearing}
              onClick={toggleMic}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0" />
                <path d="M12 17v3" />
              </svg>
            </button>
            {micNote && <span className="mic-note">{micNote}</span>}
            <input
              ref={imagePick}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addImage(file);
                event.target.value = "";
              }}
            />
            {busy === "chat" && <span className="working-note">{activity[activeAgent?.id] || "Working"}</span>}
          </span>
          {busy === "chat" ? (
            <button className="btn" type="button" onClick={stopChat}>Stop</button>
          ) : (
            <button className="btn" type="button" disabled={!text.trim() && !images.length} onClick={() => (text.startsWith("/") ? runCommand(text) : submit())}>Send</button>
          )}
        </div>
        </div>
      </form>
    </>
  );
}

function micMessage(err) {
  const raw = String(err?.message || "");
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  return cleaned || "The microphone did not start.";
}

function changedSentence(text) {
  const flat = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  const sentence = flat.match(/^(.{12,}?[.!?])(?:\s|$)/);
  return oneLine(sentence ? sentence[1] : flat, 120);
}

function oneLine(text, max = 110) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const stop = cut.lastIndexOf(" ");
  const head = (stop > 48 ? cut.slice(0, stop) : cut).trim();
  return `${head}…`;
}

const openDetails = new Set();

function RememberDetails({ id, className, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !id) return undefined;
    function onToggle() {
      if (node.open) openDetails.add(id);
      else openDetails.delete(id);
    }
    node.addEventListener("toggle", onToggle);
    node.open = openDetails.has(id);
    return () => node.removeEventListener("toggle", onToggle);
  }, [id]);
  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}

function Fold({ id, text, children }) {
  const full = String(text || "").trim();
  if (!full) return null;
  const brief = oneLine(full);
  if (brief === full) return children || <p className="crew-sentence">{full}</p>;
  return (
    <RememberDetails id={id} className="crew-fold">
      <summary title={full}><span>{brief}</span></summary>
      {children || <Prose text={full} />}
    </RememberDetails>
  );
}

function fileBase(path) {
  return String(path || "").split(/[/\\]/).filter(Boolean).pop() || path;
}

function fileFromLine(line) {
  const match = String(line || "").match(/^(?:Reading|Editing|Writing)\s+(.+)$/);
  return match ? match[1].trim() : "";
}

function resolveTouch(agentId, hint, touches) {
  const files = touches?.[agentId] || [];
  if (!hint) return files[0] || "";
  const hit = files.find((file) => file === hint || file.endsWith(`/${hint}`) || file.endsWith(`\\${hint}`));
  return hit || (hint.includes("/") || hint.includes("\\") ? hint : "");
}

function workerFile(handoff, activity, touches) {
  const owned = handoff.files || [];
  const last = owned[owned.length - 1];
  if (last?.path) return last;
  const line = activity?.[handoff.agentId] || "";
  const path = resolveTouch(handoff.agentId, fileFromLine(line), touches);
  if (!path) return null;
  return { path, agentId: handoff.agentId, name: handoff.name, color: handoff.color, kind: /Editing|Writing/.test(line) ? "edit" : "read" };
}

function queueNote(id, activity, handoffs, live) {
  const fromActivity = activity?.[id] || "";
  if (fromActivity) return fromActivity;
  if (!live) return "";
  const handoff = (handoffs || []).find((item) => (item.agentId === id || item.name === id) && item.status === "working");
  if (!handoff) return "";
  return handoff.note || "Waiting for the model";
}

function providerOf(agent, settings) {
  return agent?.provider || settings?.activeProvider || "";
}

function modelQueue(agents, activity, handoffs, live, settings) {
  if (!handoffs?.length) return [];
  const byId = new Map((agents || []).map((agent) => [agent.id, agent]));
  const names = new Map((agents || []).map((agent) => [agent.id, agent.name]));
  const ids = [];
  const push = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  for (const handoff of handoffs) {
    if (handoff.agentId && !names.has(handoff.agentId)) names.set(handoff.agentId, handoff.name);
    if (handoff.name) names.set(handoff.name, handoff.name);
    push(handoff.agentId || handoff.name);
  }
  const providers = new Set(ids.map((id) => providerOf(byId.get(id), settings)).filter(Boolean));
  if (providers.size !== 1) return [];
  const waiting = (id) => /^(Waiting for the model|Waiting|Queued)$/.test(queueNote(id, activity, handoffs, live));
  const holding = (id) => {
    const line = queueNote(id, activity, handoffs, live);
    return Boolean(line) && !/^(Waiting|Queued|Done|Failed|Stopped)\b/.test(line);
  };
  const holder = ids.find(holding);
  const queued = ids.filter((id) => id !== holder && waiting(id));
  if (!holder || !queued.length) return [];
  const rows = [{ id: holder, name: names.get(holder) || "Agent", holding: true }];
  for (const id of queued) {
    rows.push({
      id,
      name: names.get(id) || handoffs.find((item) => item.agentId === id)?.name || "Agent",
      holding: false,
    });
  }
  return rows;
}

function sharedFiles(handoffs, activity) {
  const map = new Map();
  for (const handoff of handoffs || []) {
    const hint = fileFromLine(activity?.[handoff.agentId] || "") || fileBase((handoff.files || []).at(-1)?.path || "");
    if (!hint) continue;
    const key = fileBase(hint).toLowerCase();
    const list = map.get(key) || [];
    list.push(handoff.name);
    map.set(key, list);
  }
  return [...map.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([file, names]) => `${names.join(" and ")} both want ${file}`);
}

function QueueLine({ agents, activity, handoffs, live, settings }) {
  const rows = modelQueue(agents, activity, handoffs, live, settings);
  const clashes = sharedFiles(handoffs, activity);
  const holder = rows.find((row) => row.holding);
  const next = rows.find((row) => !row.holding);
  const shown = [holder, holder ? next : null].filter(Boolean);
  if (!shown.length && !clashes.length) return null;
  return (
    <>
      {shown.length > 0 && (
        <p className="model-queue">
          <span>Model</span>
          {shown.map((row, index) => (
            <span key={row.id} className="q-who">
              {index > 0 && <span className="q-dot">·</span>}
              <b>{row.name}</b>
              <span>{row.holding ? "now" : "next"}</span>
            </span>
          ))}
        </p>
      )}
      {clashes.map((line) => <p className="crew-clash" key={line}>{line}</p>)}
    </>
  );
}

function FileStrip({ files, agents, onOpen }) {
  if (!files?.length) return null;
  const seen = new Set();
  const rows = [];
  for (const file of files) {
    const key = `${file.agentId}|${file.path}`;
    if (!file.path || seen.has(key)) continue;
    seen.add(key);
    rows.push(file);
  }
  if (!rows.length) return null;
  return (
    <div className="file-strip">
      {rows.map((file) => (
        <button type="button" key={`${file.agentId}-${file.path}`} className="file-chip" onClick={() => onOpen(file)}>
          <AgentFace agent={resolveAgent(agents, file)} size="sm" />
          <span>{fileBase(file.path)}</span>
        </button>
      ))}
    </div>
  );
}

function CommandCards({ message, pending, onDecide }) {
  const stored = message.commands || [];
  const extra = (pending || []).filter((item) => item.status === "waiting" && !stored.some((card) => card.id === item.id));
  const cards = [...stored, ...extra];
  if (!cards.length) return null;
  return cards.map((item) => (
    <div className="cmd-card" key={item.id}>
      <code>{item.command}</code>
      {item.status === "waiting" ? (
        <span className="cmd-actions">
          <button type="button" className="btn" onClick={() => onDecide(item.id, true)}>Run</button>
          <button type="button" className="ghost" onClick={() => onDecide(item.id, true, false, true)}>Allow this</button>
          <button type="button" className="ghost" onClick={() => onDecide(item.id, true, true)}>Allow always</button>
          <button type="button" className="ghost" onClick={() => onDecide(item.id, false)}>Skip</button>
        </span>
      ) : (
        <span className="cmd-state">{item.status === "ran" ? "Ran" : "Skipped"}</span>
      )}
    </div>
  ));
}

function Message({ message, agent, live, activity, onApply, plan, agents, touches, onOpenFile, onDecide, pending, onPass, settings }) {
  const answer = (message.content || "").replace(/^\s+/, "");
  const thinking = (message.thinking || "").trim();
  const job = agentJob(agent);
  const parts = useMemo(() => splitMarkdown(answer), [answer]);
  const waiting = live && message.role === "assistant" && !answer && !thinking;

  if (message.role === "user") {
    if (message.passedFrom) {
      return (
        <div className="turn passed-in" style={{ "--task": message.passedFrom.color || "var(--amber)" }}>
          <div className="task-kicker">
            <AgentFace agent={resolveAgent(agents, message.passedFrom)} size="sm" />
            <span>Task from {message.passedFrom.name}</span>
          </div>
          <Fold id={message.id ? `fold:${message.id}` : ""} text={message.content} />
        </div>
      );
    }
    return (
      <div className="turn user">
        <div className="say">{message.content}</div>
        {message.images?.length > 0 && (
          <div className="shots sent">
            {message.images.map((url) => <img key={url.slice(-24)} src={url} alt="" />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="turn assistant" style={{ "--agent": agent?.color || "var(--amber)" }}>
      <div className="who">
        <AgentFace agent={agent} size="md" />
        <span className="who-copy">
          <b>{agent?.name || "Agent"}</b>
          {job && <small>{job}</small>}
        </span>
      </div>
      {(thinking || waiting) && (
        <RememberDetails id={message.id ? `think:${message.id}` : ""} className="think">
          <summary>{message.status || (waiting ? "Waiting for the model" : "Thinking")}</summary>
          {thinking && <p>{thinking}</p>}
        </RememberDetails>
      )}
      <QueueLine agents={agents} activity={activity} handoffs={message.handoffs} live={live} settings={settings} />
      {message.handoffs?.length > 0 && (
        <div className="crew-board">
          {message.handoffs.map((handoff, handoffIndex) => (
            <TaskCard key={`${handoff.id}-${handoff.agentId || handoff.name || handoffIndex}`} handoff={handoff} agents={agents} activity={activity} touches={touches} onOpen={onOpenFile} settled={!live} />
          ))}
        </div>
      )}
      <CommandCards message={message} pending={pending} onDecide={onDecide} />
      {answer && parts.map((part, i) =>
        part.type === "code" ? (
          <div className="code" key={i}>
            <header>
              <span>{part.lang || "code"}</span>
              <button className="ghost" onClick={() => onApply(part.code)}>Apply</button>
            </header>
            <pre>{part.code}</pre>
          </div>
        ) : (
          <Prose key={i} text={part.text} />
        )
      )}
      {live && message.status && message.status.length < 80 && <div className="status-line">{message.status}</div>}
      {message.sources?.length > 0 && (
        <div className="sources">
          {message.sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>
          ))}
        </div>
      )}
      <FileStrip files={message.files} agents={agents} onOpen={onOpenFile} />
      <StatLine stats={message.stats} live={message.liveStats} />
      {plan && (
        <div className="pass-row">
          {agents.filter((item) => item.id !== agent?.id).map((item) => (
            <button type="button" key={item.id} className="ghost" onClick={() => onPass(item.name)}>Pass to {item.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyBody({ text }) {
  const parts = useMemo(() => splitMarkdown(text), [text]);
  return parts.map((part, i) =>
    part.type === "code" ? (
      <pre className="task-code" key={i}>{part.code}</pre>
    ) : (
      <Prose key={i} text={part.text} />
    )
  );
}

function TaskCard({ handoff, agents = [], activity, touches, onOpen, settled }) {
  const owner = resolveAgent(agents, handoff);
  const reply = (handoff.reply || "").replace(/^\s+/, "");
  const thinking = (handoff.thinking || "").trim();
  const working = handoff.status === "working" && !settled;
  const failed = handoff.status === "error";
  const stopped = handoff.status === "stopped";
  const ended = !working && !failed && !stopped;
  const liveLine = working ? activity?.[owner.id] : "";
  const task = String(handoff.task || "").trim();
  const brief = oneLine(task, 160);
  const sentence = ended ? changedSentence(reply) : "";
  const file = workerFile(handoff, activity, touches);
  const fileName = file?.path ? fileBase(file.path) : "";
  const line = failed
    ? (handoff.note || "Failed")
    : stopped
      ? "Stopped"
      : working
        ? (liveLine || handoff.note || "Waiting for the model")
        : (fileName || agentJob(owner));
  const note = ended ? sentence : (working ? brief : "");
  const more = brief !== task || thinking || reply;
  const head = (
    <>
      <AgentFace agent={owner} size="sm" live={working && Boolean(liveLine)} />
      <span className="crew-copy">
        <b>{handoff.name}</b>
        {line && <span className={`crew-line${working ? " working" : ""}${failed ? " error" : ""}${ended && fileName ? " file" : ""}`} title={line}>{line}</span>}
        {note && <span className="crew-job" title={ended ? reply : task}>{note}</span>}
      </span>
    </>
  );
  return (
    <article className="crew-row" style={{ "--task": owner.color || handoff.color || "var(--amber)" }}>
      {more ? (
        <RememberDetails id={handoff.id ? `crew:${handoff.id}` : ""} className="crew-fold">
          <summary onClick={() => file && onOpen?.(file)}>{head}</summary>
          <div className="crew-more">
            {brief !== task && <Prose text={task} />}
            {thinking && <p className="crew-think">{thinking}</p>}
            {reply && <ReplyBody text={reply} />}
          </div>
        </RememberDetails>
      ) : (
        <div className="crew-static" onClick={() => file && onOpen?.(file)} role={file ? "button" : undefined}>{head}</div>
      )}
      {handoff.conflict && <p className="crew-clash">{fileBase(handoff.conflict)} was left alone. This folder already has edits there.</p>}
      <StatLine stats={handoff.stats} live={handoff.liveStats} />
    </article>
  );
}

function shownStats(stats, live) {
  if (!live) return stats;
  if (!stats) return live;
  const out = (stats.out || 0) + (live.out || 0);
  const weight = (stats.out || 0) + (live.out || 0);
  return {
    in: (stats.in || 0) + (live.in || 0),
    out,
    ms: (stats.ms || 0) + (live.ms || 0),
    tps: weight
      ? Math.round((((stats.tps || 0) * (stats.out || 0) + (live.tps || 0) * (live.out || 0)) / weight) * 10) / 10
      : live.tps || 0,
    approx: Boolean(stats.approx || live.approx),
  };
}

function StatLine({ stats, live }) {
  const row = shownStats(stats, live);
  if (!row || (!row.out && !row.tps && !row.ms)) return null;
  const bits = [];
  if (row.in) bits.push(`${row.in} in`);
  if (row.out) bits.push(`${row.approx ? "~" : ""}${row.out} tok`);
  if (row.tps) bits.push(`${row.tps} tok/s`);
  if (row.ms) bits.push(`${(row.ms / 1000).toFixed(1)}s`);
  return <div className="msg-stats">{bits.map((bit) => <span key={bit}>{bit}</span>)}</div>;
}

function Prose({ text }) {
  const blocks = useMemo(() => structureText(text), [text]);
  if (!blocks.length) return null;
  return (
    <div className="prose">
      {blocks.map((block, index) => {
        if (block.type === "h") return <h4 key={index}>{richText(block.text)}</h4>;
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{richText(item)}</li>)}
            </ul>
          );
        }
        return <p key={index}>{richText(block.text)}</p>;
      })}
    </div>
  );
}

function loosenPlan(text) {
  const label = "PROJECT GOAL|WORKER\\s*\\d+|OBJECTIVE|FILES ALLOWED|FILES FORBIDDEN|REQUIREMENTS|ACCEPTANCE|CONTEXT|RESULT|COMMANDS";
  return String(text || "")
    .replace(new RegExp(`\\s+(?=(?:${label})\\s*:)`, "gi"), "\n")
    .replace(new RegExp(`(?:^|\\s)(?=(?:${label})\\b)`, "gi"), "\n")
    .replace(/\s+(?=[-*]\s+)/g, "\n")
    .replace(/\s+(?=\([a-z]\)\s+)/gi, "\n")
    .replace(/^\n+/, "");
}

function structureText(text = "") {
  const blocks = [];
  text = loosenPlan(text);
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push({ type: "ul", items: list });
    list = [];
  };
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = headingText(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", text: heading });
      continue;
    }
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function headingText(line) {
  const markdown = line.match(/^#{1,3}\s+(.+)$/);
  if (markdown) return markdown[1].replace(/:$/, "");
  const plain = line.replace(/\*\*/g, "").trim();
  if (plain.length > 56 || plain.split(/\s+/).length > 8) return "";
  if (/:$/.test(plain)) return plain.replace(/:$/, "");
  if (plain === plain.toUpperCase() && /[A-Z]/.test(plain)) return plain;
  return "";
}

function richText(text = "") {
  const bits = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match;
  let index = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) bits.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) bits.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    else bits.push(<code key={index}>{token.slice(1, -1)}</code>);
    index += 1;
    last = match.index + token.length;
  }
  if (last < text.length) bits.push(text.slice(last));
  return bits;
}

function splitMarkdown(text = "") {
  const parts = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index).replace(/^\n+/, "") });
    parts.push({ type: "code", lang: match[1], code: match[2].replace(/\n$/, "") });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last).replace(/^\n+/, "") });
  return parts.filter((part) => part.type === "code" || part.text);
}
