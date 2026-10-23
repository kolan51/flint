import React, { useEffect, useRef, useState } from "react";
import { useApp } from "./store.jsx";
import { desktop } from "./desktop.js";
import TitleBar from "./components/TitleBar.jsx";
import Sidebar from "./components/Sidebar.jsx";
import EditorPane from "./components/EditorPane.jsx";
import RightPane from "./components/RightPane.jsx";
import StatusBar from "./components/StatusBar.jsx";
import SettingsModal from "./components/SettingsModal.jsx";
import AgentStudio from "./components/AgentStudio.jsx";
import About from "./components/About.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import AskDialog from "./components/AskDialog.jsx";
import { Splitter, fitPanes, usePanes } from "./panes.jsx";

export default function App() {
  const {
    bootError,
    booted,
    modal,
    openWorkspaceFolder,
    openLocalFiles,
    saveTab,
    activePath,
    revealActive,
    setWorkspace,
    isDesktop,
    leftOpen,
    rightOpen,
    chatFocus,
    narrow,
    mobileView,
    setModal,
    settings,
    backendStatus,
    workspaceRoot,
  } = useApp();
  const [maximized, setMaximized] = useState(false);
  const [holdSplash, setHoldSplash] = useState(true);
  const [shellWidth, setShellWidth] = useState(() => window.innerWidth);
  const shellRef = useRef(null);
  const panes = usePanes();
  const fitted = fitPanes(
    shellWidth,
    panes?.sizes.left,
    panes?.sizes.right,
    leftOpen && !chatFocus,
    rightOpen && !chatFocus,
  );
  const paneStyle = panes ? {
    "--left": `${fitted.left}px`,
    "--right": `${fitted.right}px`,
    "--dock": `${panes.sizes.dock}px`,
    "--preview": `${panes.sizes.preview}%`,
  } : undefined;

  const showSplash = !bootError && (!booted || holdSplash);
  const providers = Object.values(settings?.providers || {});
  const modelLive = backendStatus?.[settings?.activeProvider];
  const modelOffline = Boolean(modelLive && !modelLive.ok);
  const noModel = providers.length === 0;
  const noFolder = !workspaceRoot;
  const firstRun = Boolean(settings) && (noModel || modelOffline || noFolder);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return undefined;
    const measure = () => setShellWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showSplash]);

  useEffect(() => desktop.onWindow(setMaximized), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setHoldSplash(false), 1100);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!showSplash) document.getElementById("boot-splash")?.remove();
  }, [showSplash]);

  useEffect(() => {
    function onKey(event) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setModal((current) => (current === "palette" ? null : "palette"));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setModal]);

  useEffect(() => {
    return desktop.onMenu((action) => {
      if (action === "openFolder") openWorkspaceFolder();
      if (action === "openFiles") openLocalFiles();
      if (action === "save" && activePath) saveTab(activePath);
      if (action === "reveal") revealActive();
    });
  }, [openWorkspaceFolder, openLocalFiles, saveTab, activePath, revealActive]);

  function onDragOver(event) {
    event.preventDefault();
  }

  async function onDrop(event) {
    event.preventDefault();
    if (!isDesktop) return;
    const dropped = [...event.dataTransfer.files]
      .map((file) => desktop.pathForFile(file))
      .filter(Boolean);
    if (!dropped.length) return;
    if (dropped.length === 1 && !/\.[^\\/]+$/.test(dropped[0])) {
      await setWorkspace(dropped[0]);
      return;
    }
    await openLocalFiles(dropped);
  }

  if (bootError) {
    return (
      <div className="boot-fail">
        {isDesktop && (
          <div className="boot-wins">
            <button type="button" aria-label="Minimize" onClick={() => desktop.minimize()}><span className="bw min" /></button>
            <button type="button" aria-label="Maximize" onClick={() => desktop.toggleMaximize()}><span className="bw max" /></button>
            <button type="button" className="close" aria-label="Close" onClick={() => desktop.close()}><span className="bw x" /></button>
          </div>
        )}
        <img src="/boot-icon.png" alt="" width="72" height="72" />
        <h1>Flint could not start</h1>
        <p>{bootError}</p>
        <p>{isDesktop ? "Close Flint and open it again." : "Start the local service, then refresh."}</p>
      </div>
    );
  }

  if (showSplash) return null;

  return (
    <div
      className={[
        "app",
        leftOpen ? "left-on" : "left-off",
        rightOpen ? "right-on" : "right-off",
        chatFocus ? "chat-focus" : "",
        narrow ? "is-narrow" : "",
        `view-${mobileView}`,
        maximized ? "is-max" : "",
        firstRun ? "has-first" : "",
      ].join(" ")}
      style={paneStyle}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TitleBar />
      {firstRun && (
        <div className="first-run">
          {noModel && <span>Add the model server you already run, then pick it in the title bar.</span>}
          {!noModel && modelOffline && <span>The title bar is offline. Start that model server, then pick it again.</span>}
          {noFolder && <span>Open a folder. Agents only read that project.</span>}
          <span className="first-run-actions">
            {(noModel || modelOffline) && (
              <button type="button" onClick={() => setModal("settings")}>{noModel ? "Add a model" : "Models"}</button>
            )}
            {noFolder && <button type="button" onClick={openWorkspaceFolder}>Open folder</button>}
          </span>
        </div>
      )}
      <div className="shell" ref={shellRef}>
        <Splitter name="left" />
        <Sidebar />
        <EditorPane />
        <RightPane />
        <Splitter name="right" />
      </div>
      <StatusBar />
      {modal === "settings" && <SettingsModal />}
      {modal === "agents" && <AgentStudio />}
      {modal === "about" && <About />}
      {modal === "palette" && <CommandPalette />}
      <AskDialog />
    </div>
  );
}
