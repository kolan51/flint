import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../store.jsx";
import FieldSelect from "./FieldSelect.jsx";
import AgentFace from "./AgentFace.jsx";
import { FACES, catalogFace, defaultFace, isImageFace, storedAvatar } from "../faces.js";

function shortModel(model) {
  return String(model || "").split(/[/\\]/).pop().replace(/\.gguf$/i, "");
}

export default function AgentStudio() {
  const { agents, activeAgent, persistAgents, setModal, setActiveAgentId, settings, ask } = useApp();
  const [draft, setDraft] = useState(
    activeAgent || { id: "", name: "", provider: "", model: "", systemPrompt: "" }
  );
  const [servers, setServers] = useState([]);
  const [mark, setMark] = useState("");
  const fileRef = useRef(null);
  const shownId = isImageFace(draft.avatar) ? "" : (catalogFace(draft.avatar)?.id || (draft.avatar ? "" : defaultFace(draft).id));

  useEffect(() => {
    const providers = Object.values(settings?.providers || {});
    let cancel = false;
    setServers(providers.map((provider) => ({ id: provider.id, name: provider.name, models: [], error: "" })));
    Promise.all(
      providers.map(async (provider) => {
        try {
          const data = await api.models(provider.id);
          return { id: provider.id, name: provider.name, models: data.models || [], error: "" };
        } catch (err) {
          return { id: provider.id, name: provider.name, models: [], error: err.message };
        }
      })
    ).then((next) => {
      if (!cancel) setServers(next);
    });
    return () => {
      cancel = true;
    };
  }, [settings]);

  function useImage(file) {
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
      setDraft({ ...draft, avatar: canvas.toDataURL("image/jpeg", 0.72) });
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  async function save() {
    if (!draft.name.trim() || !draft.id) return;
    const avatar = storedAvatar(draft.avatar);
    const next = { ...draft, name: draft.name.trim(), avatar };
    await persistAgents(agents.map((agent) => (agent.id === next.id ? { ...agent, ...next } : agent)));
    setActiveAgentId(next.id);
    setModal(null);
  }

  async function remove() {
    if (agents.length < 2) {
      await ask({ title: "Keep one agent", body: "Flint needs at least one agent.", confirm: "OK" });
      return;
    }
    const ok = await ask({ title: "Delete this agent", body: draft.name || "Agent", confirm: "Delete", danger: true });
    if (!ok) return;
    const list = agents.filter((agent) => agent.id !== draft.id);
    await persistAgents(list);
    setActiveAgentId(list[0]?.id || "");
    setModal(null);
  }

  return (
    <div className="modal-back" onPointerDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className="modal modal-sheet" onPointerDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{draft.name || "Agent"}</h2>
            <p className="dir-label">Name it and say how it should work.</p>
          </div>
          <button type="button" className="modal-x" aria-label="Close" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setModal(null); }}>
            <span className="glyph x" />
          </button>
        </div>
        <div className="modal-body">
        <label>
          Name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
        </label>
        <div className="face-field">
          <span>Face</span>
          <div className="face-current">
            <AgentFace agent={draft} size="lg" />
            <div>
              <p>Pick a face, or use your own picture. It shows in the list and on this bot’s replies.</p>
              <div className="face-actions">
                <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>Use an image</button>
                {draft.avatar && (
                  <button type="button" className="ghost" onClick={() => setDraft({ ...draft, avatar: "" })}>Clear</button>
                )}
              </div>
            </div>
          </div>
          <div className="face-pick">
            {FACES.map((face) => (
              <button
                type="button"
                key={face.id}
                className={shownId === face.id ? "on" : ""}
                aria-label={face.label}
                onClick={() => {
                  setMark("");
                  setDraft({ ...draft, avatar: face.id });
                }}
              >
                <img src={face.src} alt="" />
              </button>
            ))}
          </div>
          <input
            className="face-mark"
            value={mark}
            placeholder="Or type an emoji"
            onChange={(e) => {
              const next = storedAvatar(e.target.value);
              setMark(e.target.value);
              if (next) setDraft({ ...draft, avatar: next });
            }}
          />
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { useImage(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {servers.length > 0 && (
          <label>
            Model
            <FieldSelect
              ariaLabel="Model"
              value={draft.provider && draft.model ? `${draft.provider}::${draft.model}` : ""}
              options={[
                { value: "", label: `Same as the app · ${settings?.providers?.[settings?.activeProvider]?.name || "title bar"}` },
                ...servers.flatMap((server) => (
                  server.models.length > 0
                    ? server.models.map((model) => ({
                      value: `${server.id}::${model}`,
                      label: `${server.name} · ${shortModel(model)}`,
                    }))
                    : [{ value: `offline:${server.id}`, label: `${server.name} · ${server.error ? "offline" : "looking up…"}`, disabled: true }]
                )),
              ]}
              onChange={(value) => {
                if (!value || value.startsWith("offline:")) {
                  setDraft({ ...draft, provider: "", model: "" });
                  return;
                }
                const [provider, ...rest] = value.split("::");
                setDraft({ ...draft, provider, model: rest.join("::") });
              }}
            />
            <span className="model-hint">The title bar is the app model. This agent follows it only on the first choice.</span>
          </label>
        )}
        <label>
          Prompt
          <textarea className="field" value={draft.systemPrompt || ""} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
        </label>
        <div className="row end">
          <button type="button" className="ghost" onClick={remove}>Delete</button>
          <button type="button" className="btn" onClick={save}>Save</button>
        </div>
        </div>
      </div>
    </div>
  );
}
