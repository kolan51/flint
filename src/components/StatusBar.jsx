import React from "react";
import { useApp } from "../store.jsx";
import PanelIcon from "./PanelIcon.jsx";

export default function StatusBar() {
  const {
    settings,
    activeTab,
    modelError,
    backendStatus,
    updateInfo,
    setModal,
    mode,
    setMode,
    reviews,
    dock,
    setDock,
    workspaceRoot,
    loadGit,
  } = useApp();
  const live = backendStatus?.[settings?.activeProvider];
  const offline = live ? live.ok === false : Boolean(modelError);
  const open = reviews.filter((item) => item.status === "open").length;
  const folder = workspaceRoot ? String(workspaceRoot).split(/[/\\]/).filter(Boolean).pop() : "";

  function toggle(id) {
    setDock(dock === id ? "" : id);
  }

  return (
    <footer className="statusbar">
      <span className="status-left" title={activeTab?.path || workspaceRoot || ""}>
        {activeTab?.path || folder || "No folder"}
      </span>
      {updateInfo?.available && (
        <button type="button" className="status-update" onClick={() => setModal("settings")}>
          Update {updateInfo.latest}
        </button>
      )}
      {offline && (
        <span className="status-right warn" title={live?.error || modelError || "The model server is not answering."}>
          Model offline
        </span>
      )}
      <nav className="status-actions" aria-label="Panels">
        <button
          type="button"
          className={mode === "plan" ? "on" : ""}
          title={mode === "plan" ? "Plan. The agent can read, not edit." : "Agent. The agent can edit."}
          onClick={() => setMode(mode === "plan" ? "act" : "plan")}
        >
          <PanelIcon name={mode === "plan" ? "plan" : "agent"} />
          <span>{mode === "plan" ? "Plan" : "Agent"}</span>
        </button>
        <button
          type="button"
          className={dock === "review" ? "on" : ""}
          title="Review"
          aria-label={open ? `Review, ${open} open` : "Review"}
          onClick={() => toggle("review")}
        >
          <PanelIcon name="review" />
          {open > 0 && <span className="status-count">{open}</span>}
        </button>
        <button
          type="button"
          className={dock === "problems" ? "on" : ""}
          title="Problems"
          aria-label="Problems"
          onClick={() => toggle("problems")}
        >
          <PanelIcon name="problems" />
        </button>
        <button
          type="button"
          className={dock === "search" ? "on" : ""}
          title="Search"
          aria-label="Search"
          onClick={() => toggle("search")}
        >
          <PanelIcon name="search" />
        </button>
        <button
          type="button"
          className={dock === "git" ? "on" : ""}
          title="Git"
          aria-label="Git"
          onClick={() => (dock === "git" ? setDock("") : loadGit())}
        >
          <PanelIcon name="git" />
        </button>
        <button
          type="button"
          className={dock === "term" ? "on" : ""}
          title="Terminal"
          aria-label="Terminal"
          onClick={() => toggle("term")}
        >
          <PanelIcon name="term" />
        </button>
      </nav>
    </footer>
  );
}
