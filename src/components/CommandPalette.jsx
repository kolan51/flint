import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../store.jsx";

function flattenFiles(nodes, into = []) {
  for (const node of nodes || []) {
    if (node.type === "dir") flattenFiles(node.children, into);
    else into.push(node);
  }
  return into;
}

export default function CommandPalette() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef(null);

  const commands = useMemo(() => [
    { label: "Open folder", hint: "Ctrl Shift O", run: () => app.openWorkspaceFolder() },
    { label: "Open files", hint: "Ctrl O", run: () => app.openLocalFiles() },
    { label: "Save file", hint: "Ctrl S", run: () => app.activePath && app.saveTab(app.activePath) },
    { label: "Settings", run: () => app.setModal("settings") },
    { label: "New agent", run: () => app.addAgent() },
    { label: "About Flint", run: () => app.setModal("about") },
    { label: app.theme === "light" ? "Use dark theme" : "Use light theme", run: () => app.toggleTheme() },
    {
      label: app.leftOpen && !app.chatFocus ? "Hide files" : "Show files",
      run: () => {
        app.setChatFocus(false);
        app.setLeftOpen((open) => !open);
      },
    },
    {
      label: app.rightOpen && !app.chatFocus ? "Hide chat" : "Show chat",
      run: () => {
        if (app.chatFocus) {
          app.setChatFocus(false);
          app.setRightOpen(false);
          return;
        }
        app.setRightOpen((open) => !open);
      },
    },
    { label: "Search the folder", hint: "/search", run: () => app.runSlash("search") },
    { label: "Review edits", hint: "/diff", run: () => app.runSlash("diff") },
    { label: "Terminal", hint: "/term", run: () => app.runSlash("term") },
    { label: "Problems", run: () => app.setDock("problems") },
    { label: "Notes", run: () => app.setDock("notes") },
    { label: "New chat", run: () => app.activeAgent && app.newSession(app.activeAgent.id) },
    { label: app.mode === "plan" ? "Act on files" : "Plan only", hint: app.mode === "plan" ? "/act" : "/plan", run: () => app.runSlash(app.mode === "plan" ? "act" : "plan") },
    { label: "Undo the last run", hint: "/undo", run: () => app.runSlash("undo") },
    ...flattenFiles(app.tree).map((file) => ({
      label: file.path,
      hint: "Open",
      run: () => app.openFile(file.path),
    })),
  ], [app]);

  const needle = query.trim().toLowerCase();
  const shown = commands.filter((command) => command.label.toLowerCase().includes(needle));
  const current = shown[Math.min(index, Math.max(shown.length - 1, 0))];

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  function choose(command) {
    app.setModal(null);
    command?.run();
  }

  return (
    <div className="modal-back palette-back" onPointerDown={(event) => { if (event.target === event.currentTarget) app.setModal(null); }}>
      <div className="palette" onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={input}
          value={query}
          placeholder="Search commands"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, shown.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(current);
            } else if (event.key === "Escape") {
              app.setModal(null);
            }
          }}
        />
        <div className="palette-list">
          {shown.map((command, i) => (
            <button
              type="button"
              key={command.label}
              className={command === current ? "on" : ""}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(command)}
            >
              <b>{command.label}</b>
              {command.hint && <kbd>{command.hint}</kbd>}
            </button>
          ))}
          {shown.length === 0 && <p>No matching command</p>}
        </div>
      </div>
    </div>
  );
}
