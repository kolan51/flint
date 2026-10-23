import React, { useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { useApp } from "../store.jsx";
import { faceOf, resolveAgent } from "../faces.js";
import { api } from "../api.js";
import { desktop } from "../desktop.js";
import StudioDock from "./StudioDock.jsx";
import { Splitter } from "../panes.jsx";

const FONT_KEY = "flint.editorFont";
const FONT_BASE = 14;

function storedFont() {
  const size = Number(localStorage.getItem(FONT_KEY));
  if (!Number.isFinite(size)) return FONT_BASE;
  return Math.min(32, Math.max(10, Math.round(size)));
}

loader.init().then((monaco) => {
  monaco.editor.defineTheme("local-bot", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#10100e",
      "editor.foreground": "#efe6d6",
      "editorLineNumber.foreground": "#6d6456",
      "editorLineNumber.activeForeground": "#f4b860",
      "editorCursor.foreground": "#f4b860",
      "editor.lineHighlightBackground": "#181714",
      "editor.lineHighlightBorder": "#0000",
      "editor.selectionBackground": "#f4b86033",
      "editor.selectionHighlightBackground": "#f4b86022",
      "editor.wordHighlightBackground": "#f4b86018",
      "editor.inactiveSelectionBackground": "#f4b8601a",
      "editorGutter.background": "#10100e",
      "editorStickyScroll.background": "#141413",
      "editorStickyScroll.border": "#262420",
      "editorIndentGuide.background1": "#2a2824",
      "editorIndentGuide.activeBackground1": "#6d6456",
      "editorBracketPairGuide.background1": "#2a282466",
      "editorBracketPairGuide.activeBackground1": "#f4b86088",
      "editorGhostText.foreground": "#6d6456",
      "editorWidget.background": "#171613",
      "editorWidget.border": "#3d3424",
      "editorSuggestWidget.background": "#171613",
      "editorSuggestWidget.border": "#3d3424",
      "editorSuggestWidget.selectedBackground": "#2a2418",
      "editorSuggestWidget.highlightForeground": "#f4b860",
      "editorHoverWidget.background": "#171613",
      "editorHoverWidget.border": "#3d3424",
      "scrollbarSlider.background": "#4a433888",
      "scrollbarSlider.hoverBackground": "#6a5e4ecc",
      "scrollbarSlider.activeBackground": "#f4b86066",
      "editorOverviewRuler.border": "#0000",
    },
  });
  monaco.editor.defineTheme("local-bot-light", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f7f1e7",
      "editor.foreground": "#2a241c",
      "editorLineNumber.foreground": "#a89880",
      "editorLineNumber.activeForeground": "#c4892d",
      "editorCursor.foreground": "#c4892d",
      "editor.lineHighlightBackground": "#efe4d2",
      "editor.lineHighlightBorder": "#0000",
      "editor.selectionBackground": "#f4b86055",
      "editor.selectionHighlightBackground": "#f4b86033",
      "editor.wordHighlightBackground": "#f4b86028",
      "editor.inactiveSelectionBackground": "#f4b86022",
      "editorGutter.background": "#f7f1e7",
      "editorStickyScroll.background": "#fffaf3",
      "editorStickyScroll.border": "#e4d5c0",
      "editorIndentGuide.background1": "#e4d5c0",
      "editorIndentGuide.activeBackground1": "#b5a38c",
      "editorBracketPairGuide.background1": "#e4d5c088",
      "editorBracketPairGuide.activeBackground1": "#c4892d88",
      "editorGhostText.foreground": "#a89880",
      "editorWidget.background": "#fffaf3",
      "editorWidget.border": "#e4d0ae",
      "editorSuggestWidget.background": "#fffaf3",
      "editorSuggestWidget.border": "#e4d0ae",
      "editorSuggestWidget.selectedBackground": "#f6e7cf",
      "editorSuggestWidget.highlightForeground": "#8d5e12",
      "editorHoverWidget.background": "#fffaf3",
      "editorHoverWidget.border": "#e4d0ae",
      "scrollbarSlider.background": "#cbbba688",
      "scrollbarSlider.hoverBackground": "#b5a38ccc",
      "scrollbarSlider.activeBackground": "#c4892d66",
      "editorOverviewRuler.border": "#0000",
    },
  });
}).catch(() => {});

function baseName(filePath) {
  return String(filePath || "").split(/[/\\]/).pop();
}

function firstFiles(nodes, into = []) {
  for (const node of nodes || []) {
    if (into.length >= 6) break;
    if (node.type === "dir") firstFiles(node.children, into);
    else into.push(node);
  }
  return into;
}

export default function EditorPane() {
  const {
    tabs,
    activePath,
    activeTab,
    setActivePath,
    closeTab,
    updateTab,
    saveTab,
    openWorkspaceFolder,
    theme,
    tree,
    workspaceRoot,
    settings,
    setModal,
    openFile,
    refreshTree,
    ask,
    dock,
    pendingLine,
    setPendingLine,
    stageBuffer,
    activeAgentId,
    busy,
    reviews,
    agents,
    previewOpen,
    setPreviewOpen,
  } = useApp();
  const [inline, setInline] = useState(false);
  const [inlineText, setInlineText] = useState("");
  const [fontSize, setFontSize] = useState(storedFont);
  const [zoomHint, setZoomHint] = useState(0);
  const [editorReady, setEditorReady] = useState(0);
  const [liveUrl, setLiveUrl] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const lspTimer = useRef(0);
  const fontRef = useRef(fontSize);
  const hintTimer = useRef(0);
  const rememberFontRef = useRef(() => {});
  const pathRef = useRef(activePath);
  const tabRef = useRef(activeTab);
  const agentRef = useRef(activeAgentId);
  const busyRef = useRef(busy);
  const completeRef = useRef(true);
  pathRef.current = activePath;
  tabRef.current = activeTab;
  agentRef.current = activeAgentId;
  busyRef.current = busy;
  completeRef.current = settings?.completion?.enabled !== false;
  completeGate.current = completeRef.current;

  function rememberFont(next) {
    const size = Math.min(32, Math.max(10, Math.round(next)));
    if (size !== fontRef.current) {
      fontRef.current = size;
      localStorage.setItem(FONT_KEY, String(size));
      setFontSize(size);
    }
    setZoomHint(size);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setZoomHint(0), 700);
  }
  rememberFontRef.current = rememberFont;

  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  useEffect(() => desktop.onMenu((action) => {
    if (action === "zoomIn") rememberFontRef.current(fontRef.current + 1);
    if (action === "zoomOut") rememberFontRef.current(fontRef.current - 1);
    if (action === "zoomReset") rememberFontRef.current(FONT_BASE);
  }), []);

  useEffect(() => {
    function onWheel(event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
    }
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (desktop.isDesktop) return undefined;
    function onKey(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key;
      if (key === "+" || key === "=") {
        event.preventDefault();
        rememberFontRef.current(fontRef.current + 1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        rememberFontRef.current(fontRef.current - 1);
      } else if (key === "0" && !event.shiftKey) {
        event.preventDefault();
        rememberFontRef.current(FONT_BASE);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!activePath) return undefined;
    let stop = false;
    async function pull() {
      const data = await api.problems().catch(() => ({ problems: [] }));
      if (stop) return;
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      const model = editor?.getModel();
      if (!monaco || !model) return;
      const same = String(activePath).replaceAll("\\", "/");
      const mine = (data.problems || []).filter((item) => String(item.path).replaceAll("\\", "/") === same);
      const markers = mine.map((item) => ({
        severity: item.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: item.source ? `${item.source}: ${item.message}` : item.message,
        startLineNumber: item.line,
        startColumn: item.column || 1,
        endLineNumber: item.line,
        endColumn: Math.max((item.column || 1) + 1, 2),
      }));
      monaco.editor.setModelMarkers(model, "pyright", []);
      monaco.editor.setModelMarkers(model, "flint", markers);
    }
    pull();
    const timer = setInterval(pull, 2500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [activePath, activeTab?.language, activeTab?.content]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return undefined;
    const same = String(activePath || "").replaceAll("\\", "/");
    const open = (reviews || []).filter((item) => item.status === "open" && String(item.path || "").replaceAll("\\", "/") === same);
    const maxLine = model.getLineCount();
    const decorations = [];
    const faces = new Map();
    for (const item of open) {
      const owner = resolveAgent(agents, item);
      const mark = faceOf(owner).emoji || "•";
      const cls = `rf-${[...mark].map((ch) => ch.codePointAt(0).toString(16)).join("")}`;
      faces.set(cls, mark);
      const hunks = item.hunks?.length ? item.hunks : [{ line: 1, patch: String(item.patch || "").slice(0, 240) }];
      for (const hunk of hunks) {
        const line = Math.min(maxLine, Math.max(1, Number(hunk.line) || 1));
        const note = String(hunk.patch || item.patch || "").split("\n").filter(Boolean).slice(0, 6).join("\n");
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: "review-line",
            glyphMarginClassName: `review-face ${cls}`,
            glyphMarginHoverMessage: { value: `${owner.name || item.agent || "Worker"}\n\n${note}` },
            overviewRuler: {
              color: item.color || owner.color || "#f4b860",
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      }
    }
    let style = document.getElementById("review-faces");
    if (!style) {
      style = document.createElement("style");
      style.id = "review-faces";
      document.head.appendChild(style);
    }
    style.textContent = [...faces].map(([cls, mark]) => `.monaco-editor .${cls}::before{content:"${String(mark).replace(/["\\]/g, "")}"}`).join("\n");
    editor.updateOptions({ glyphMargin: open.length > 0, overviewRulerLanes: open.length ? 1 : 0 });
    const collection = editor.createDecorationsCollection(decorations);
    return () => collection.clear();
  }, [reviews, activePath, activeTab?.content, agents, editorReady]);

  useEffect(() => {
    if (!pendingLine || pendingLine.path !== activePath) return;
    const editor = editorRef.current;
    if (!editor) return;
    const line = Number(pendingLine.line) || 1;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    setPendingLine(null);
  }, [pendingLine, activePath, activeTab?.content, setPendingLine]);

  function onMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorReady((n) => n + 1);
    registerLocalWords(monaco);
    editor.addAction({
      id: "local-bot-save",
      label: "Save file",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => saveTab(pathRef.current),
    });
    monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, {
      provideInlineCompletions(model, position, _context, token) {
        if (!completeRef.current) return { items: [] };
        const ghost = localGhost(model, position);
        const local = ghost ? { items: [{ insertText: ghost }] } : { items: [] };
        if (busyRef.current === "chat") return local;
        const line = model.getLineContent(position.lineNumber);
        const typed = line.slice(0, Math.max(0, position.column - 1));
        if (typed.trim().length < 2) return local;
        return new Promise((resolve) => {
          const ctrl = new AbortController();
          let settled = false;
          const finish = (items) => {
            if (settled) return;
            settled = true;
            resolve(items);
          };
          const timer = setTimeout(async () => {
            if (ctrl.signal.aborted || busyRef.current === "chat") {
              finish(local);
              return;
            }
            try {
              const before = model.getValueInRange({
                startLineNumber: Math.max(1, position.lineNumber - 8),
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              });
              const endLine = Math.min(model.getLineCount(), position.lineNumber + 4);
              const after = model.getValueInRange({
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: endLine,
                endColumn: model.getLineMaxColumn(endLine),
              });
              const data = await api.complete({
                before: before.slice(-600),
                after: after.slice(0, 240),
                language: model.getLanguageId(),
                agentId: agentRef.current,
              }, ctrl.signal);
              if (ctrl.signal.aborted) {
                finish({ items: [] });
                return;
              }
              const text = String(data.text || "").replace(/^\s+/, "").split("\n")[0].slice(0, 160);
              finish(text ? { items: [{ insertText: text }] } : local);
            } catch {
              finish(local);
            }
          }, 700);
          token.onCancellationRequested(() => {
            clearTimeout(timer);
            ctrl.abort();
            finish({ items: [] });
          });
        });
      },
      freeInlineCompletions() {},
    });
    const zoomWatch = editor.onDidChangeConfiguration((event) => {
      if (!event.hasChanged(monaco.editor.EditorOption.fontSize)) return;
      const size = Math.round(editor.getOption(monaco.editor.EditorOption.fontSize));
      if (size !== fontRef.current) rememberFontRef.current(size);
    });
    editor.onDidDispose(() => zoomWatch.dispose());
    editor.addAction({
      id: "flint-inline",
      label: "Edit selection",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
      run: (ed) => {
        const selection = ed.getModel()?.getValueInRange(ed.getSelection()) || "";
        if (!selection.trim()) return;
        setInline(true);
        setInlineText("");
      },
    });
  }

  async function applyInline(event) {
    event.preventDefault();
    const editor = editorRef.current;
    const model = editor?.getModel();
    const sel = editor?.getSelection();
    if (!model || !sel || !inlineText.trim()) return;
    const selection = model.getValueInRange(sel);
    const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: sel.startLineNumber, endColumn: sel.startColumn });
    const after = model.getValueInRange({
      startLineNumber: sel.endLineNumber,
      startColumn: sel.endColumn,
      endLineNumber: model.getLineCount(),
      endColumn: model.getLineMaxColumn(model.getLineCount()),
    });
    const data = await api.inline({
      agentId: activeAgentId,
      instruction: inlineText,
      selection,
      before: before.slice(-1500),
      after: after.slice(0, 1500),
      language: tabRef.current?.language,
    });
    await stageBuffer(pathRef.current, `${before}${data.replacement ?? ""}${after}`);
    setInline(false);
    setInlineText("");
  }

  const lineHeight = Math.round(fontSize * 1.6);
  if (activeTab?.language === "python") activePythonPath = activePath;
  const showPreview = Boolean(activeTab) && previewOpen && (
    Boolean(liveUrl || projectUrl) || /\.(html?|md|svg)$/i.test(activeTab.path)
  );

  return (
    <main className="center">
      {tabs.length > 0 && <div className="tabs">
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab ${tab.path === activePath ? "active" : ""}`}>
            <button className="tab" title={tab.path} onClick={() => setActivePath(tab.path)}>
              {baseName(tab.path)}{tab.dirty ? " •" : ""}{tab.diskNewer ? " · disk" : ""}
            </button>
            <button className="x" onClick={() => closeTab(tab.path)} aria-label={`Close ${tab.path}`}>×</button>
          </div>
        ))}
        {activeTab && (
          <div className="tab-tools">
            <button
              type="button"
              className={`tab-icon ${previewOpen ? "on" : ""}`}
              title={previewOpen ? "Editor" : "Preview"}
              aria-label={previewOpen ? "Editor" : "Preview"}
              onClick={() => setPreviewOpen((open) => !open)}
            >
              {previewOpen ? <TabGlyph name="code" /> : <TabGlyph name="preview" />}
            </button>
            <button
              type="button"
              className={`tab-icon ${liveUrl ? "on" : ""}`}
              title="Live"
              aria-label="Live"
              onClick={async () => {
                if (!/\.(html?|svg)$/i.test(activeTab.path)) {
                  setLiveUrl("");
                  setProjectUrl("");
                  setPreviewOpen(true);
                  return;
                }
                const data = await api.startPreview();
                setProjectUrl("");
                setLiveUrl(data.url || "");
                setPreviewOpen(true);
              }}
            >
              <TabGlyph name="live" />
            </button>
            <button
              type="button"
              className={`tab-icon ${projectUrl ? "on" : ""}`}
              title="App"
              aria-label="App"
              onClick={async () => {
                const data = await api.startProject();
                if (data.url) setProjectUrl(data.url);
                setPreviewOpen(true);
                if (!data.url) {
                  const timer = setInterval(async () => {
                    const status = await api.projectStatus();
                    if (status.url) {
                      setProjectUrl(status.url);
                      clearInterval(timer);
                    }
                  }, 1000);
                  setTimeout(() => clearInterval(timer), 20000);
                }
              }}
            >
              <TabGlyph name="app" />
            </button>
            {activeTab.dirty && (
              <button type="button" className="tab-icon" title="Save" aria-label="Save" onClick={() => saveTab(activePath)}>
                <TabGlyph name="save" />
              </button>
            )}
          </div>
        )}
      </div>}
      {activeTab && busy === "chat" && settings?.completion?.enabled !== false && (
        <p className="ghost-note">
          {settings?.completion?.baseUrl && settings?.completion?.model
            ? "Ghost text is paused while a chat is running."
            : "Ghost text uses the crew model, so it waits while a chat is running."}
        </p>
      )}
      {inline && activeTab && (
        <form className="inline-bar" onSubmit={applyInline}>
          <input
            value={inlineText}
            onChange={(event) => setInlineText(event.target.value)}
            placeholder="Describe the change to the selection"
            autoFocus
          />
          <button className="btn" type="submit">Edit</button>
          <button className="ghost" type="button" onClick={() => setInline(false)}>Cancel</button>
        </form>
      )}
      {activeTab ? (
        <div className={`editor-host ${showPreview ? "with-preview" : ""}`}>
        {showPreview && <Splitter name="preview" />}
        <Editor
          theme={theme === "light" ? "local-bot-light" : "local-bot"}
          path={activeTab.path}
          language={activeTab.language}
          value={activeTab.content}
          onMount={onMount}
          onChange={(value) => {
            const next = value ?? "";
            updateTab(activePath, next);
            if (activeTab.language === "python") {
              clearTimeout(lspTimer.current);
              lspTimer.current = setTimeout(() => {
                api.lspSync({ path: pathRef.current, text: next }).catch(() => {});
              }, 500);
            }
          }}
          options={{
            fontFamily: "Geist Mono, Cascadia Mono, ui-monospace, monospace",
            fontLigatures: true,
            fontSize,
            lineHeight,
            letterSpacing: 0.2,
            cursorSmoothCaretAnimation: "on",
            cursorBlinking: "smooth",
            cursorWidth: 2,
            cursorStyle: "line",
            roundedSelection: true,
            mouseWheelZoom: true,
            smoothScrolling: true,
            scrollBeyondLastLine: true,
            padding: { top: 18, bottom: 28 },
            renderLineHighlight: "all",
            renderLineHighlightOnlyWhenFocus: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: "active", indentation: true, highlightActiveIndentation: true },
            matchBrackets: "always",
            stickyScroll: { enabled: true },
            renderWhitespace: "selection",
            occurrencesHighlight: "singleFile",
            selectionHighlight: true,
            folding: true,
            foldingHighlight: true,
            showFoldingControls: "mouseover",
            glyphMargin: false,
            lineNumbersMinChars: 3,
            minimap: { enabled: false },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            suggestFontSize: fontSize,
            suggestLineHeight: Math.round(fontSize * 1.45),
            quickSuggestions: settings?.completion?.enabled !== false,
            suggestOnTriggerCharacters: settings?.completion?.enabled !== false,
            wordBasedSuggestions: settings?.completion?.enabled !== false ? "currentDocument" : "off",
            inlineSuggest: { enabled: settings?.completion?.enabled !== false },
            automaticLayout: true,
          }}
        />
        {showPreview && (
          <PreviewPane path={activeTab.path} content={activeTab.content} liveUrl={liveUrl} projectUrl={projectUrl} />
        )}
        </div>
      ) : (
        <StartScreen
          workspaceRoot={workspaceRoot}
          tree={tree}
          hasModels={Object.keys(settings?.providers || {}).length > 0}
          onOpenFolder={openWorkspaceFolder}
          onModels={() => setModal("settings")}
          onNewFile={() => createFolderItem("file", ask, refreshTree, openFile)}
          onNewFolder={() => createFolderItem("dir", ask, refreshTree, openFile)}
        />
      )}
      {dock && <Splitter name="dock" />}
      {dock && <StudioDock />}
      {zoomHint > 0 && <div className="zoom-hint" aria-live="polite">{zoomHint}</div>}
    </main>
  );
}

function TabGlyph({ name }) {
  const props = {
    width: 15,
    height: 15,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "code") {
    return (
      <svg {...props}>
        <path d="M6 4.2 2.8 8 6 11.8" />
        <path d="M10 4.2 13.2 8 10 11.8" />
      </svg>
    );
  }
  if (name === "preview") {
    return (
      <svg {...props}>
        <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4" />
        <path d="M8 3.2v9.6" />
      </svg>
    );
  }
  if (name === "live") {
    return (
      <svg {...props}>
        <circle cx="8" cy="8" r="2" />
        <path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6" />
        <path d="M3.3 3.4a6.4 6.4 0 0 0 0 9.2M12.7 3.4a6.4 6.4 0 0 1 0 9.2" />
      </svg>
    );
  }
  if (name === "app") {
    return (
      <svg {...props}>
        <path d="M6 4.2v7.6L12.2 8 6 4.2z" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M4 8.2 6.6 11 12 5" />
    </svg>
  );
}

function PreviewPane({ path, content, liveUrl, projectUrl }) {
  const web = /\.(html?|svg)$/i.test(path);
  if (projectUrl) {
    return <iframe className="preview-frame" title="App" sandbox="allow-scripts allow-same-origin allow-forms" src={projectUrl} />;
  }
  if (liveUrl && web) {
    return <iframe className="preview-frame" title="Live preview" sandbox="allow-scripts allow-same-origin allow-forms" src={`${liveUrl}/${path}`} />;
  }
  const html = /\.md$/i.test(path)
    ? markdownPage(content || "")
    : `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#10100e;color:#efe6d6;font:13px/1.55 "Geist Mono",ui-monospace,monospace;white-space:pre-wrap}</style></head><body>${escapeHtml(content || "")}</body></html>`;
  return <iframe className="preview-frame" title="Preview" sandbox="" srcDoc={html} />;
}

function markdownPage(source) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:28px 32px;background:#f7f1e7;color:#2a241c;font:16px/1.6 "Geist Sans",sans-serif}
    pre{background:#2a241c;color:#f7f1e7;padding:12px 14px;border-radius:8px;overflow:auto}
    code{font-family:"Geist Mono",ui-monospace,monospace;font-size:.9em}
    a{color:#8a5a12}
    h1,h2,h3{line-height:1.25}
  </style></head><body>${renderMarkdown(source)}</body></html>`;
}

function renderMarkdown(source) {
  const fences = [];
  const text = String(source || "").replace(/```[\w-]*\n([\s\S]*?)```/g, (_all, code) => {
    fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n@@FENCE${fences.length - 1}@@\n`;
  });
  const lines = escapeHtml(text).split(/\n/);
  const out = [];
  let list = false;
  for (const raw of lines) {
    const fence = raw.match(/@@FENCE(\d+)@@/);
    if (fence) {
      if (list) { out.push("</ul>"); list = false; }
      out.push(fences[Number(fence[1])] || "");
      continue;
    }
    const line = raw
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
    if (/^### /.test(line)) { if (list) { out.push("</ul>"); list = false; } out.push(`<h3>${line.slice(4)}</h3>`); continue; }
    if (/^## /.test(line)) { if (list) { out.push("</ul>"); list = false; } out.push(`<h2>${line.slice(3)}</h2>`); continue; }
    if (/^# /.test(line)) { if (list) { out.push("</ul>"); list = false; } out.push(`<h1>${line.slice(2)}</h1>`); continue; }
    if (/^[-*] /.test(line)) {
      if (!list) { out.push("<ul>"); list = true; }
      out.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (list) { out.push("</ul>"); list = false; }
    if (!line.trim()) { out.push(""); continue; }
    out.push(`<p>${line}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

function localGhost(model, position) {
  const line = model.getLineContent(position.lineNumber);
  const typed = line.slice(0, Math.max(0, position.column - 1));
  const prefix = typed.match(/[A-Za-z_][A-Za-z0-9_]*$/);
  if (!prefix || prefix[0].length < 2) return "";
  const word = prefix[0];
  const counts = new Map();
  const pattern = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
  const source = model.getValue();
  let found;
  while ((found = pattern.exec(source))) {
    const token = found[0];
    if (token.length <= word.length || !token.startsWith(word)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [token, count] of counts) {
    if (count > bestCount || (count === bestCount && token.length < best.length)) {
      best = token;
      bestCount = count;
    }
  }
  return best.slice(word.length);
}

let localWordsReady = false;
let activePythonPath = "";
const completeGate = { current: true };

function registerLocalWords(monaco) {
  if (localWordsReady) return;
  localWordsReady = true;
  const ts = monaco.languages.typescript;
  if (ts?.javascriptDefaults) {
    ts.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      allowNonTsExtensions: true,
      target: ts.ScriptTarget.ESNext,
    });
    ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  }
  for (const language of ["go", "rust", "java", "markdown", "plaintext", "css", "html"]) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [".", "_"],
      provideCompletionItems(model, position) {
        if (!completeGate.current) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        if (!word.word || word.word.length < 2) return { suggestions: [] };
        const words = new Set(String(model.getValue()).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };
        return {
          suggestions: [...words]
            .filter((item) => item.startsWith(word.word) && item !== word.word)
            .slice(0, 24)
            .map((item) => ({
              label: item,
              kind: monaco.languages.CompletionItemKind.Text,
              insertText: item,
              range,
            })),
        };
      },
    });
  }
  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: [".", "_"],
    async provideCompletionItems(model, position) {
      if (!completeGate.current) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      };
      let items = [];
      try {
        const data = await api.lspComplete({
          path: activePythonPath,
          text: model.getValue(),
          line: position.lineNumber,
          column: position.column,
        });
        items = data.items || [];
      } catch {
        items = [];
      }
      if (!items.length) {
        const words = new Set(String(model.getValue()).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []);
        return {
          suggestions: [...words].filter((item) => word.word && item.startsWith(word.word) && item !== word.word).slice(0, 24).map((item) => ({
            label: item,
            kind: monaco.languages.CompletionItemKind.Text,
            insertText: item,
            range,
          })),
        };
      }
      return {
        suggestions: items.filter((item) => item.label).slice(0, 40).map((item) => ({
          label: item.label,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: item.insert || item.label,
          detail: item.detail,
          range,
          sortText: "0",
        })),
      };
    },
  });
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function createFolderItem(kind, ask, refreshTree, openFile) {
  const name = await ask({
    title: kind === "dir" ? "New folder" : "New file",
    body: "Path in this folder",
    input: true,
    value: "",
    confirm: "Create",
  });
  if (!name) return;
  await api.newFile(name, kind);
  await refreshTree();
  if (kind === "file") openFile(String(name).replaceAll("\\", "/"));
}

function StartScreen({ workspaceRoot, tree, hasModels, onOpenFolder, onModels, onNewFile, onNewFolder }) {
  const folder = workspaceRoot ? baseName(workspaceRoot) : "";
  const files = firstFiles(tree);
  return (
    <div className="start">
      <div className="start-card">
        <img className="empty-mark" src="/icon.png" alt="" />
        <h1>Flint</h1>
        <p>{folder ? folder : "Open a folder to start."}</p>
        {!folder && (
          <button type="button" className="start-row" onClick={onOpenFolder}>
            <b>Open folder</b>
            <span>Pick a project on this PC</span>
          </button>
        )}
        {folder && !files.length && (
          <>
            <p className="start-quiet">This folder has no files yet.</p>
            <div className="start-make">
              <button type="button" onClick={onNewFile}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8h5.4L12.2 5.2V14.2H3.5z" /><path d="M8.6 1.8v3.4h3.4" /><path d="M8 8.2v4M6 10.2h4" /></svg>
                <span>New file</span>
              </button>
              <button type="button" onClick={onNewFolder}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.2h4.2l1.1 1.3H14.4v7.1H1.6z" /><path d="M8 7.6v3.6M6.2 9.4h3.6" /></svg>
                <span>New folder</span>
              </button>
            </div>
          </>
        )}
        {folder && files.length > 0 && <p className="start-quiet">Pick a file on the left.</p>}
        {!hasModels && (
          <button type="button" className="start-row" onClick={onModels}>
            <b>Add a model</b>
            <span>Point Flint at a server you already run</span>
          </button>
        )}
      </div>
    </div>
  );
}
