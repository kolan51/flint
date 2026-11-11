import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../store.jsx";

export default function TasksBoard() {
  const { setModal, activeAgentId, setDock } = useApp();
  const [tasks, setTasks] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const selected = tasks.find((task) => task.id === selectedId) || tasks[0] || null;

  async function refresh() {
    try {
      const data = await api.tasks();
      setTasks(data.tasks || []);
      setNote("");
    } catch (err) {
      setNote(err.message || "Tasks could not load.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function propose() {
    setBusy(true);
    try {
      const data = await api.proposeTask({ request: draft, agentId: activeAgentId });
      setDraft("");
      setSelectedId(data.task?.id || "");
      await refresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve(id) {
    setBusy(true);
    try {
      await api.approveTask(id);
      await api.taskStatus(id, "implementing");
      await refresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runCrew(id) {
    setBusy(true);
    setLive("Starting crew…");
    try {
      await api.runTask(id, (event) => {
        if (event.type === "status" || event.type === "activity") {
          setLive(event.text || event.type);
        }
        if (event.type === "delta" && event.text) {
          setLive((prev) => `${event.job || "agent"}: ${String(prev).includes(event.job) ? "" : ""}${event.text}`.slice(-180));
        }
        if (event.type === "verification") {
          const report = event.report || {};
          setLive(`Verify · ${report.passed?.length || 0} passed, ${report.failed?.length || 0} failed`);
        }
        if (event.type === "done") {
          if (event.stopped) setNote(event.stopped);
          if (event.task?.id) setSelectedId(event.task.id);
        }
        if (event.type === "error") setNote(event.error || "Crew failed");
      });
      await refresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
      setLive("");
    }
  }

  async function verifyOnly(id) {
    setBusy(true);
    try {
      await api.verifyTask(id);
      await refresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function complete(id) {
    setBusy(true);
    try {
      await api.taskStatus(id, "completed");
      await refresh();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  const report = selected?.verificationReport;
  const activity = [...(selected?.history || [])].reverse().slice(0, 12);

  return (
    <div className="modal-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className="modal modal-sheet" onPointerDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Tasks</h2>
            <p className="dir-label">From requirements to verified code. Small chat edits still work without a task.</p>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setModal(null); }}>
            <span className="glyph x" />
          </button>
        </div>
        <div className="modal-body" style={{ display: "grid", gap: 16 }}>
          <form
            className="dock-form"
            onSubmit={(event) => {
              event.preventDefault();
              propose();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add user authentication to my application"
              aria-label="Task request"
            />
            <button className="btn" type="submit" disabled={busy || !draft.trim()}>Propose</button>
            <button className="ghost" type="button" disabled={busy} onClick={refresh}>Refresh</button>
          </form>
          {note ? <p className="dock-note">{note}</p> : null}
          {live ? <p className="dock-note"><b>Live</b> · {live}</p> : null}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 240px) 1fr", gap: 16 }}>
            <div className="hit-list">
              {tasks.length === 0 ? <p className="dock-note">No tasks yet.</p> : null}
              {tasks.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  className="hit"
                  onClick={() => setSelectedId(task.id)}
                  style={selected?.id === task.id ? { outline: "1px solid var(--line)" } : undefined}
                >
                  <b>{task.title}</b>
                  <span>{task.status.replaceAll("_", " ")}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              {!selected ? (
                <p className="dock-note">Select a task or propose one.</p>
              ) : (
                <>
                  <p className="dock-note"><b>Phase</b> · {selected.status.replaceAll("_", " ")}</p>
                  <p className="dock-note"><b>Request</b> · {selected.request || selected.description}</p>
                  {selected.acceptance?.length ? (
                    <p className="dock-note"><b>Acceptance</b> · {selected.acceptance.join(" · ")}</p>
                  ) : null}
                  {selected.plan?.length ? (
                    <p className="dock-note"><b>Plan</b> · {selected.plan.join(" · ")}</p>
                  ) : null}
                  {selected.files?.length ? (
                    <p className="dock-note"><b>Files</b> · {selected.files.join(", ")}</p>
                  ) : null}
                  {selected.assignment && (
                    <p className="dock-note">
                      <b>Crew</b>
                      {" · "}
                      {[
                        selected.assignment.architect && `Architect ${selected.assignment.architect.name}`,
                        selected.assignment.implementer && `Implementer ${selected.assignment.implementer.name}`,
                        selected.assignment.verifier && `Verifier ${selected.assignment.verifier.name}`,
                        selected.assignment.reviewer && `Reviewer ${selected.assignment.reviewer.name}`,
                      ].filter(Boolean).join(" · ") || "Unassigned"}
                    </p>
                  )}
                  {selected.routing?.implementer?.reason ? (
                    <p className="dock-note"><b>Routing</b> · {selected.routing.implementer.reason}</p>
                  ) : null}
                  {report ? (
                    <p className="dock-note">
                      <b>Verification</b>
                      {" · "}
                      {report.passed?.length || 0} passed, {report.failed?.length || 0} failed, {report.skipped?.length || 0} skipped
                      {report.unavailable?.length ? `, ${report.unavailable.length} unavailable` : ""}
                    </p>
                  ) : (
                    <p className="dock-note"><b>Verification</b> · not verified</p>
                  )}
                  {activity.length ? (
                    <div className="hit-list">
                      {activity.map((item, index) => (
                        <div key={`${item.at}-${index}`} className="hit" style={{ cursor: "default" }}>
                          <b>{item.job || "task"}</b>
                          <span>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="dock-form">
                    {(selected.status === "awaiting_approval" || selected.status === "draft") && (
                      <button type="button" className="btn" disabled={busy} onClick={() => approve(selected.id)}>Approve</button>
                    )}
                    {(selected.status === "approved" || selected.status === "implementing" || selected.status === "blocked" || selected.status === "failed" || selected.status === "review") && (
                      <button type="button" className="btn" disabled={busy} onClick={() => runCrew(selected.id)}>Run crew</button>
                    )}
                    {(selected.status === "implementing" || selected.status === "blocked" || selected.status === "approved") && (
                      <button type="button" className="ghost" disabled={busy} onClick={() => verifyOnly(selected.id)}>Verify only</button>
                    )}
                    {selected.status === "review" && (
                      <button type="button" className="btn" disabled={busy} onClick={() => complete(selected.id)}>Complete</button>
                    )}
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setDock?.("review");
                        setModal(null);
                      }}
                    >
                      Open review dock
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
