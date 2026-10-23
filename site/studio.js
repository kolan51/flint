const faces = ["🦊", "🦉", "🐺", "🐝", "🐙", "🐢", "🐉", "🤖", "👾", "🐱", "🦄", "🐸", "🦁", "🐼", "🦋", "⚡"];

const agents = [
  { id: "senior", name: "Senior", color: "#f4b860", face: "🦊", line: "Waiting on 3 workers", job: "Senior engineer", file: "", prompt: "Split the job. Hand each piece to a worker and leave the review in the dock.", model: "" },
  { id: "w1", name: "Worker 1", color: "#7ec8c8", face: "🐢", line: "Editing calculator.py", job: "Builder", file: "calculator.py", prompt: "Change only the file you were given. Prefer working code.", model: "" },
  { id: "w2", name: "Worker 2", color: "#e07a5f", face: "🐙", line: "Reading the tests", job: "Reviewer", file: "test_calculator.py", prompt: "Read the tests first. Add the missing case without rewriting the rest.", model: "" },
  { id: "w3", name: "Worker 3", color: "#9b8cff", face: "🐝", line: "Waiting for the model", job: "Checker", file: "README.md", prompt: "Wait for the model, then check the README against the change.", model: "" },
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

const penSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/></svg>';
const trashSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/></svg>';

const faceSrc = {
  "🦊": "faces/fox.png",
  "🦉": "faces/owl.png",
  "🐺": "faces/wolf.png",
  "🐝": "faces/bee.png",
  "🐙": "faces/octopus.png",
  "🐢": "faces/turtle.png",
  "🐉": "faces/dragon.png",
  "🤖": "faces/robot.png",
  "👾": "faces/alien.png",
  "🐱": "faces/cat.png",
  "🦄": "faces/unicorn.png",
  "🐸": "faces/frog.png",
  "🦁": "faces/lion.png",
  "🐼": "faces/panda.png",
  "🦋": "faces/butterfly.png",
  "⚡": "faces/bolt.png",
};

function faceEl(item, size = "") {
  const src = faceSrc[item.face];
  const inner = src ? `<img src="${src}" alt="">` : (item.face || "✦");
  return `<span class="fface${size ? ` ${size}` : ""}" style="--c:${item.color}">${inner}</span>`;
}

const files = {
  "calculator.py": [
    '<span class="kw">def</span> divide(a, b):',
    '    <span class="kw">if</span> b == 0:',
    '        <span class="kw">raise</span> ZeroDivisionError("divide by zero")',
    "    <span class=\"kw\">return</span> a / b",
    "",
    '<span class="kw">def</span> evaluate_expression(expr):',
    "    tree = ast.parse(expr, mode=\"eval\")",
    "    <span class=\"kw\">return</span> walk(tree.body)",
  ].join("\n"),
  "test_calculator.py": [
    '<span class="kw">import</span> unittest',
    '<span class="kw">from</span> calculator <span class="kw">import</span> divide',
    "",
    '<span class="kw">class</span> TestDivide(unittest.TestCase):',
    "    <span class=\"kw\">def</span> test_zero(self):",
    "        <span class=\"kw\">with</span> self.assertRaises(ZeroDivisionError):",
    "            divide(1, 0)",
  ].join("\n"),
  "README.md": [
    '<span class="kw"># Calculator</span>',
    "",
    "Divide used to return None.",
    "The tests cover zero.",
  ].join("\n"),
};

const threads = {
  senior: [
    { role: "you", text: "Split the calculator work." },
    {
      role: "agent",
      name: "Senior",
      color: "#f4b860",
      face: "🦊",
      crew: [
        { name: "Worker 1", face: "🐢", color: "#7ec8c8", line: "Editing calculator.py", job: "Raise when the divisor is zero.", file: "calculator.py" },
        { name: "Worker 2", face: "🐙", color: "#e07a5f", line: "Reading the tests", job: "Add the zero case.", file: "test_calculator.py" },
        { name: "Worker 3", face: "🐝", color: "#9b8cff", line: "Waiting for the model", job: "Check the README after the tests.", file: "README.md" },
      ],
    },
  ],
  w1: [
    { role: "agent", name: "Worker 1", color: "#7ec8c8", face: "🐢", text: "divide raises when the divisor is zero. calculator.py is the only file I will touch." },
  ],
  w2: [
    { role: "agent", name: "Worker 2", color: "#e07a5f", face: "🐙", text: "I am adding the zero case to test_calculator.py." },
  ],
  w3: [
    { role: "agent", name: "Worker 3", color: "#9b8cff", face: "🐝", text: "I am next. I will check the README once the tests pass." },
  ],
};

const docks = {
  Review: '<div>calculator.py</div><div><span class="del">- return None</span></div><div><span class="add">+ raise ZeroDivisionError("divide by zero")</span></div><div><span class="add">+ divide(1, 0) raises</span></div>',
  Problems: '<div>calculator.py:3  ZeroDivisionError is not handled</div><div>test_calculator.py:6  Expected ZeroDivisionError</div>',
  Terminal: 'PS calculator&gt; python -m unittest test_calculator -v\ntest_zero ... <span class="add">ok</span>\n<span class="add">OK</span>',
  Settings: "Models, completion, and command approval.",
};

const starterModels = ["Qwen3 8B", "Qwen2.5 Coder", "Llama 3.1 8B", "DeepSeek R1"];

const root = document.getElementById("demo");
if (root) {
  const state = {
    agent: "senior", file: "calculator.py", dock: "Review", menu: false, mode: "Agent",
    agents: agents.map((item) => ({ ...item })), files: { ...files },
    editing: null, ask: null,
    follow: false, session: "Calculator divide", sessionOpen: false, soFar: "Divide raises on zero", cmd: "waiting",
    model: "Qwen3 8B", models: starterModels.slice(),
    settings: false, settab: "Models", tested: false, stick: false,
  };

  function settingsHtml() {
    const tabs = ["Models", "Completion", "Commands"].map((name) =>
      `<button type="button" class="${name === state.settab ? "on" : ""}" data-settab="${name}">${name}</button>`).join("");
    let body = "";
    if (state.settab === "Models") {
      body = `<p>Add a server you already run. One address per model.</p>
        ${state.models.map((name) => `<div class="mrow"><i class="fdot" style="background:#8fbf7f"></i><span class="copy"><b>${name}</b><small>127.0.0.1</small></span><button type="button" data-act="test-model">Test</button></div>`).join("")}
        ${state.tested ? '<p class="set-note">4 models found</p>' : ""}
        <div class="sgrid" style="margin-top:12px">
          <label>Name<input id="setName" value="Mistral 7B"></label>
          <label>Type<select><option>Ollama</option><option>OpenAI-compatible</option></select></label>
          <label class="wide">Address<input value="http://127.0.0.1:11434"></label>
        </div>
        <div class="srow"><button type="button" data-act="add-model">Add model</button></div>`;
    } else if (state.settab === "Completion") {
      body = `<p>A small coder on its own address writes the ghost text. Leave this blank to use the agent model.</p>
        <div class="sgrid">
          <label class="wide">Address<input value="http://127.0.0.1:11434"></label>
          <label class="wide">Model<input value="Qwen2.5 Coder"></label>
        </div>
        <div class="srow"><button type="button" data-act="save-settings">Save</button></div>`;
    } else {
      body = `<p>When an agent wants to run a command in this folder.</p>
        <div class="sgrid"><label class="wide">Approval<select><option>Ask each time</option><option>Allow always</option></select></label></div>
        <div class="srow"><button type="button" data-act="save-settings">Save</button></div>`;
    }
    return `<form class="sheet settings-mock" id="settingsForm">
      <div class="shead"><h4>Settings</h4><button type="button" data-act="close-settings">Close</button></div>
      <div class="stabs">${tabs}</div>
      ${body}
    </form>`;
  }

  function followFile(id) {
    const who = state.agents.find((item) => item.id === (id || state.agent));
    if (who?.file && state.files[who.file]) state.file = who.file;
  }

  function paint() {
    const agent = state.agents.find((item) => item.id === state.agent) || state.agents[0];
    const chip = (name) => (name && state.files[name] ? `<button type="button" class="ffile-chip" data-file="${esc(name)}">${esc(name)}</button>` : "");
    document.getElementById("agents").innerHTML = state.agents.map((item) => `
      <div class="fagent ${item.id === state.agent ? "on" : ""}" data-agent="${item.id}" role="button" tabindex="0">
        ${faceEl(item)}
        <span><b>${esc(item.name)}</b><small class="${/^(Editing|Reading|Waiting)/.test(item.line) ? "doing" : ""}">${esc(item.line)}</small>${chip(item.file)}</span>
        ${item.id === state.agent ? `<button type="button" class="fpen" data-act="edit-agent" aria-label="Edit ${esc(item.name)}" title="Edit">${penSvg}</button><button type="button" class="ftrash" data-act="trash-agent" aria-label="Delete ${esc(item.name)}" title="Delete">${trashSvg}</button>` : ""}
      </div>`).join("") + (state.session === "Empty chat" ? "" : `<p class="fqueue"><span>Model</span><b>Worker 1</b><span>now</span><span>·</span><b>Worker 3</b><span>next</span></p>`);
    const fileIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 2.5h5l3 3V13.5H4z"/><path d="M9 2.5V6h3"/></svg>';
    document.getElementById("files").innerHTML = Object.keys(state.files).map((name) => `
      <button type="button" class="ffile ${name === state.file ? "on" : ""}" data-file="${name}">${fileIcon}${name}</button>`).join("");
    document.getElementById("tabs").innerHTML = `<button type="button" class="ftab on">${state.file}</button>`;
    const lines = state.files[state.file].split("\n");
    document.getElementById("code").innerHTML = `<div class="fgutter">${lines.map((_, index) => `<span>${index + 1}</span>`).join("")}</div><div class="flines">${state.files[state.file]}</div>`;
    const commandCard = state.cmd === "waiting"
      ? `<div class="fcmd"><code>python -m unittest test_calculator -v</code><span class="fcmd-actions"><button type="button" data-act="run-cmd">Run</button><button type="button" data-act="allow-cmd">Allow this</button><button type="button" data-act="always-cmd">Allow always</button><button type="button" data-act="skip-cmd">Skip</button></span></div>`
      : `<div class="fcmd"><code>python -m unittest test_calculator -v</code><span class="fcmd-state">${state.cmd === "skipped" ? "Skipped" : state.cmd === "always" ? "Allow always" : "Ran"}</span></div>`;
    const queueLine = `<p class="fqueue"><span>Model</span><b>Worker 1</b><span>now</span><span>·</span><b>Worker 3</b><span>next</span></p>`;
    document.getElementById("msgs").innerHTML = state.session === "Empty chat"
      ? `<div class="fbubble agent" style="--agent:#f4b860"><div class="fwho">${faceEl(state.agents.find((item) => item.id === state.agent) || state.agents[0])}<b>${esc((state.agents.find((item) => item.id === state.agent) || state.agents[0]).name)}</b></div><p>This chat is empty.</p></div>`
      : (threads[state.agent] || []).map((item) => {
      if (item.role !== "agent") return `<div class="fbubble you">${item.text}</div>`;
      const crew = item.crew ? `<div class="fcrew">${item.crew.map((row) => `
        <div class="frow-crew" style="--c:${row.color}">
          ${faceEl(row)}
          <span><b>${row.name}</b><small>${row.line}</small><em>${row.job}</em>${chip(row.file)}</span>
        </div>`).join("")}</div>${queueLine}${commandCard}` : "";
      return `<div class="fbubble agent" style="--agent:${item.color}">
        <div class="fwho">${faceEl(item)}<b>${item.name}</b></div>
        ${item.text ? `<p>${item.text}</p>` : ""}
        ${crew}
      </div>`;
    }).join("");
    document.getElementById("modelBtn").querySelector("span").textContent = state.model;
    document.getElementById("modelMenu").innerHTML = state.models.map((name) =>
      `<button type="button" class="${name === state.model ? "on" : ""}" data-model="${name}">${name}</button>`).join("");
    document.getElementById("draft").placeholder = `Message ${agent.name}`;
    document.getElementById("dockTabs").innerHTML = Object.keys(docks).map((name) => `
      <button type="button" class="${name === state.dock ? "on" : ""}" data-dock="${name}">${name}</button>`).join("");
    document.getElementById("dockBody").innerHTML = docks[state.dock];
    const menu = document.getElementById("modelMenu");
    menu.hidden = !state.menu;
    document.getElementById("modelBtn").classList.toggle("on", state.menu);
    document.getElementById("modeBtn").textContent = state.mode;
    document.getElementById("modeBtn").classList.toggle("off", state.mode === "Plan");
    document.getElementById("statusPath").textContent = state.file;
    document.getElementById("statusModel").textContent = state.mode;
    root.querySelector('[data-act="files"]').classList.toggle("on", !root.classList.contains("side-off"));
    root.querySelector('[data-act="chat"]').classList.toggle("on", root.classList.contains("chat-only"));
    root.querySelector('[data-act="dock-problems"]')?.classList.toggle("on", state.dock === "Problems");
    const followBtn = root.querySelector('[data-act="follow"]');
    if (followBtn) {
      followBtn.classList.toggle("on", state.follow);
      followBtn.textContent = state.follow ? "Following" : "Follow";
    }
    const sessionBtn = root.querySelector('[data-act="session"]');
    if (sessionBtn) sessionBtn.textContent = state.session;
    const soFar = document.getElementById("soFar");
    if (soFar && document.activeElement !== soFar) soFar.value = state.soFar;
    const sessionMenu = document.getElementById("sessionMenu");
    if (sessionMenu) {
      sessionMenu.innerHTML = state.sessionOpen ? `<div class="fsess-menu">${["Calculator divide", "Empty chat"].map((name) => `<button type="button" data-session="${esc(name)}" class="${name === state.session ? "on" : ""}">${esc(name)}</button>`).join("")}</div>` : "";
    }
    const box = document.getElementById("msgs");
    box.scrollTop = state.stick ? box.scrollHeight : 0;
    let sheet = document.getElementById("settingsSheet");
    if (!state.settings) sheet?.remove();
    else {
      if (!sheet) {
        sheet = document.createElement("div");
        sheet.id = "settingsSheet";
        sheet.className = "gear-sheet";
        root.appendChild(sheet);
      }
      const name = document.getElementById("setName")?.value;
      sheet.innerHTML = settingsHtml();
      if (name && document.getElementById("setName")) document.getElementById("setName").value = name;
    }
    syncAgentSheets();
  }

  function applyDraft() {
    const host = document.getElementById("editSheet");
    const who = state.agents.find((item) => item.id === state.editing);
    if (!host || !who) return who || null;
    const name = host.querySelector("[data-field=name]")?.value.trim();
    if (name) who.name = name;
    who.prompt = host.querySelector("[data-field=prompt]")?.value ?? who.prompt;
    who.model = host.querySelector("[data-field=model]")?.value ?? "";
    return who;
  }

  function retitle(from, agent) {
    const touch = (row) => {
      if (!row || row.name !== from) return;
      row.name = agent.name;
      row.face = agent.face;
      row.color = agent.color;
    };
    Object.values(threads).forEach((list) => list.forEach((item) => {
      touch(item);
      (item.crew || []).forEach(touch);
    }));
  }

  function editHtml(agent) {
    const options = [`<option value=""${agent.model ? "" : " selected"}>Same as the app · ${esc(state.model)}</option>`]
      .concat(state.models.map((name) => `<option value="${esc(name)}"${agent.model === name ? " selected" : ""}>${esc(name)}</option>`))
      .join("");
    return `<form class="sheet agent-sheet" id="agentForm">
      <div class="shead"><h4>${esc(agent.name || "Agent")}</h4><button type="button" data-act="close-edit">Close</button></div>
      <p>Name it and say how it should work.</p>
      <div class="sgrid">
        <label class="wide">Name<input data-field="name" value="${esc(agent.name)}"></label>
        <label class="wide">Model<select data-field="model">${options}</select></label>
        <label class="wide">Prompt<textarea data-field="prompt">${esc(agent.prompt || "")}</textarea></label>
      </div>
      <p>The title bar is the app model. The first choice follows it.</p>
      <div class="face-edit">
        ${faceEl(agent, "lg")}
        <div class="face-picks">${faces.map((emoji) => `<button type="button" class="${emoji === agent.face ? "on" : ""}" data-face="${emoji}"><img src="${faceSrc[emoji]}" alt=""></button>`).join("")}</div>
      </div>
      <div class="srow">
        <button type="button" class="quiet" data-act="delete-agent">Delete</button>
        <button type="button" data-act="save-agent">Save</button>
      </div>
    </form>`;
  }

  function askHtml() {
    const who = state.agents.find((item) => item.id === state.ask?.id);
    if (!who) return "";
    if (state.agents.length < 2) {
      return `<form class="sheet ask-card"><h4>Keep one agent</h4><p>Flint needs at least one agent.</p><div class="srow"><button type="button" data-act="cancel-ask">OK</button></div></form>`;
    }
    return `<form class="sheet ask-card"><h4>Delete this agent</h4><p>${esc(who.name)}</p><div class="srow"><button type="button" class="quiet" data-act="cancel-ask">Cancel</button><button type="button" class="danger" data-act="confirm-ask">Delete</button></div></form>`;
  }

  function syncAgentSheets() {
    let edit = document.getElementById("editSheet");
    const editing = state.agents.find((item) => item.id === state.editing);
    if (!editing) {
      edit?.remove();
      state.editing = null;
    } else if (!edit || edit.dataset.id !== editing.id) {
      edit?.remove();
      edit = document.createElement("div");
      edit.id = "editSheet";
      edit.className = "gear-sheet";
      edit.dataset.id = editing.id;
      edit.innerHTML = editHtml(editing);
      root.appendChild(edit);
    }
    let ask = document.getElementById("askSheet");
    if (!state.ask) ask?.remove();
    else {
      if (!ask) {
        ask = document.createElement("div");
        ask.id = "askSheet";
        ask.className = "gear-sheet ask-sheet";
        root.appendChild(ask);
      }
      ask.innerHTML = askHtml();
    }
  }

  root.addEventListener("input", (event) => {
    if (event.target.id === "soFar") state.soFar = event.target.value;
  });

  root.addEventListener("click", (event) => {
    const agent = event.target.closest("[data-agent]");
    const file = event.target.closest("[data-file]");
    const dock = event.target.closest("[data-dock]");
    const act = event.target.closest("[data-act]");
    const model = event.target.closest("[data-model]");
    const pickedFace = event.target.closest("[data-face]");
    if (event.target.id === "editSheet") {
      state.editing = null;
      state.ask = null;
    }
    if (event.target.id === "askSheet") state.ask = null;
    if (agent && act?.dataset.act !== "edit-agent" && act?.dataset.act !== "trash-agent") {
      state.agent = agent.dataset.agent;
      if (state.editing && state.editing !== state.agent) state.editing = null;
      if (state.follow) followFile(state.agent);
    }
    if (file) state.file = file.dataset.file;
    if (dock) state.dock = dock.dataset.dock;
    if (model) {
      state.model = model.dataset.model;
      state.menu = false;
    }
    if (event.target.closest("#modeBtn")) state.mode = state.mode === "Agent" ? "Plan" : "Agent";
    if (act?.dataset.act === "files") root.classList.toggle("side-off");
    if (act?.dataset.act === "show-files") root.classList.remove("side-off");
    if (act?.dataset.act === "follow") {
      state.follow = !state.follow;
      if (state.follow) followFile();
    }
    const pickedSession = event.target.closest("[data-session]");
    if (act?.dataset.act === "session") state.sessionOpen = !state.sessionOpen;
    else if (!event.target.closest("#sessionMenu")) state.sessionOpen = false;
    if (pickedSession?.dataset.session) {
      state.session = pickedSession.dataset.session;
      state.sessionOpen = false;
      state.soFar = state.session === "Empty chat" ? "" : "Divide raises on zero";
    }
    if (act?.dataset.act === "dock-problems") state.dock = "Problems";
    if (act?.dataset.act === "run-cmd" || act?.dataset.act === "allow-cmd") state.cmd = "ran";
    if (act?.dataset.act === "always-cmd") state.cmd = "always";
    if (act?.dataset.act === "skip-cmd") state.cmd = "skipped";
    if (act?.dataset.act === "chat") root.classList.toggle("chat-only");
    if (act?.dataset.act === "gear" || dock?.dataset.dock === "Settings") {
      state.dock = "Settings";
      state.settings = true;
      state.editing = null;
      state.ask = null;
    }
    if (act?.dataset.act === "edit-agent") {
      state.settings = false;
      state.editing = act.closest("[data-agent]")?.dataset.agent || state.agent;
      state.agent = state.editing;
      document.getElementById("editSheet")?.remove();
    }
    if (act?.dataset.act === "trash-agent") {
      const id = act.closest("[data-agent]")?.dataset.agent;
      if (id) state.ask = { id };
    }
    if (pickedFace && state.editing) {
      const who = applyDraft();
      if (who) who.face = pickedFace.dataset.face;
      document.getElementById("editSheet")?.remove();
    }
    if (act?.dataset.act === "save-agent") {
      const who = state.agents.find((item) => item.id === state.editing);
      const from = who?.name || "";
      applyDraft();
      if (who) retitle(from, who);
      state.editing = null;
      state.ask = null;
    }
    if (act?.dataset.act === "close-edit") {
      state.editing = null;
      state.ask = null;
    }
    if (act?.dataset.act === "delete-agent" && state.editing) state.ask = { id: state.editing };
    if (act?.dataset.act === "cancel-ask") state.ask = null;
    if (act?.dataset.act === "confirm-ask" && state.ask && state.agents.length > 1) {
      const id = state.ask.id;
      state.agents = state.agents.filter((item) => item.id !== id);
      if (state.agent === id) state.agent = state.agents[0].id;
      if (state.editing === id) state.editing = null;
      state.ask = null;
    }
    if (dock && dock.dataset.dock !== "Settings") state.settings = false;
    if (act?.dataset.act === "close-settings") state.settings = false;
    if (act?.dataset.settab) state.settab = act.dataset.settab;
    if (act?.dataset.act === "test-model") state.tested = true;
    if (act?.dataset.act === "add-model") {
      const name = document.getElementById("setName")?.value.trim();
      if (name && !state.models.includes(name)) state.models.push(name);
    }
    if (act?.dataset.act === "save-settings") state.settings = false;
    if (act?.dataset.act === "add-agent") {
      const n = state.agents.length;
      const id = `extra-${n}`;
      state.agents.push({ id, name: `Agent ${n}`, color: "#d2c4a8", face: "✦", line: "Ready", prompt: "You are a coding agent on this folder.", model: "" });
      threads[id] = [];
      state.agent = id;
    }
    if (act?.dataset.act === "add-file" || act?.dataset.act === "add-folder") {
      const name = act.dataset.act === "add-folder"
        ? `notes/note-${Object.keys(state.files).length}.md`
        : `note-${Object.keys(state.files).length}.py`;
      state.files[name] = act.dataset.act === "add-folder" ? "A new folder." : '<span class="kw">#</span> new file';
      state.file = name;
    }
    if (event.target.closest("#modelBtn")) state.menu = !state.menu;
    else if (!model) state.menu = false;
    paint();
  });

  root.addEventListener("submit", (event) => {
    if (event.target.id !== "compose") event.preventDefault();
  });

  document.getElementById("compose").addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = document.getElementById("draft");
    const text = draft.value.trim();
    if (!text) return;
    const agent = state.agents.find((item) => item.id === state.agent) || state.agents[0];
    threads[state.agent] = threads[state.agent] || [];
    state.stick = true;
    threads[state.agent].push({ role: "you", text });
    threads[state.agent].push({
      role: "agent",
      name: agent.name,
      color: agent.color,
      face: agent.face,
      text: state.agent === "senior"
        ? "I will hand that to the workers and leave the review in the dock."
        : `On it. I will keep the change inside ${state.file}.`,
    });
    draft.value = "";
    paint();
  });

  paint();
}

const walkRoot = document.getElementById("walk");
if (walkRoot) {
  const bar = (label, dot) => `
    <header class="fbar">
      <div class="fbrand"><img src="icon.png" alt=""><b>Flint</b></div>
      <div class="wmodel" style="position:relative">
        <button class="fmodel" type="button" data-wact="model"><i class="${dot}"></i><span>${label}</span></button>
        <div class="fmenu" hidden>
          <button type="button" data-wmodel="Qwen3 8B">Qwen3 8B</button>
          <button type="button" data-wmodel="Qwen2.5 Coder">Qwen2.5 Coder</button>
          <button type="button" data-wmodel="Llama 3.1 8B">Llama 3.1 8B</button>
          <button type="button" data-wmodel="DeepSeek R1">DeepSeek R1</button>
          <button type="button" data-wmodel="Offline">Offline</button>
        </div>
      </div>
      <div class="fright">
      <div class="ftools">
        <button type="button" class="on" data-wact="files" title="Files" aria-label="Files"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg></button>
        <button type="button" data-wact="chat" title="Full chat" aria-label="Full chat"><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 3.5h10v7H6.2L3 12.8z"/></svg></button>
        <button type="button" data-wact="gear" title="Settings" aria-label="Settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.7 7.7 0 0 0 .1-3l2-1.2-2-3.4-2.3.6a8 8 0 0 0-2.6-1.5L14.2 2h-4.4l-.4 2.9a8 8 0 0 0-2.6 1.5l-2.3-.6-2 3.4 2 1.2a7.7 7.7 0 0 0 .1 3l-2 1.2 2 3.4 2.3-.6a8 8 0 0 0 2.6 1.5l.4 2.9h4.4l.4-2.9a8 8 0 0 0 2.6-1.5l2.3.6 2-3.4-2-1.2z"/></svg></button>
      </div>
      <div class="fwins" aria-hidden="true"><button type="button" tabindex="-1"><span class="glyph min"></span></button><button type="button" tabindex="-1"><span class="glyph max"></span></button><button type="button" class="close" tabindex="-1"><span class="glyph x"></span></button></div>
      </div>
    </header>`;

  const steps = [
    {
      title: "Open Flint",
      label: "Open",
      text: "Run the installer, then open Flint from the Start menu, Applications, or your app launcher. The window is the app. From a checkout, run <code>npm install</code> and then <code>npm run desktop</code>.",
      frame: `<div class="boot-in"><div class="mark"><img src="boot-icon.png" alt=""><div class="name"><b>Flint</b><small>0.1.3</small></div><div class="boot-track"><i></i></div><span>Starting</span></div></div>`,
      boot: true,
    },
    {
      title: "Start a model server",
      label: "Server",
      text: "Leave it running. Ollama listens at <code>http://127.0.0.1:11434</code>. llama.cpp and LM Studio use an OpenAI-compatible address, often <code>http://127.0.0.1:8080</code>. Offline in the title bar means that address is not answering.",
      frame: `${bar("Offline", "off")}
        <div class="fbody">
          <aside class="fside"><p class="fk">Agents</p><p class="fk">No folder</p></aside>
          <section class="feditor server-card">
            <h4>Listening on this machine</h4>
            <div><span>Ollama</span><span>127.0.0.1:11434</span></div>
            <div><span>llama.cpp</span><span>127.0.0.1:8080</span></div>
          </section>
          <aside class="fchat">
            <div class="fmsgs"><div class="fbubble agent">Offline means this address is not answering yet.</div></div>
          </aside>
        </div>`,
    },
    {
      title: "Add the server in Settings",
      label: "Models",
      text: "Click the gear. Under Models, pick the provider. Flint fills the address. A cloud one needs its key. Press Test. A model count means Flint can see it. Then pick that server in the title bar.",
      frame: `${bar("Model", "")}
        <div class="sheet-host"><form class="sheet">
          <h4>Models</h4>
          <p>Pick a provider. Flint fills the address. Add a key for a cloud one.</p>
          <div class="sgrid">
            <label>Name<input value="Qwen" readonly></label>
            <label>Provider<select><option>Ollama</option><option>OpenAI</option><option>Claude</option><option>DeepSeek</option></select></label>
            <label class="wide">Address<input value="http://127.0.0.1:11434" readonly></label>
          </div>
          <div class="srow"><button type="button" data-wact="add-model">Add model</button></div>
          <div class="model-line"><i class="fdot" style="background:#8fbf7f"></i><span><b>Qwen</b><small>1 model · Test</small></span></div>
        </form></div>`,
    },
    {
      title: "Open a folder",
      label: "Folder",
      keys: "<span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>O</kbd> Open folder</span><span><kbd>Ctrl</kbd><kbd>O</kbd> Open files</span>",
      text: "Use the folder icon, or drag a project onto the window. The file list on the left is that folder. Flint reads and edits only inside it.",
      frame: `${bar("Qwen3 8B", "")}
        <div class="fbody">
          <aside class="fside">
            <p class="fk">calculator</p>
            <button type="button" class="ffile on" data-wfile="calculator.py">calculator.py</button>
            <button type="button" class="ffile" data-wfile="test_calculator.py">test_calculator.py</button>
            <button type="button" class="ffile" data-wfile="README.md">README.md</button>
          </aside>
          <section class="feditor">
            <div class="ftabs"><button type="button" class="ftab on">calculator.py</button></div>
            <pre class="fcode"><div class="fgutter"><span>1</span><span>2</span><span>3</span><span>4</span></div><div class="flines"><span class="kw">def</span> divide(a, b):
    <span class="kw">if</span> b == 0:
        <span class="kw">return</span> None
    <span class="kw">return</span> a / b</div></pre>
          </section>
          <aside class="fchat">
            <div class="fmsgs"><div class="fbubble agent" style="--agent:#f4b860"><div class="fwho"><span class="fface" style="--c:#f4b860">🦊</span><b>Senior</b></div><p>calculator is open. The files stay in this folder.</p></div></div>
          </aside>
        </div>`,
    },
    {
      title: "Name the crew",
      label: "Crew",
      text: "The + next to Agents adds one. The pen edits its name, instructions, and model. Name them yourself. One can split the work. The others take a piece each, and each can use the same model or a different server.",
      frame: `${bar("Qwen3 8B", "")}
        <div class="fbody">
          <aside class="fside">
            <p class="fk" style="display:flex;justify-content:space-between">Agents <button type="button" data-wact="add-crew" style="border:0;background:#1c1b19;color:#ece7dc;border-radius:6px;width:22px;height:22px">+</button></p>
            <button type="button" class="fagent on" data-wagent="Senior">${faceEl({ face: "🦊", color: "#f4b860" })}<span><b>Senior</b><small>Senior engineer</small></span></button>
            <button type="button" class="fagent" data-wagent="Worker 1">${faceEl({ face: "🐢", color: "#7ec8c8" })}<span><b>Worker 1</b><small>Builder</small></span></button>
            <button type="button" class="fagent" data-wagent="Worker 2">${faceEl({ face: "🐙", color: "#e07a5f" })}<span><b>Worker 2</b><small>Reviewer</small></span></button>
          </aside>
          <section class="feditor" style="display:grid;place-items:center">
            <form class="sheet" style="width:min(360px,90%)">
              <h4>Senior</h4>
              <p>Name, instructions, and model.</p>
              <div class="sgrid">
                <label class="wide">Name<input value="Senior" readonly></label>
                <label class="wide">Model<input value="Qwen3 8B" readonly></label>
              </div>
            </form>
          </section>
          <aside class="fchat"></aside>
        </div>`,
    },
    {
      title: "Send the job",
      label: "Send",
      keys: "<span><kbd>Enter</kbd> Send</span><span><kbd>Ctrl</kbd><kbd>K</kbd> Commands</span><span><kbd>Ctrl</kbd><kbd>I</kbd> Edit the selection</span>",
      text: "Chat is the right-hand column. Agent mode can edit files and run commands. Plan mode can only read. A command waits until you press Run, Allow this, or Allow always. Stop ends the turn.",
      frame: `${bar("Qwen3 8B", "")}
        <div class="fbody">
          <aside class="fside">
            <p class="fk">Agents</p>
            <button type="button" class="fagent on" data-wagent="Senior"><span class="fface" style="--c:#f4b860">🦊</span><span><b>Senior</b><small class="doing">Waiting on 2 workers</small></span></button>
          </aside>
          <section class="feditor">
            <div class="ftabs"><button type="button" class="ftab on">calculator.py</button></div>
            <pre class="fcode"><div class="flines"><span class="kw">def</span> divide(a, b):\n    <span class="kw">raise</span> ZeroDivisionError</div></pre>
          </section>
          <aside class="fchat">
            <div class="fmsgs">
              <div class="fbubble you">Fix divide by zero.</div>
              <div class="fbubble agent" style="--agent:#f4b860">
                <div class="fwho"><span class="fface" style="--c:#f4b860">🦊</span><b>Senior</b></div>
                <div class="fcrew">
                  <div class="frow-crew" style="--c:#7ec8c8"><span class="fface" style="--c:#7ec8c8">🐢</span><span><b>Worker 1</b><small>Editing calculator.py</small><em>Raise on divide by zero.</em><button type="button" class="ffile-chip" data-wfile="calculator.py">calculator.py</button></span></div>
                  <div class="frow-crew" style="--c:#e07a5f"><span class="fface" style="--c:#e07a5f">🐙</span><span><b>Worker 2</b><small>Reading the tests</small><em>Add the zero case.</em><button type="button" class="ffile-chip" data-wfile="test_calculator.py">test_calculator.py</button></span></div>
                </div>
                <p class="fqueue"><span>Model</span><b>Worker 1</b><span>now</span><span>·</span><b>Worker 2</b><span>next</span></p>
                <div class="fcmd"><code>python -m unittest</code><span class="fcmd-actions"><button type="button" data-wact="run">Run</button><button type="button" data-wact="always">Allow always</button><button type="button" data-wact="skip">Skip</button></span></div>
              </div>
            </div>
            <form class="fcompose"><div class="fbox"><textarea placeholder="Message Senior" aria-label="Message"></textarea><div class="frow"><button type="button" class="fchip" data-wmode>Agent</button><button type="submit">Send</button></div></div></form>
          </aside>
        </div>`,
    },
    {
      title: "Keep the next session small",
      label: "Sessions",
      text: "The session name in the chat header opens the list. New starts a fresh chat and keeps the old one. Search, fork, and export are in that list. A long thread is why replies get slower. Start a new session for a new task.",
      frame: `${bar("Qwen3 8B", "")}
        <div class="fbody" style="grid-template-columns:minmax(0,1fr)">
          <aside class="fchat" style="border:0">
            <div class="session-top"><button type="button" class="on" data-wact="sessions">Calculator divide</button><button type="button" data-wact="new-session">New</button></div>
            <div class="sdraw" data-sessions>
              <input placeholder="Search sessions" aria-label="Search sessions">
              <div class="sacts"><button type="button" data-wact="fork">Fork</button><button type="button" data-wact="export">Export</button></div>
              <button type="button" class="on" data-wsession="Calculator divide"><b>Calculator divide</b></button>
              <button type="button" data-wsession="Window layout"><b>Window layout</b></button>
            </div>
            <div class="fmsgs"><div class="fbubble agent" style="--agent:#f4b860"><div class="fwho"><span class="fface" style="--c:#f4b860">🦊</span><b>Senior</b></div><p>This thread is the divide fix. A new task gets a new session.</p></div></div>
          </aside>
        </div>`,
    },
  ];

  let index = 0;
  let timer = 0;
  let locked = false;
  const stage = document.getElementById("walkStage");

  stage.addEventListener("click", (event) => {
    const act = event.target.closest("[data-wact]");
    const picked = event.target.closest("[data-wmodel]");
    const file = event.target.closest("[data-wfile]");
    const agent = event.target.closest("[data-wagent]");
    const session = event.target.closest("[data-wsession]");
    const mode = event.target.closest("[data-wmode]");
    if (!(act || picked || file || agent || session || mode)) return;
    stop();
    if (act?.dataset.wact === "files") stage.classList.toggle("side-off");
    if (act?.dataset.wact === "chat") stage.classList.toggle("chat-only");
    if (act?.dataset.wact === "model") {
      const menu = act.parentElement.querySelector(".fmenu");
      if (menu) menu.hidden = !menu.hidden;
      act.classList.toggle("on", menu ? !menu.hidden : false);
    } else stage.querySelectorAll(".fmenu").forEach((menu) => { menu.hidden = true; });
    if (picked) {
      const label = stage.querySelector("[data-wact=model] span");
      const dot = stage.querySelector("[data-wact=model] i");
      if (label) label.textContent = picked.dataset.wmodel;
      if (dot) dot.classList.toggle("off", picked.dataset.wmodel === "Offline");
      picked.parentElement.hidden = true;
    }
    if (act?.dataset.wact === "gear") {
      const open = stage.querySelector(".gear-sheet");
      if (open) open.remove();
      else {
        const host = document.createElement("div");
        host.className = "sheet-host gear-sheet";
        host.innerHTML = `<form class="sheet"><h4>Models</h4><p>Add a server you already run. One address per model.</p><div class="sgrid"><label class="wide">Name<input value="Qwen"></label><label class="wide">Address<input value="http://127.0.0.1:11434"></label></div><div class="srow"><button type="button" data-wact="add-model">Add model</button></div></form>`;
        stage.appendChild(host);
      }
    }
    if (act?.dataset.wact === "add-model") act.textContent = "Added";
    if (act?.dataset.wact === "run" || act?.dataset.wact === "always" || act?.dataset.wact === "skip") {
      const card = act.closest(".fcmd");
      const label = act.dataset.wact === "skip" ? "Skipped" : act.dataset.wact === "always" ? "Allow always" : "Ran";
      if (card) {
        const actions = card.querySelector(".fcmd-actions");
        if (actions) actions.outerHTML = `<span class="fcmd-state">${label}</span>`;
      } else {
        const row = act.closest(".runrow");
        if (row) row.querySelector("span").innerHTML = '<span class="add">OK</span>';
        act.textContent = "Done";
      }
    }
    if (act?.dataset.wact === "fork") {
      const current = stage.querySelector("[data-wact=sessions]");
      if (current) current.textContent = `${current.textContent.replace(/ copy$/, "")} copy`;
    }
    if (act?.dataset.wact === "export") act.textContent = "Saved";
    if (file) {
      stage.querySelectorAll("[data-wfile]").forEach((button) => button.classList.toggle("on", button === file));
      const tab = stage.querySelector(".ftab");
      if (tab) tab.textContent = file.dataset.wfile;
    }
    if (agent) {
      stage.querySelectorAll("[data-wagent]").forEach((button) => button.classList.toggle("on", button === agent));
      const title = stage.querySelector(".sheet h4");
      if (title && !title.closest(".gear-sheet")) title.textContent = agent.dataset.wagent;
      const box = stage.querySelector(".fcompose textarea");
      if (box) box.placeholder = `Message ${agent.dataset.wagent}`;
    }
    if (act?.dataset.wact === "add-crew") {
      const side = stage.querySelector(".fside");
      if (side) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "fagent";
        button.dataset.wagent = "New agent";
        button.innerHTML = '<span class="fface" style="--c:#d2c4a8">✦</span><span><b>New agent</b><small>Ready</small></span>';
        side.appendChild(button);
      }
    }
    if (mode) {
      mode.textContent = mode.textContent === "Agent" ? "Plan" : "Agent";
      mode.classList.toggle("off", mode.textContent === "Plan");
    }
    if (act?.dataset.wact === "sessions") {
      const list = stage.querySelector("[data-sessions]");
      if (list) list.hidden = !list.hidden;
    }
    if (act?.dataset.wact === "new-session") {
      const current = stage.querySelector("[data-wact=sessions]");
      if (current) current.textContent = "New session";
      const list = stage.querySelector("[data-sessions]");
      if (list) list.hidden = true;
    }
    if (session) {
      const current = stage.querySelector("[data-wact=sessions]");
      if (current) current.textContent = session.dataset.wsession;
      stage.querySelectorAll("[data-wsession]").forEach((button) => button.classList.toggle("on", button === session));
    }
    const filesBtn = stage.querySelector('[data-wact="files"]');
    const chatBtn = stage.querySelector('[data-wact="chat"]');
    if (filesBtn) filesBtn.classList.toggle("on", !stage.classList.contains("side-off"));
    if (chatBtn) chatBtn.classList.toggle("on", stage.classList.contains("chat-only"));
  });

  stage.addEventListener("submit", (event) => {
    event.preventDefault();
    const draft = event.target.querySelector("textarea");
    const text = draft?.value.trim();
    if (!text) return;
    const msgs = stage.querySelector(".fmsgs");
    if (msgs) {
      const you = document.createElement("div");
      you.className = "fbubble you";
      you.textContent = text;
      const reply = document.createElement("div");
      reply.className = "fbubble agent";
      reply.style.setProperty("--agent", "#f4b860");
      reply.innerHTML = '<div class="fwho"><span class="fface" style="--c:#f4b860">🦊</span><b>Senior</b></div><p>On it. I will leave the change for you to keep.</p>';
      msgs.append(you, reply);
      msgs.scrollTop = msgs.scrollHeight;
    }
    draft.value = "";
    stop();
  });

  function show(next) {
    index = (next + steps.length) % steps.length;
    const step = steps[index];
    document.getElementById("walkNum").textContent = String(index + 1).padStart(2, "0");
    document.getElementById("walkTitle").textContent = step.title;
    document.getElementById("walkText").innerHTML = step.text;
    document.getElementById("walkKeys").innerHTML = step.keys || "";
    stage.className = step.boot ? "flint mini boot" : "flint mini";
    stage.innerHTML = step.frame;
    document.getElementById("walkDots").innerHTML = steps.map((item, itemIndex) => `
      <button type="button" role="tab" aria-selected="${itemIndex === index}" class="${itemIndex === index ? "on" : ""} ${itemIndex < index ? "done" : ""}" data-step="${itemIndex}">
        <i></i><span>${item.label}</span>
      </button>`).join("");
  }

  function stop() {
    window.clearInterval(timer);
    timer = 0;
    locked = true;
  }

  function arm() {
    if (locked || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.clearInterval(timer);
    timer = window.setInterval(() => show(index + 1), 8000);
  }

  walkRoot.addEventListener("click", (event) => {
    const step = event.target.closest("[data-step]");
    const go = event.target.closest("[data-go]");
    if (step || go || event.target.closest("#walkPrev") || event.target.closest("#walkNext")) stop();
    if (step) show(Number(step.dataset.step));
    if (go) show(Number(go.dataset.go) - 1);
    if (event.target.closest("#walkPrev")) show(index - 1);
    if (event.target.closest("#walkNext")) show(index + 1);
  });
  walkRoot.addEventListener("submit", (event) => event.preventDefault());
  walkRoot.addEventListener("pointerenter", () => window.clearInterval(timer));
  walkRoot.addEventListener("pointerleave", arm);

  show(0);
  arm();
}
