import React, { useEffect, useRef, useState } from "react";
import { useApp } from "../store.jsx";
import { desktop } from "../desktop.js";

function shortModel(model) {
  if (!model) return "";
  return String(model)
    .split(/[/\\]/)
    .pop()
    .replace(/\.gguf$/i, "")
    .replace(/^Qwen_/i, "")
    .replace(/[-_]Q\d.*$/i, "")
    .replace(/_/g, " ");
}

export default function TitleBar() {
  const {
    settings,
    persistSettings,
    setModal,
    models,
    refreshModels,
    openWorkspaceFolder,
    openRecent,
    workspaceRoot,
    backendStatus,
    leftOpen,
    rightOpen,
    chatFocus,
    setChatFocus,
    setLeftOpen,
    setRightOpen,
    theme,
    toggleTheme,
    busyAgent,
    narrow,
    mobileView,
    setMobileView,
  } = useApp();
  const providers = Object.values(settings?.providers || {});
  const live = backendStatus[settings?.activeProvider];
  const offline = Boolean(live && !live.ok);
  const activeProvider = providers.find((provider) => provider.id === settings?.activeProvider);
  const modelRows = [
    { section: true, label: "App model", value: "section:app" },
    ...providers.flatMap((provider) => {
    const status = backendStatus[provider.id];
    const listed = status?.models?.length
      ? status.models
      : (provider.id === settings?.activeProvider ? models : []);
    const unique = [...new Set(listed.filter(Boolean))];
    if (unique.length > 1) {
      return [
        { section: true, label: provider.name, value: `section:${provider.id}` },
        ...unique.map((model) => ({
          value: `${provider.id}::${model}`,
          label: shortModel(model),
          hint: model,
          match: provider.id === settings?.activeProvider && model === settings?.defaultModel,
        })),
      ];
    }
    const only = unique[0] || "";
    return [{
      value: `${provider.id}::${only}`,
      label: provider.name,
      hint: only ? shortModel(only) : (status && !status.ok ? "Offline" : ""),
      match: provider.id === settings?.activeProvider,
    }];
    }),
  ];
  const several = (live?.models?.length ? live.models : models).filter(Boolean).length > 1;
  const modelLabel = activeProvider
    ? (several && settings?.defaultModel ? `${activeProvider.name} · ${shortModel(settings.defaultModel)}` : activeProvider.name)
    : "Model";

  function chooseModel(token) {
    const [providerId, model = ""] = String(token).split("::");
    if (!providerId || providerId.startsWith("section:")) return;
    persistSettings({ ...settings, activeProvider: providerId, defaultModel: model });
    refreshModels(providerId);
  }

  return (
    <header
      className="titlebar"
      onDoubleClick={(event) => {
        if (event.target.closest("button, select, a, input, .picker")) return;
        desktop.toggleMaximize();
      }}
    >
      <div className="title-row">
      <button type="button" className="brand" title="About Flint" onClick={() => setModal("about")}>
        <img className="mark" src="/icon.png" alt="" />
        <b>Flint</b>
      </button>

      {providers.length > 0 && (
        <div className="switchers">
          <Picker
            label={offline ? "Offline" : modelLabel}
            ariaLabel={`App model, ${offline ? "offline" : modelLabel}`}
            title={offline ? "App model. This server is not answering." : `App model. Agents set to “Same as the app” use ${modelLabel}.`}
            value={modelRows.find((row) => row.match)?.value || ""}
            onChange={chooseModel}
            options={modelRows}
            dot={<span className={`pulse-dot ${live?.ok ? "on" : offline ? "off" : ""}`} />}
          />
          {busyAgent && <span className="busy-note">{busyAgent}</span>}
        </div>
      )}

      <div className="title-end">
        <nav className="toolbar">
          {!narrow && (
            <IconButton
              name="files"
              label={leftOpen ? "Hide files" : "Show files"}
              active={leftOpen && !chatFocus}
              onClick={() => {
                if (chatFocus) setChatFocus(false);
                setLeftOpen((open) => !open);
              }}
            />
          )}
          {!narrow && (
            <IconButton
              name="chat"
              label={rightOpen && !chatFocus ? "Hide chat" : "Show chat"}
              active={rightOpen && !chatFocus}
              onClick={() => {
                if (chatFocus) {
                  setChatFocus(false);
                  setRightOpen(false);
                  return;
                }
                setRightOpen((open) => !open);
              }}
            />
          )}
          <ProjectMenu
            current={workspaceRoot}
            recent={settings?.recent || []}
            onOpen={openWorkspaceFolder}
            onPick={openRecent}
          />
          <IconButton name="settings" label="Settings" onClick={() => setModal("settings")} />
          <IconButton
            name={theme === "light" ? "moon" : "sun"}
            label={theme === "light" ? "Dark theme" : "Light theme"}
            onClick={toggleTheme}
          />
        </nav>
        {desktop.isDesktop && <WindowControls />}
      </div>
      </div>
      {narrow && (
        <nav className="view-switch" aria-label="Show">
          {[
            ["files", "Files"],
            ["editor", "Editor"],
            ["chat", "Chat"],
          ].map(([id, label]) => (
            <button key={id} type="button" className={mobileView === id ? "on" : ""} onClick={() => setMobileView(id)}>
              {label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
}

function Picker({ label, value, options, onChange, dot, ariaLabel, title }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`picker ${open ? "open" : ""}`} ref={root}>
      <button type="button" aria-label={ariaLabel || label} aria-expanded={open} title={title || current?.hint || current?.label || label} onClick={() => setOpen((next) => !next)}>
        {dot}
        <span>{label}</span>
        <Caret />
      </button>
      {open && (
        <div className="picker-menu" role="listbox">
          {options.map((option) => (
            option.section ? (
              <div key={option.value} className="picker-label">{option.label}</div>
            ) : (
              <button
                type="button"
                key={`${option.value}:${option.label}`}
                className={option.value === value || option.match ? "on" : ""}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <b>{option.label}</b>
                {option.hint && option.hint !== option.label && <small>{option.hint}</small>}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function folderParts(folder) {
  const parts = String(folder || "").split(/[/\\]/).filter(Boolean);
  const name = parts.pop() || folder;
  return { name, parent: parts.slice(-2).join("\\") };
}

function ProjectMenu({ current, recent, onOpen, onPick }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const items = [];
  const seen = new Set();
  for (const folder of [current, ...(recent || [])]) {
    const key = String(folder || "").toLowerCase();
    if (!folder || seen.has(key)) continue;
    seen.add(key);
    items.push(folder);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`picker project-menu ${open ? "open" : ""}`} ref={root}>
      <button type="button" className="icon-btn" title="Projects" aria-label="Projects" aria-expanded={open} onClick={() => setOpen((next) => !next)}>
        <Icon name="folder" />
      </button>
      {open && (
        <div className="picker-menu align-end">
          <button type="button" onClick={() => { setOpen(false); onOpen(); }}>
            <b>Open folder</b>
            <small>Choose a project on this PC</small>
          </button>
          {items.length > 0 && <div className="picker-label">Recent</div>}
          {items.map((folder) => {
            const parts = folderParts(folder);
            const here = String(folder).toLowerCase() === String(current || "").toLowerCase();
            return (
              <button
                type="button"
                key={folder}
                className={here ? "on" : ""}
                onClick={() => { setOpen(false); if (!here) onPick(folder); }}
              >
                <b>{parts.name}</b>
                {parts.parent && <small>{parts.parent}</small>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconButton({ name, label, active, onClick }) {
  return (
    <button type="button" className={`icon-btn ${active ? "active" : ""}`} title={label} aria-label={label} onClick={onClick}>
      <Icon name={name} />
    </button>
  );
}

function Caret() {
  return (
    <svg className="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function Icon({ name }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "files") {
    return (
      <svg {...props}>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M6 2.5v11" />
      </svg>
    );
  }
  if (name === "editor") {
    return (
      <svg {...props}>
        <path d="M4 2.5h5l3 3V13.5H4z" />
        <path d="M9 2.5V5.5h3" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg {...props}>
        <path d="M3 3.5h10v7H6.2L3 12.8z" />
      </svg>
    );
  }
  if (name === "folder") {
    return (
      <svg {...props}>
        <path d="M2 4.5h4l1.2 1.4H14V12.5H2z" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg {...props}>
        <path d="M6.4 1.7h3.2l.4 1.5a4.8 4.8 0 0 1 1.2.7l1.5-.5 1.6 2.7-1.1 1a4.8 4.8 0 0 1 0 1.4l1.1 1-1.6 2.7-1.5-.5a4.8 4.8 0 0 1-1.2.7l-.4 1.5H6.4l-.4-1.5a4.8 4.8 0 0 1-1.2-.7l-1.5.5-1.6-2.7 1.1-1a4.8 4.8 0 0 1 0-1.4l-1.1-1 1.6-2.7 1.5.5a4.8 4.8 0 0 1 1.2-.7z" />
        <circle cx="8" cy="8" r="1.7" />
      </svg>
    );
  }
  if (name === "sun") {
    return (
      <svg {...props}>
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 2.2v1.5M8 12.3v1.5M2.2 8h1.5M12.3 8h1.5M4 4l1 1M11 11l1 1M12 4l-1 1M5 11l-1 1" />
      </svg>
    );
  }
  if (name === "moon") {
    return (
      <svg {...props}>
        <path d="M9.2 2.4a4.8 4.8 0 1 0 4.4 6.6A4.2 4.2 0 0 1 9.2 2.4z" />
      </svg>
    );
  }
  return null;
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => desktop.onWindow(setMaximized), []);

  return (
    <div className="window-controls">
      <button type="button" aria-label="Minimize" onClick={() => desktop.minimize()}>
        <span className="glyph min" />
      </button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} onClick={() => desktop.toggleMaximize().then(setMaximized)}>
        <span className={`glyph ${maximized ? "restore" : "max"}`} />
      </button>
      <button type="button" className="close" aria-label="Close" onClick={() => desktop.close()}>
        <span className="glyph x" />
      </button>
    </div>
  );
}
