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
    <div className="modal-back" onClick={() => setModal(null)}>
      <div className="modal about" onClick={(event) => event.stopPropagation()}>
        <div className="about-top">
          <div className="about-mark">
            <img src="/icon.png" alt="" />
            <div>
              <h2>Flint</h2>
              <p>0.1.4</p>
            </div>
          </div>
          <button className="ghost" type="button" onClick={() => setModal(null)}>Close</button>
        </div>
        <p className="about-lead">
          A desktop studio for models you run yourself. Several agents share one folder and can hand work to each other.
        </p>
        <div className="about-stats">
          <span>{models.length} {models.length === 1 ? "server" : "servers"}</span>
          <span>{agents.length} {agents.length === 1 ? "agent" : "agents"}</span>
          <span>Local only</span>
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
