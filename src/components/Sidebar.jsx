import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AgentFace from "./AgentFace.jsx";
import { FACES, agentJob, catalogFace, defaultFace, isImageFace } from "../faces.js";
import { useApp } from "../store.jsx";
import { Splitter, usePanes } from "../panes.jsx";
import { api } from "../api.js";
import { desktop, joinPath } from "../desktop.js";

function fileKind(name) {
  const ext = String(name).split(".").pop()?.toLowerCase() || "";
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return "code";
  if (ext === "json") return "json";
  if (["css", "scss"].includes(ext)) return "style";
  if (["md", "txt"].includes(ext)) return "doc";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "py") return "py";
  if (ext === "html") return "html";
  return "file";
}

function Chevron({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d={open ? "M4 6.2 8 10.2 12 6.2" : "M6.2 4 10.2 8 6.2 12"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TreeGlyph({ name, dir, open }) {
  if (dir) {
    return (
      <svg className={`tree-glyph folder ${open ? "open" : ""}`} width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.8 4.2h4.1l1.2 1.4H14.2v7.2H1.8z" fill="currentColor" opacity="0.9" />
      </svg>
    );
  }
  return (
    <svg className={`tree-glyph ${fileKind(name)}`} width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5.2L12.8 5.4V14.2H4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 1.8v3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function MenuIcon({ name }) {
  const props = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true };
  if (name === "file") {
    return <svg {...props}><path d="M3.4 1.8h5.2L12.2 5.2V14.2H3.4z" /><path d="M8.4 1.8v3.4h3.4" /><path d="M8 8.4v3.4M6.3 10.1h3.4" /></svg>;
  }
  if (name === "folder") {
    return <svg {...props}><path d="M1.6 4.2h4l1.1 1.3H14.4v6.9H1.6z" /><path d="M8 7.8v3.2M6.4 9.4h3.2" /></svg>;
  }
  if (name === "copy") return <svg {...props}><rect x="5.2" y="4.2" width="7.2" height="8.4" rx="1.2" /><path d="M3.6 10.4V3.4h6.2" /></svg>;
  if (name === "reveal") return <svg {...props}><path d="M2.2 8.2 6.2 4.2h3.2v3.2l-4 4z" /><path d="M8.6 3.4h4v4" /><path d="M12.4 3.6 7.2 8.8" /></svg>;
  if (name === "rename") return <svg {...props}><path d="M3 13h2.4L13 5.4a1.6 1.6 0 0 0-2.3-2.3L3.1 10.6z" /><path d="M9.4 4.4l2.2 2.2" /></svg>;
  if (name === "trash") return <svg {...props}><path d="M3 4.2h10" /><path d="M6.2 4.2V3h3.6v1.2" /><path d="M4.6 4.2l.6 8.6h5.6l.6-8.6" /></svg>;
  return <svg {...props}><path d="M3.2 2.4h6.2L12.8 6v7.6H3.2z" /><path d="M9.2 2.4V6h3.4" /></svg>;
}

function MenuItem({ icon, danger, onClick, children }) {
  return (
    <button type="button" role="menuitem" className={danger ? "danger" : ""} onClick={onClick}>
      <MenuIcon name={icon} />
      <span>{children}</span>
    </button>
  );
}

function parentDir(node) {
  if (!node) return "";
  if (node.type === "dir") return node.path;
  const cut = node.path.lastIndexOf("/");
  return cut < 0 ? "" : node.path.slice(0, cut);
}

function FileNode({ node, depth, closed, toggle, onMenu, activePath, openFile }) {
  const isDir = node.type === "dir";
  const open = !isDir || !closed[node.path];
  return (
    <div>
      <div
        className={`tree-row${activePath === node.path ? " on" : ""}${isDir ? " is-dir" : ""}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onContextMenu={(event) => onMenu(event, node)}
      >
        <button
          type="button"
          className="twist"
          aria-label={isDir ? (open ? `Collapse ${node.name}` : `Expand ${node.name}`) : undefined}
          tabIndex={isDir ? 0 : -1}
          onClick={() => isDir && toggle(node.path)}
        >
          {isDir && <Chevron open={open} />}
        </button>
        <button
          type="button"
          className="tree-hit"
          title={node.path}
          onClick={() => (isDir ? toggle(node.path) : openFile(node.path))}
        >
          <TreeGlyph name={node.name} dir={isDir} open={open} />
          <span>{node.name}</span>
        </button>
      </div>
      {open && (node.children || []).map((child) => (
        <FileNode
          key={child.path}
          node={child}
          depth={depth + 1}
          closed={closed}
          toggle={toggle}
          onMenu={onMenu}
          activePath={activePath}
          openFile={openFile}
        />
      ))}
    </div>
  );
}

function cropFace(file, onReady) {
  if (!file || !String(file.type || "").startsWith("image/")) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    URL.revokeObjectURL(url);
    onReady(canvas.toDataURL("image/jpeg", 0.72));
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function FaceMenu({ agent, onChoose, onClose }) {
  const fileRef = useRef(null);
  const picked = catalogFace(agent.avatar);
  const shownId = picked?.id || (agent.avatar ? "" : defaultFace(agent).id);
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="face-back" onMouseDown={onClose}>
      <div
        className="face-pop"
        role="dialog"
        aria-label={`Icon for ${agent.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="face-pop-title">{agent.name}</p>
        <div className="face-pick">
          {FACES.map((face) => (
            <button
              type="button"
              key={face.id}
              className={shownId === face.id && !isImageFace(agent.avatar) ? "on" : ""}
              aria-label={face.label}
              onClick={() => onChoose(face.id)}
            >
              <img src={face.src} alt="" />
            </button>
          ))}
        </div>
        <button type="button" className="face-pop-pic" onClick={() => fileRef.current?.click()}>Use a picture</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            cropFace(event.target.files?.[0], onChoose);
            event.target.value = "";
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

function agentLive(action, title) {
  if (["Waiting", "Done", "Queued", "Failed", "Stopped"].includes(action)) return false;
  return Boolean(title) || Boolean(action);
}

function statusLine(action, job) {
  if (action === "Done") return "Done";
  if (action === "Queued") return "Queued";
  if (action === "Waiting") return "Waiting";
  if (action) return action;
  if (job) return "Waiting for the model";
  return "";
}

function shortModel(model) {
  return String(model || "").split(/[/\\]/).pop().replace(/\.gguf$/i, "").replace(/^Qwen_/i, "").replace(/[-_]Q\d.*$/i, "").replace(/_/g, " ");
}

function usesAppModel(agent, settings) {
  const model = String(agent?.model || "");
  const app = String(settings?.defaultModel || "");
  if (!model) return true;
  return Boolean(app) && model === app;
}

function agentSubtitle(agent, activity, tasks, faults, settings) {
  if (activity[agent.id] === "Failed") return faults[agent.id] || "Failed";
  const live = statusLine(activity[agent.id], tasks[agent.id]);
  if (live && live !== "Done" && live !== "Stopped") return live;
  if (!usesAppModel(agent, settings)) return shortModel(agent.model);
  return agentJob(agent) || "Ready";
}

export default function Sidebar() {
  const { agents, activeAgentId, setActiveAgentId, setRightPanel, setModal, addAgent, persistAgents, tree, refreshTree, openWorkspaceFolder, openRecent, settings, workspaceRoot, activity, tasks, faults, followed, touches, openFile, ask, activePath, renamePath, deletePath, narrow, setMobileView } = useApp();
  const panes = usePanes();
  const folderName = workspaceRoot ? String(workspaceRoot).split(/[/\\]/).filter(Boolean).pop() : "Workspace";
  const recent = (settings?.recent || []).filter((item) => item.replace(/[\\/]+$/g, "").toLowerCase() !== String(workspaceRoot || "").replace(/[\\/]+$/g, "").toLowerCase());
  const [closed, setClosed] = useState({});
  const [menu, setMenu] = useState(null);
  const [faceMenu, setFaceMenu] = useState(null);

  useEffect(() => {
    if (!menu) return undefined;
    function close() { setMenu(null); }
    function onKey(event) { if (event.key === "Escape") close(); }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  function toggle(path) {
    setClosed((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function openMenu(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const width = 196;
    const height = target?.recent ? 132 : 248;
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      target,
    });
  }

  async function copyText(text) {
    const value = String(text || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      await ask({ title: "Copy", body: value, confirm: "OK" });
    }
  }

  async function createItem(kind, base) {
    const folder = base || "";
    const title = kind === "dir" ? "New folder" : "New file";
    const name = await ask({
      title,
      body: "Path in this folder",
      input: true,
      value: folder ? `${folder}/` : "",
      confirm: "Create",
    });
    if (!name) return;
    await api.newFile(name, kind);
    await refreshTree();
    if (kind === "file") openFile(name.replaceAll("\\", "/"));
  }

  async function renameNode(node) {
    const next = await ask({ title: "Rename", body: "New path", input: true, value: node.path, confirm: "Rename" });
    if (!next || next === node.path) return;
    await renamePath(node.path, next);
  }

  async function removeNode(node) {
    const kind = node.type === "dir" ? "folder" : "file";
    const ok = await ask({ title: `Delete ${kind}`, body: node.path, confirm: "Delete", danger: true });
    if (!ok) return;
    await deletePath(node.path);
  }

  function fullPath(rel) {
    if (!rel) return workspaceRoot || "";
    return joinPath(workspaceRoot || "", rel);
  }

  return (
    <aside className="sidebar">
      <div className="section agents-section" style={{ height: panes?.sizes.agents || 280 }}>
        <div className="section-head">
          <h3>Agents</h3>
          <button className="plus" onClick={addAgent} aria-label="New agent">+</button>
        </div>
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`agent ${activeAgentId === agent.id ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              setActiveAgentId(agent.id);
              setRightPanel("chat");
              if (narrow) setMobileView("chat");
              if (followed[agent.id] === true) {
                const file = touches[agent.id]?.[0];
                if (file) openFile(file);
              }
            }}
          >
            <button
              type="button"
              className="face-hit"
              aria-label={`Change ${agent.name} icon`}
              title="Change icon"
              onClick={(event) => {
                event.stopPropagation();
                setFaceMenu((current) => (current === agent.id ? null : agent.id));
              }}
            >
              <AgentFace agent={agent} live={agentLive(activity[agent.id], tasks[agent.id])} size="md" />
            </button>
            <span className="copy">
              <b>{agent.name}</b>
              <small
                className={activity[agent.id] === "Failed" ? "fail" : (agentLive(activity[agent.id], tasks[agent.id]) ? "doing" : "")}
                title={activity[agent.id] === "Failed" ? (faults[agent.id] || "Failed") : (tasks[agent.id] || (usesAppModel(agent, settings) ? (agentJob(agent) || "Uses the app model") : "This agent's own model"))}
              >
                {agentSubtitle(agent, activity, tasks, faults, settings)}
              </small>
            </span>
            {(followed[agent.id] === true || activeAgentId === agent.id) && (
              <span className="agent-side">
                {followed[agent.id] === true && <span className="dot dot-follow" title="Following" />}
                {activeAgentId === agent.id && (
                  <>
                    <button
                      type="button"
                      className="agent-pen"
                      aria-label={`Edit ${agent.name}`}
                      title="Edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        setModal("agents");
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                        <path d="M13.5 6.5l3 3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="agent-pen agent-trash"
                      aria-label={`Delete ${agent.name}`}
                      title="Delete"
                      onClick={async (event) => {
                        event.stopPropagation();
                        if (agents.length < 2) {
                          await ask({ title: "Keep one agent", body: "Flint needs at least one agent.", confirm: "OK" });
                          return;
                        }
                        const ok = await ask({ title: "Delete this agent", body: agent.name, confirm: "Delete", danger: true });
                        if (!ok) return;
                        const list = agents.filter((item) => item.id !== agent.id);
                        await persistAgents(list);
                        setActiveAgentId(list[0]?.id || "");
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M4 7h16" />
                        <path d="M9 7V5h6v2" />
                        <path d="M7 7l1 13h8l1-13" />
                      </svg>
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
      <Splitter name="agents" />
      <div className="section files">
        <div className="explorer-head">
          <h3 title={workspaceRoot || ""}>{folderName}</h3>
          <span className="tree-tools">
            <button type="button" className="tree-tool" title="New file" aria-label="New file" onClick={() => createItem("file")}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8h5.4L12.2 5.2V14.2H3.5z" /><path d="M8.6 1.8v3.4h3.4" /><path d="M8 8.2v4M6 10.2h4" /></svg>
            </button>
            <button type="button" className="tree-tool" title="New folder" aria-label="New folder" onClick={() => createItem("dir")}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 4.2h4.2l1.1 1.3H14.4v7.1H1.6z" /><path d="M8 7.6v3.6M6.2 9.4h3.6" /></svg>
            </button>
            <button type="button" className="tree-tool" title="Refresh" aria-label="Refresh" onClick={refreshTree}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.5" /><path d="M13.4 2.6v2.8H10.6" /></svg>
            </button>
            <button type="button" className="tree-tool" title="Open folder" aria-label="Open folder" onClick={openWorkspaceFolder}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.6 3.6h4.2l1.2 1.4H14.4v7.4H1.6z" /></svg>
            </button>
          </span>
        </div>
        <div
          className="tree-scroll"
          onContextMenu={(event) => {
            if (event.target.closest(".tree-row, .recent-row")) return;
            openMenu(event, null);
          }}
        >
          {tree.length === 0 && <div className="tree-empty">{workspaceRoot ? "No files yet" : "Open a folder"}</div>}
          {tree.map((node) => (
            <FileNode
              key={node.path}
              node={node}
              depth={0}
              closed={closed}
              toggle={toggle}
              onMenu={openMenu}
              activePath={activePath}
              openFile={openFile}
            />
          ))}
          {recent.length > 0 && (
            <div className="recent-block">
              <div className="tree-label">Recent</div>
              {recent.slice(0, 5).map((folder) => {
                const name = String(folder).split(/[/\\]/).filter(Boolean).pop() || folder;
                return (
                  <button
                    type="button"
                    key={folder}
                    className="recent-row"
                    title={folder}
                    onClick={() => openRecent(folder)}
                    onContextMenu={(event) => openMenu(event, { recent: true, path: folder, name })}
                  >
                    <TreeGlyph dir />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {faceMenu && agents.some((item) => item.id === faceMenu) && (
          <FaceMenu
            agent={agents.find((item) => item.id === faceMenu)}
            onClose={() => setFaceMenu(null)}
            onChoose={(avatar) => {
              const id = faceMenu;
              setFaceMenu(null);
              persistAgents(agents.map((item) => (item.id === id ? { ...item, avatar } : item)));
            }}
          />
        )}
        {menu && createPortal(
          <div
            className="file-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {menu.target?.recent ? (
              <>
                <MenuItem icon="open" onClick={() => { setMenu(null); openRecent(menu.target.path); }}>Open</MenuItem>
                <MenuItem icon="copy" onClick={() => { setMenu(null); copyText(menu.target.path); }}>Copy path</MenuItem>
                <MenuItem icon="reveal" onClick={() => { setMenu(null); desktop.reveal(menu.target.path); }}>Reveal</MenuItem>
              </>
            ) : menu.target ? (
              <>
                <MenuItem icon="file" onClick={() => { const base = parentDir(menu.target); setMenu(null); createItem("file", base); }}>New file</MenuItem>
                <MenuItem icon="folder" onClick={() => { const base = parentDir(menu.target); setMenu(null); createItem("dir", base); }}>New folder</MenuItem>
                <hr />
                {menu.target.type !== "dir" && (
                  <MenuItem icon="open" onClick={() => { setMenu(null); openFile(menu.target.path); }}>Open</MenuItem>
                )}
                <MenuItem icon="copy" onClick={() => { setMenu(null); copyText(fullPath(menu.target.path)); }}>Copy path</MenuItem>
                <MenuItem icon="copy" onClick={() => { setMenu(null); copyText(menu.target.path); }}>Copy relative path</MenuItem>
                <MenuItem icon="reveal" onClick={() => { setMenu(null); desktop.reveal(fullPath(menu.target.path)); }}>Reveal</MenuItem>
                <hr />
                <MenuItem icon="rename" onClick={() => { const node = menu.target; setMenu(null); renameNode(node); }}>Rename</MenuItem>
                <MenuItem icon="trash" danger onClick={() => { const node = menu.target; setMenu(null); removeNode(node); }}>Delete</MenuItem>
              </>
            ) : (
              <>
                <MenuItem icon="file" onClick={() => { setMenu(null); createItem("file"); }}>New file</MenuItem>
                <MenuItem icon="folder" onClick={() => { setMenu(null); createItem("dir"); }}>New folder</MenuItem>
                <hr />
                <MenuItem icon="copy" onClick={() => { setMenu(null); copyText(workspaceRoot || ""); }}>Copy path</MenuItem>
                {workspaceRoot && (
                  <MenuItem icon="reveal" onClick={() => { setMenu(null); desktop.reveal(workspaceRoot); }}>Reveal</MenuItem>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
      </div>
    </aside>
  );
}
