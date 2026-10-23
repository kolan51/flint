import React, { useEffect } from "react";
import { useApp } from "../store.jsx";
import ChatPane from "./ChatPane.jsx";

export default function RightPane() {
  const { rightPanel, setRightPanel, chatFocus, setChatFocus, activeAgent, followed, toggleFollow, narrow, mobileView, setMobileView } = useApp();
  const on = followed[activeAgent?.id] === true;

  useEffect(() => {
    if (rightPanel === "follow") setRightPanel("chat");
  }, [rightPanel, setRightPanel]);

  return (
    <aside className="right">
      <div className="pane-head">
        <button className="on" onClick={() => (narrow ? setMobileView(mobileView === "chat" ? "editor" : "chat") : setChatFocus((open) => !open))}>
          {narrow ? (mobileView === "chat" ? "Editor" : "Chat") : (chatFocus ? "Editor" : "Chat")}
        </button>
        <button
          type="button"
          className={`chip ${on ? "active" : ""}`}
          onClick={() => activeAgent && toggleFollow(activeAgent.id)}
        >
          {on ? "Following" : "Follow"}
        </button>
        <div className="session-slot" />
      </div>
      <ChatPane />
    </aside>
  );
}
