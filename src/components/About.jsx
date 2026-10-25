import { useApp } from "../store.jsx";

const shortcuts = [
  ["Ctrl K", "Command palette"],
  ["Ctrl I", "Edit the selection"],
  ["Ctrl O", "Open files"],
  ["Ctrl Shift O", "Open folder"],
  ["Ctrl S", "Save"],
  ["Enter", "Send"],
  ["/plan", "Plan only"],
  ["/pass", "Hand the plan to an agent"],
  ["/diff", "Review edits"],
  ["/undo", "Restore the last run"],
  ["/search", "Find in the folder"],
  ["/git", "Git status"],
  ["/term", "Terminal"],
];

export default function About() {
  const { setModal, settings, agents } = useApp();
  const models = Object.values(settings?.providers || {});

  return (
    <div className="modal-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className="modal about" onPointerDown={(event) => event.stopPropagation()}>
        <div className="about-top">
          <div className="about-mark">
            <img src="/icon.png" alt="" />
            <div>
              <h2>Flint</h2>
              <p>0.1.6</p>
            </div>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setModal(null); }}>
            <span className="glyph x" />
          </button>
        </div>
        <p className="about-lead">
          A desktop app for a local model, or an API you already have. Several agents share one folder.
        </p>
        <div className="about-stats">
          <span>{models.length} {models.length === 1 ? "server" : "servers"}</span>
          <span>{agents.length} {agents.length === 1 ? "agent" : "agents"}</span>
          <span>Your folder</span>
        </div>
        <h3>Shortcuts</h3>
        <ul className="keys">
          {shortcuts.map(([key, label]) => (
            <li key={key}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
