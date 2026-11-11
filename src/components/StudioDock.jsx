import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { useApp } from "../store.jsx";
import { api, streamUrl } from "../api.js";
import { readEditorProblems, subscribeEditorProblems } from "../editorProblems.js";
import PanelIcon from "./PanelIcon.jsx";
import FieldSelect from "./FieldSelect.jsx";

function ShellPane({ commands, decideCommand, setCommandMode, settings, termLog }) {
  const [shells, setShells] = useState([]);
  const [kind, setKind] = useState("powershell");
  const [session, setSession] = useState("");
  const [pty, setPty] = useState(false);
  const [log, setLog] = useState("");
  const [line, setLine] = useState("");
  const [jobs, setJobs] = useState([]);
  const host = useRef(null);
  const termRef = useRef(null);
  const pending = useRef("");

  useEffect(() => {
    let gone = false;
    const pull = () => api.jobs().then((data) => {
      if (!gone) setJobs(data.jobs || []);
    }).catch(() => {});
    pull();
    const timer = setInterval(pull, 1500);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let gone = false;
    api.shells().then((data) => {
      if (!gone) setShells(data.shells || []);
    }).catch(() => {});
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    let gone = false;
    let source;
    let opened = "";
    api.openShell(kind).then((data) => {
      if (gone) {
        api.closeShell(data.id).catch(() => {});
        return;
      }
      opened = data.id;
      setSession(data.id);
      setPty(Boolean(data.pty));
      setLog("");
      source = new EventSource(streamUrl(`/api/terminal/stream?id=${encodeURIComponent(data.id)}`));
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload.text) return;
          if (data.pty) {
            if (termRef.current) termRef.current.write(payload.text);
            else pending.current += payload.text;
          } else setLog((prev) => (prev + payload.text).slice(-20000));
        } catch {
          /* ignore a bad frame */
        }
      };
    }).catch((err) => {
      if (!gone) setLog(err.message || "The shell did not start.");
    });
    return () => {
      gone = true;
      source?.close();
      if (opened) api.closeShell(opened).catch(() => {});
    };
  }, [kind]);

  useEffect(() => {
    if (!pty || !host.current) return undefined;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Geist Mono, ui-monospace, monospace",
      fontSize: 13,
      theme: { background: "#10100e", foreground: "#ece7dc", cursor: "#f4b860" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    termRef.current = term;
    if (pending.current) {
      term.write(pending.current);
      pending.current = "";
    }
    const sendSize = () => {
      fit.fit();
      if (session) api.resizeShell(session, term.cols, term.rows).catch(() => {});
    };
    sendSize();
    const onData = term.onData((data) => {
      if (session) api.shellInput(session, data).catch(() => {});
    });
    const observer = new ResizeObserver(sendSize);
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      onData.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [pty, session]);

  return (
    <div className="term">
      <div className="shell-bar">
        <FieldSelect
          ariaLabel="Shell"
          value={kind}
          options={(shells.length ? shells : [{ id: "powershell", label: "PowerShell" }]).map((item) => ({ value: item.id, label: item.label }))}
          onChange={setKind}
        />
      </div>
      {commands.filter((item) => item.status === "waiting").slice(0, 1).map((item) => (
        <div className="cmd-wait" key={item.id}>
          <div className="cmd-ask">
            {item.cwd ? <span className="cmd-cwd">{item.cwd}</span> : null}
            <code>{item.command}</code>
          </div>
          <span className="cmd-actions">
            <button type="button" className="btn" onClick={() => decideCommand(item.id, true)}>Run</button>
            <button type="button" className="ghost" onClick={() => decideCommand(item.id, true, false, true)}>Allow this</button>
            <button type="button" className="ghost" onClick={() => decideCommand(item.id, true, true)}>Allow always</button>
            <button type="button" className="ghost" onClick={() => decideCommand(item.id, false)}>Skip</button>
          </span>
        </div>
      ))}
      {settings?.commands?.mode === "allow" && (
        <div className="cmd-wait">
          <span>Allow always is on. Agents run commands in this folder without asking.</span>
          <button type="button" className="ghost" onClick={() => setCommandMode("ask")}>Ask each time</button>
        </div>
      )}
      {jobs.length > 0 && (
        <div className="job-list">
          {jobs.slice(-4).map((job) => (
            <div key={job.id} className="job-row">
              <b>{job.done ? `Done ${job.code ?? ""}` : "Running"}</b>
              <code>{job.command}</code>
              {job.output && <pre>{job.output}</pre>}
            </div>
          ))}
        </div>
      )}
      {pty ? <div className="term-host" ref={host} /> : <pre className="term-log">{log || termLog}</pre>}
      {!pty && <form
        className="term-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          const next = line;
          setLine("");
          if (session) api.shellInput(session, next).catch(() => {});
        }}
      >
        <span aria-hidden="true">❯</span>
        <input value={line} onChange={(event) => setLine(event.target.value)} placeholder="Type a command" aria-label="Terminal command" />
      </form>}
    </div>
  );
}

function ReviewNote({ item, onSend }) {
  const [note, setNote] = useState("");
  const [hunk, setHunk] = useState("");
  return (
    <form
      className="review-note"
      onSubmit={(event) => {
        event.preventDefault();
        const text = note.trim();
        if (!text) return;
        const chosen = (item.hunks || []).find((row) => String(row.index) === hunk);
        setNote("");
        onSend(text, chosen);
      }}
    >
      {(item.hunks || []).length > 0 && (
        <FieldSelect
          ariaLabel="Change to comment on"
          value={hunk}
          options={[
            { value: "", label: "Whole file" },
            ...(item.hunks || []).map((row) => ({ value: String(row.index), label: `Change ${row.index + 1}` })),
          ]}
          onChange={setHunk}
        />
      )}
      <div className="review-send">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ask for a change" aria-label="Review comment" />
        <button className="btn" type="submit">Send</button>
      </div>
    </form>
  );
}

function hunkPreview(hunk) {
  const lines = String(hunk?.patch || "").split("\n").filter((row) => row.startsWith("+") || row.startsWith("-"));
  const line = lines.find((row) => row.slice(1).trim()) || lines[0] || "";
  if (!line) return { kind: "", text: "Marked in the editor" };
  return { kind: line.startsWith("+") ? "add" : "del", text: line.slice(1).trim() || line };
}

function checkoutClaims(checkouts, agents, activity) {
  const rows = [];
  for (const tree of checkouts || []) {
    for (const path of tree.files || []) rows.push({ agent: tree.agent || "Worker", path, conflict: false });
    for (const path of tree.conflicts || []) rows.push({ agent: tree.agent || "Worker", path, conflict: true });
  }
  for (const agent of agents || []) {
    const match = String(activity?.[agent.id] || "").match(/^(?:Reading|Editing|Writing)\s+(.+)$/);
    if (!match) continue;
    rows.push({ agent: agent.name, path: match[1].trim(), conflict: false, live: true });
  }
  const byFile = new Map();
  for (const row of rows) {
    const key = String(row.path).split(/[/\\]/).filter(Boolean).pop().toLowerCase();
    const list = byFile.get(key) || [];
    list.push(row);
    byFile.set(key, list);
  }
  return [...byFile.entries()]
    .filter(([, list]) => new Set(list.map((row) => row.agent)).size > 1)
    .map(([file, list]) => `${list.map((row) => row.agent).filter((name, index, all) => all.indexOf(name) === index).join(" and ")} both want ${file}`);
}

function CheckoutList({ checkouts, agents, activity, onOpen }) {
  const clashes = checkoutClaims(checkouts, agents, activity);
  if (!checkouts?.length && !clashes.length) return null;
  return (
    <div className="checkouts">
      {(checkouts || []).map((tree) => (
        <div className="checkout" key={tree.id}>
          <b style={{ color: tree.color || "var(--amber)" }}>{tree.agent || "Worker"}</b>
          {(tree.files || []).map((path) => (
            <button type="button" key={path} className="ghost" onClick={() => onOpen(path)}>{path.split(/[/\\]/).pop()}</button>
          ))}
          {!tree.files?.length && !tree.conflicts?.length && <span>own checkout</span>}
          {(tree.conflicts || []).map((path) => (
            <span className="clash" key={path}>{path.split(/[/\\]/).pop()} already has edits</span>
          ))}
        </div>
      ))}
      {clashes.map((line) => <p className="crew-clash" key={line}>{line}</p>)}
    </div>
  );
}

export default function StudioDock() {
  const {
    dock,
    setDock,
    reviews,
    sendChat,
    setRightPanel,
    acceptEdit,
    rejectEdit,
    termLog,
    searchHits,
    runSearch,
    openFileAt,
    dockNote,
    commands,
    decideCommand,
    setCommandMode,
    rejectHunk,
    gitText,
    loadGit,
    commitGit,
    settings,
    undoLastRun,
    checkouts,
    loadCheckouts,
    activity,
    agents,
    activeAgentId,
  } = useApp();
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteName, setNoteName] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [runs, setRuns] = useState([]);
  const [failures, setFailures] = useState([]);
  const [testing, setTesting] = useState(false);
  const [problems, setProblems] = useState([]);
  const [problemNote, setProblemNote] = useState("");
  const [flintTasks, setFlintTasks] = useState([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [taskNote, setTaskNote] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const open = reviews.filter((item) => item.status === "open");

  async function refreshFlintTasks() {
    try {
      const data = await api.tasks();
      setFlintTasks(data.tasks || []);
      setTaskNote("");
    } catch (err) {
      setTaskNote(err.message || "Tasks could not load.");
    }
  }

  async function refreshBranches() {
    try {
      const data = await api.branches();
      setBranches(data.branches || []);
      setCurrentBranch(data.current || "");
      await loadCheckouts();
    } catch (err) {
      setCurrentBranch(err.message);
    }
  }

  async function refreshRuns() {
    try {
      const data = await api.runs();
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    }
  }

  async function refreshProblems() {
    try {
      const data = await api.problems();
      setProblems(mergeProblems(data.problems || [], readEditorProblems()));
      setProblemNote(data.error || "");
    } catch {
      setProblems([]);
      setProblemNote("");
    }
  }

  async function runSuite() {
    setTesting(true);
    setDock("review");
    try {
      const data = await api.runTests();
      setFailures(data.failures || []);
    } catch (err) {
      setFailures([{ path: "", line: 1, name: "Tests", message: err.message }]);
    } finally {
      setTesting(false);
    }
  }
  async function refreshNotes() {
    try {
      const data = await api.notes();
      setNotes(data.notes || []);
    } catch {
      setNotes([]);
    }
  }

  useEffect(() => {
    if (dock === "review") refreshRuns();
  }, [dock]);

  useEffect(() => {
    const stop = subscribeEditorProblems(() => {
      if (dock === "problems") refreshProblems();
    });
    if (dock !== "problems") return stop;
    refreshProblems();
    const timer = setInterval(refreshProblems, 2500);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [dock]);

  const [command, setCommand] = useState("");
  const [query, setQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const moreTabs = [
    { id: "tasks", label: "Tasks" },
    { id: "problems", label: problems.length ? `Problems ${problems.length}` : "Problems" },
    { id: "search", label: "Search" },
    { id: "notes", label: "Notes" },
  ];
  const moreCurrent = moreTabs.find((item) => item.id === dock);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function close(event) {
      if (moreRef.current?.contains(event.target)) return;
      setMoreOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moreOpen]);

  return (
    <section className="dock">
      <div className="dock-head">
        <button type="button" className={dock === "review" ? "on" : ""} onClick={() => { setDock("review"); refreshRuns(); }}>
          <PanelIcon name="review" />
          Review{open.length ? ` ${open.length}` : ""}
        </button>
        <button type="button" className={dock === "term" ? "on" : ""} onClick={() => setDock("term")}>
          <PanelIcon name="term" />
          Terminal
        </button>
        <button type="button" className={dock === "git" ? "on" : ""} onClick={() => { loadGit(); refreshBranches(); }}>
          <PanelIcon name="git" />
          Git
        </button>
        <div className="dock-more" ref={moreRef}>
          <button type="button" className={moreCurrent ? "on" : ""} onClick={() => setMoreOpen((open) => !open)}>
            {moreCurrent ? moreCurrent.label : "More"}
          </button>
          {moreOpen && (
            <div className="dock-pop">
              {moreTabs.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={dock === item.id ? "on" : ""}
                  onClick={() => {
                    setMoreOpen(false);
                    if (item.id === "problems") refreshProblems();
                    if (item.id === "notes") refreshNotes();
                    if (item.id === "tasks") refreshFlintTasks();
                    setDock(item.id);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button type="button" disabled={testing} onClick={() => { setMoreOpen(false); runSuite(); }}>
                {testing ? "Testing" : "Test"}
              </button>
            </div>
          )}
        </div>
        <button type="button" className="dock-x" title="Close panel" aria-label="Close panel" onClick={() => setDock("")}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 6 8 10.5 12.5 6" />
          </svg>
        </button>
      </div>
      <div className={`dock-body ${dock === "term" ? "is-term" : ""}`}>
        {dockNote && <p className="dock-note">{dockNote}</p>}
        {dock === "review" && (
          <>
            {failures.length > 0 && (
              <div className="hit-list">
                {failures.map((failure) => (
                  <button type="button" key={`${failure.name}:${failure.path}:${failure.line}`} className="hit" onClick={() => failure.path && openFileAt(failure.path, failure.line)}>
                    <b>{failure.name}</b>
                    <span>{failure.message}{failure.path ? ` · ${failure.path}:${failure.line}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
            {runs.length > 0 && (
              <div className="run-list">
                {runs.map((run) => (
                  <button type="button" key={run.id} className="ghost" onClick={() => undoLastRun(run.id)}>
                    Restore {run.files[0]}{run.count > 1 ? ` +${run.count - 1}` : ""}
                  </button>
                ))}
              </div>
            )}
            {reviews.length === 0 ? <p className="dock-note">No changes to review.</p> : (
            reviews.map((item) => (
              <article className="diff-card" key={`${item.runId}-${item.path}`}>
                <header>
                  <button type="button" className="diff-file" title={item.path} onClick={() => openFileAt(item.path, item.hunks?.[0]?.line || 1)}>
                    <b>{item.path.split(/[/\\]/).pop()}</b>
                    {item.agent && <em style={{ color: item.color || "var(--amber)" }}>{item.agent}</em>}
                  </button>
                  {item.status === "open" ? (
                    <span className="diff-actions">
                      <button type="button" className="ghost" onClick={() => rejectEdit(item)}>Reject</button>
                      <button type="button" className="btn" onClick={() => acceptEdit(item)}>Accept</button>
                    </span>
                  ) : (
                    <span>{item.status === "accepted" ? "Kept" : "Restored"}</span>
                  )}
                </header>
                {item.status === "open" && item.hunks?.length > 0 && (
                  <div className="hunks">
                    {item.hunks.map((hunk) => {
                      const preview = hunkPreview(hunk);
                      return (
                        <div key={hunk.index} className="hunk">
                          <button type="button" className="hunk-line" onClick={() => openFileAt(item.path, hunk.line || 1)}>{hunk.line || hunk.index + 1}</button>
                          <code className={`hunk-preview ${preview.kind}`}>{preview.text}</code>
                          <button type="button" className="ghost" onClick={() => rejectHunk(item, hunk.index)}>Drop</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {item.status === "open" && (
                  <ReviewNote
                    item={item}
                    onSend={async (note, hunk) => {
                      const diff = hunk?.patch || item.patch || "";
                      setDock("");
                      setRightPanel("chat");
                      await sendChat(`Review note on ${item.path}${hunk ? `, change ${hunk.index + 1}` : ""}:\n${note}\n\n\`\`\`diff\n${String(diff).slice(0, 4000)}\n\`\`\``);
                    }}
                  />
                )}
              </article>
            ))
          )}
          </>
        )}
        {dock === "tasks" && (
          <TaskPane
            tasks={flintTasks}
            selectedId={selectedTaskId}
            onSelect={setSelectedTaskId}
            draft={taskDraft}
            note={taskNote}
            busy={taskBusy}
            onDraft={setTaskDraft}
            onRefresh={refreshFlintTasks}
            onPropose={async () => {
              setTaskBusy(true);
              try {
                const data = await api.proposeTask({ request: taskDraft, agentId: activeAgentId });
                setTaskDraft("");
                setSelectedTaskId(data.task?.id || "");
                await refreshFlintTasks();
              } catch (err) {
                setTaskNote(err.message);
              } finally {
                setTaskBusy(false);
              }
            }}
            onApprove={async (id) => {
              setTaskBusy(true);
              try {
                await api.approveTask(id);
                await api.taskStatus(id, "implementing");
                await refreshFlintTasks();
              } catch (err) {
                setTaskNote(err.message);
              } finally {
                setTaskBusy(false);
              }
            }}
            onRun={async (id) => {
              setTaskBusy(true);
              try {
                const data = await api.runTask(id);
                if (data.stopped) setTaskNote(data.stopped);
                await refreshFlintTasks();
              } catch (err) {
                setTaskNote(err.message);
              } finally {
                setTaskBusy(false);
              }
            }}
            onVerify={async (id) => {
              setTaskBusy(true);
              try {
                await api.verifyTask(id);
                await refreshFlintTasks();
              } catch (err) {
                setTaskNote(err.message);
              } finally {
                setTaskBusy(false);
              }
            }}
            onComplete={async (id) => {
              setTaskBusy(true);
              try {
                await api.taskStatus(id, "completed");
                await refreshFlintTasks();
              } catch (err) {
                setTaskNote(err.message);
              } finally {
                setTaskBusy(false);
              }
            }}
          />
        )}
        {dock === "problems" && (
          problems.length === 0 ? (
            <p className="dock-note">
              {problemNote
                ? `${problemNote} TypeScript, JavaScript, and JSON are still checked.`
                : "No problems. Python comes from Pyright. TypeScript and JavaScript come from the language server. JSON is checked in the folder. An open script also uses the editor's TypeScript checker."}
            </p>
          ) : (
            <div className="hit-list">
              {problems.map((problem) => (
                <button type="button" key={`${problem.source || ""}:${problem.path}:${problem.line}:${problem.message}`} className="hit" onClick={() => openFileAt(problem.path, problem.line)}>
                  <b>{problem.path}:{problem.line}</b>
                  <span>{problem.source ? `${problem.source} · ` : ""}{problem.message}</span>
                </button>
              ))}
            </div>
          )
        )}
        {dock === "term" && (
          <ShellPane
            commands={commands}
            decideCommand={decideCommand}
            setCommandMode={setCommandMode}
            settings={settings}
            termLog={termLog}
          />
        )}
        {dock === "git" && (
          <>
            <div className="git-bar">
              <span>{currentBranch || "No branch"}{checkouts.length ? ` · ${checkouts.length} checkout${checkouts.length === 1 ? "" : "s"}` : ""}</span>
              <button type="button" className="ghost" onClick={async () => { await api.pull(); loadGit(); refreshBranches(); }}>Pull</button>
              <button type="button" className="ghost" onClick={async () => { await api.push(); loadGit(); }}>Push</button>
            </div>
            <CheckoutList checkouts={checkouts} agents={agents} activity={activity} onOpen={openFileAt} />
            <form className="dock-form" onSubmit={async (event) => {
              event.preventDefault();
              const name = branchName;
              setBranchName("");
              await api.checkout(name, !branches.includes(name));
              loadGit();
              refreshBranches();
            }}>
              <input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Branch name" list="flint-branches" />
              <datalist id="flint-branches">
                {branches.map((name) => <option key={name} value={name} />)}
              </datalist>
              <button className="btn" type="submit">Switch</button>
            </form>
            <pre className="term-log">{gitText || "Clean working tree."}</pre>
            <form
              className="dock-form"
              onSubmit={(event) => {
                event.preventDefault();
                const message = commitMessage;
                setCommitMessage("");
                commitGit(message);
              }}
            >
              <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message" />
              <button className="btn" type="submit">Commit</button>
            </form>
          </>
        )}
        {dock === "notes" && (
          <>
            <form className="dock-form" onSubmit={async (event) => {
              event.preventDefault();
              await api.saveNote(noteName, noteBody);
              setNoteName("");
              setNoteBody("");
              refreshNotes();
            }}>
              <input value={noteName} onChange={(event) => setNoteName(event.target.value)} placeholder="Topic" />
              <button className="btn" type="submit">Save</button>
            </form>
            <textarea className="note-body" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="What should Flint remember?" />
            <div className="hit-list">
              {notes.map((note) => (
                <div key={note.name} className="note-row">
                  <button type="button" className="hit" onClick={() => { setNoteName(note.title || note.name); setNoteBody(note.body || ""); }}>
                    <b>{note.title || note.name}</b>
                    <span>{note.body}</span>
                  </button>
                  <button type="button" className="ghost" onClick={async () => { await api.deleteNote(note.name); refreshNotes(); }}>Delete</button>
                </div>
              ))}
            </div>
          </>
        )}
        {dock === "search" && (
          <>
            <form
              className="dock-form"
              onSubmit={(event) => {
                event.preventDefault();
                runSearch(query);
              }}
            >
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search" />
              <button className="btn" type="submit">Find</button>
            </form>
            <div className="hit-list">
              {searchHits.map((hit, index) => (
                <button type="button" key={`${hit.path}:${hit.line}:${index}`} className="hit" onClick={() => openFileAt(hit.path, hit.line)}>
                  <b>{hit.path}:{hit.line}</b>
                  <span>{hit.text}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function TaskPane({ tasks, selectedId, onSelect, draft, note, busy, onDraft, onRefresh, onPropose, onApprove, onRun, onVerify, onComplete }) {
  const selected = tasks.find((task) => task.id === selectedId) || tasks[0] || null;
  const report = selected?.verificationReport;
  const activity = [...(selected?.history || [])].reverse().slice(0, 8);
  return (
    <>
      <p className="dock-note">
        Task workspace: propose, approve, run the crew, inspect verification evidence, then complete. Chat still handles small edits without a task.
      </p>
      <form
        className="dock-form"
        onSubmit={(event) => {
          event.preventDefault();
          onPropose();
        }}
      >
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="Add user authentication to my application"
          aria-label="Task request"
        />
        <button className="btn" type="submit" disabled={busy || !draft.trim()}>Propose</button>
        <button className="ghost" type="button" disabled={busy} onClick={onRefresh}>Refresh</button>
      </form>
      {note ? <p className="dock-note">{note}</p> : null}
      <div className="hit-list">
        {tasks.map((task) => (
          <button
            type="button"
            key={task.id}
            className="hit"
            onClick={() => onSelect(task.id)}
            style={selected?.id === task.id ? { outline: "1px solid var(--line)" } : undefined}
          >
            <b>{task.title}</b>
            <span>{task.status.replaceAll("_", " ")}</span>
          </button>
        ))}
      </div>
      {selected && (
        <article className="note-row" style={{ display: "grid", gap: 8, padding: "12px 0" }}>
          <p className="dock-note"><b>Phase</b> · {selected.status.replaceAll("_", " ")}</p>
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
          {report ? (
            <p className="dock-note">
              <b>Verification</b>
              {" · "}
              {report.passed?.length || 0} passed, {report.failed?.length || 0} failed, {report.skipped?.length || 0} skipped
              {report.unavailable?.length ? `, ${report.unavailable.length} unavailable` : ""}
              {report.durationMs != null ? ` · ${report.durationMs} ms` : ""}
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
              <button type="button" className="btn" disabled={busy} onClick={() => onApprove(selected.id)}>Approve</button>
            )}
            {(selected.status === "approved" || selected.status === "implementing" || selected.status === "blocked" || selected.status === "failed") && (
              <button type="button" className="btn" disabled={busy} onClick={() => onRun(selected.id)}>Run crew</button>
            )}
            {(selected.status === "implementing" || selected.status === "blocked" || selected.status === "approved") && (
              <button type="button" className="ghost" disabled={busy} onClick={() => onVerify(selected.id)}>Verify only</button>
            )}
            {selected.status === "review" && (
              <button type="button" className="btn" disabled={busy} onClick={() => onComplete(selected.id)}>Complete</button>
            )}
          </div>
        </article>
      )}
    </>
  );
}

function mergeProblems(folder, editor) {
  const seen = new Set();
  const out = [];
  for (const item of [...folder, ...editor]) {
    const key = `${item.path}:${item.line}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 80);
}
