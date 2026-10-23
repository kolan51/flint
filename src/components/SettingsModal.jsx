import React, { useState } from "react";
import { useApp } from "../store.jsx";
import { slugId } from "../backends.js";
import { api } from "../api.js";
import { APP_VERSION, DEFAULT_RELEASE_REPO, pickInstaller } from "../updates.js";
import FieldSelect from "./FieldSelect.jsx";
import { VENDORS, applyVendor, vendorById, vendorOf } from "../catalog.js";

const emptyForm = { name: "", baseUrl: "http://127.0.0.1:11434", kind: "ollama", vendor: "ollama", apiKey: "" };

function openRelease(url) {
  if (!url) return;
  if (window.desktop?.openExternal) window.desktop.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

async function installUpdate(info) {
  const asset = pickInstaller(info?.assets || []);
  if (!asset) return openRelease(info?.url);
  if (window.desktop?.installUpdate) {
    await window.desktop.installUpdate(asset);
    return;
  }
  openRelease(asset.url);
}

export default function SettingsModal() {
  const { settings, persistSettings, refreshModels, refreshBackendStatus, setModal, backendStatus, updateInfo, checkUpdates } = useApp();
  const [form, setForm] = useState(emptyForm);
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState(null);
  const [editing, setEditing] = useState(null);
  const [searchForm, setSearchForm] = useState(settings?.search || { provider: "duckduckgo", braveKey: "" });
  const [searchSaved, setSearchSaved] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: "", command: "", args: "" });
  const providers = Object.values(settings?.providers || {});

  async function saveSearch(event) {
    event.preventDefault();
    const saved = await persistSettings({
      ...settings,
      search: {
        provider: searchForm.provider === "brave" ? "brave" : "duckduckgo",
        braveKey: searchForm.braveKey || "",
      },
    });
    setSearchForm(saved.search || searchForm);
    setSearchSaved(true);
  }

  async function addMcp(event) {
    event.preventDefault();
    if (!mcpForm.command.trim()) return;
    const id = mcpForm.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "mcp";
    await persistSettings({
      ...settings,
      mcp: [...(settings.mcp || []).filter((item) => item.id !== id), { id, name: mcpForm.name.trim() || mcpForm.command.trim(), command: mcpForm.command.trim(), args: mcpForm.args }],
    });
    setMcpForm({ name: "", command: "", args: "" });
  }

  async function removeMcp(id) {
    await persistSettings({ ...settings, mcp: (settings.mcp || []).filter((item) => item.id !== id) });
  }

  async function addBackend(event) {
    event.preventDefault();
    const vendor = vendorById(form.vendor);
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    if (vendor.key === true && !form.apiKey.trim()) {
      setConnection({ key: "add", ok: false, error: "This provider needs an API key.", models: [] });
      return;
    }
    const id = slugId(form.name, settings.providers || {});
    const next = {
      ...settings,
      providers: {
        ...settings.providers,
        [id]: {
          id,
          name: form.name.trim(),
          kind: form.kind,
          vendor: form.vendor,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
        },
      },
      activeProvider: settings.activeProvider || id,
    };
    const saved = await persistSettings(next);
    setForm(emptyForm);
    setProbe(null);
    await refreshModels(saved.activeProvider);
    await refreshBackendStatus();
  }

  async function removeBackend(id) {
    const providersNext = { ...settings.providers };
    delete providersNext[id];
    const saved = await persistSettings({
      ...settings,
      providers: providersNext,
      activeProvider: settings.activeProvider === id ? Object.keys(providersNext)[0] || "" : settings.activeProvider,
    });
    await refreshModels(saved.activeProvider);
    await refreshBackendStatus();
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing?.name.trim() || !editing.baseUrl.trim()) return;
    const current = settings.providers[editing.id];
    if (!current) return;
    const saved = await persistSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [editing.id]: {
          ...current,
          name: editing.name.trim(),
          kind: editing.kind,
          vendor: editing.vendor,
          baseUrl: editing.baseUrl.trim(),
          apiKey: String(editing.apiKey || "").trim(),
        },
      },
    });
    setEditing(null);
    await refreshModels(saved.activeProvider);
    await refreshBackendStatus();
  }

  function probeLine(result) {
    if (!result || result.busy) return "";
    if (!result.ok) return result.error || "Could not reach that address.";
    const count = result.models?.length || 0;
    return count === 1 ? "1 model found" : `${count} models found`;
  }

  async function testConnection(key, provider) {
    const baseUrl = String(provider.baseUrl || "").trim();
    if (!baseUrl) {
      setConnection({ key, ok: false, error: "Enter an address first.", models: [] });
      return;
    }
    setConnection({ key, busy: true });
    try {
      const result = await api.probeBackend({
        id: provider.id || "draft",
        name: provider.name || "Draft",
        kind: provider.kind || "openai",
        baseUrl,
        apiKey: provider.apiKey || "",
      });
      setConnection({ key, ...result, busy: false });
    } catch (err) {
      setConnection({ key, ok: false, error: err.message, models: [], busy: false });
    }
  }

  function connectionNote(key, className = "") {
    if (!connection || connection.key !== key || connection.busy) return null;
    return <p className={`${connection.ok ? "ok" : "warn"} ${className}`.trim()}>{probeLine(connection)}</p>;
  }

  async function testBackend(provider) {
    setBusy(provider.id);
    try {
      const result = await api.probeBackend(provider);
      setProbe({ id: provider.id, ...result });
      if (result.ok && result.models?.[0] && !settings.defaultModel) {
        await persistSettings({ ...settings, defaultModel: result.models[0], activeProvider: provider.id });
      }
      await refreshBackendStatus();
    } catch (err) {
      setProbe({ id: provider.id, ok: false, error: err.message, models: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={() => setModal(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Settings</h2>
            <p className="dir-label">Models, commands, search, and updates.</p>
          </div>
          <button className="ghost" onClick={() => setModal(null)}>Close</button>
        </div>

        <h3 className="settings-section">Models</h3>
        <p className="dir-label">A local server, or ChatGPT, Claude, DeepSeek, and the other APIs. The key stays on this machine.</p>

        {providers.length > 0 && (
          <div className="list">
            {providers.map((item) => {
              const live = backendStatus[item.id];
              const shown = probe?.id === item.id ? probe : live;
              if (editing?.id === item.id) {
                return (
                  <form className="model-edit" key={item.id} onSubmit={saveEdit}>
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      aria-label="Name"
                    />
                    <FieldSelect
                      ariaLabel="Provider"
                      value={vendorOf(editing)}
                      options={VENDORS.map((item) => ({ value: item.id, label: item.label, hint: item.hint }))}
                      onChange={(id) => setEditing(applyVendor(id, editing))}
                    />
                    <input
                      className="span-2"
                      value={editing.baseUrl}
                      onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                      aria-label="Address"
                    />
                    {vendorById(vendorOf(editing)).key !== false && (
                      <input
                        className="span-2"
                        type="password"
                        value={editing.apiKey || ""}
                        onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                        placeholder="API key"
                        aria-label="API key"
                        autoComplete="off"
                      />
                    )}
                    <div className="row end span-2">
                      <button
                        className="ghost"
                        type="button"
                        disabled={connection?.key === `edit:${item.id}` && connection.busy}
                        onClick={() => testConnection(`edit:${item.id}`, editing)}
                      >
                        {connection?.key === `edit:${item.id}` && connection.busy ? "Testing…" : "Test connection"}
                      </button>
                      <button className="ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
                      <button className="btn" type="submit">Save</button>
                    </div>
                    {connectionNote(`edit:${item.id}`, "span-2")}
                  </form>
                );
              }
              return (
                <div className="model-row" key={item.id}>
                  <span className={`pulse-dot ${shown?.ok ? "on" : shown ? "off" : ""}`} />
                  <span className="copy">
                    <b>{item.name}</b>
                    <small>{item.baseUrl}</small>
                  </span>
                  <button className="ghost" onClick={() => setEditing({ id: item.id, name: item.name, kind: item.kind, vendor: vendorOf(item), baseUrl: item.baseUrl, apiKey: item.apiKey || "" })}>
                    Edit
                  </button>
                  <button className="ghost" disabled={busy === item.id} onClick={() => testBackend(item)}>
                    {busy === item.id ? "…" : "Test"}
                  </button>
                  <button className="ghost" onClick={() => removeBackend(item.id)}>Remove</button>
                </div>
              );
            })}
            {probe && <p className={probe.ok ? "ok" : "warn"}>{probe.ok ? `${probe.models.length} models found` : probe.error}</p>}
          </div>
        )}

        <form onSubmit={addBackend}>
          <div className="grid">
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Qwen 9B" />
            </label>
            <label>
              Provider
              <FieldSelect
                ariaLabel="Provider"
                value={form.vendor || "ollama"}
                options={VENDORS.map((item) => ({ value: item.id, label: item.label, hint: item.hint }))}
                onChange={(id) => setForm(applyVendor(id, form))}
              />
            </label>
            <label className="span-2">
              Address
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://127.0.0.1:11434" />
            </label>
            {vendorById(form.vendor).key !== false && (
              <label className="span-2">
                API key
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={form.vendor === "anthropic" ? "sk-ant-…" : "sk-…"}
                  autoComplete="off"
                />
              </label>
            )}
          </div>
          <div className="row end">
            <button
              className="ghost"
              type="button"
              disabled={connection?.key === "add" && connection.busy}
              onClick={() => testConnection("add", form)}
            >
              {connection?.key === "add" && connection.busy ? "Testing…" : "Test connection"}
            </button>
            <button className="btn" type="submit">Add model</button>
          </div>
          {connectionNote("add")}
        </form>

        <div className="search-setup">
          <h3>Autocomplete</h3>
          <p className="dir-label">Grey text finishes a word from names already in the file. It runs here, and it does not call a model.</p>
          <label className="check-line">
            <input
              type="checkbox"
              checked={settings?.completion?.enabled !== false}
              onChange={(event) => persistSettings({ ...settings, completion: { enabled: event.target.checked } })}
            />
            Autocomplete
          </label>
        </div>

        <form className="search-setup" onSubmit={(event) => event.preventDefault()}>
          <h3>Commands</h3>
          <p className="dir-label">When an agent wants to run a command in this folder.</p>
          <label>
            Approval
            <FieldSelect
              ariaLabel="Approval"
              value={settings?.commands?.mode === "allow" ? "allow" : "ask"}
              options={[
                { value: "ask", label: "Ask each time" },
                { value: "allow", label: "Allow always" },
              ]}
              onChange={(value) => persistSettings({ ...settings, commands: { ...settings.commands, mode: value === "allow" ? "allow" : "ask" } })}
            />
          </label>
          {(settings?.commands?.allow || []).length > 0 && (
            <div className="allow-list">
              {settings.commands.allow.map((command) => (
                <div key={command} className="cmd-wait">
                  <code>{command}</code>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => persistSettings({
                      ...settings,
                      commands: { ...settings.commands, allow: settings.commands.allow.filter((item) => item !== command) },
                    })}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="search-setup">
          <h3>Updates</h3>
          <div className="update-line">
            <div className="update-copy">
              <b>Flint {updateInfo?.current || APP_VERSION}</b>
              {updateInfo?.error && <p className="warn">{updateInfo.error}</p>}
              {updateInfo?.available && <p className="ok">Flint {updateInfo.latest} is ready.</p>}
              {updateInfo?.latest && !updateInfo.available && !updateInfo.error && !updateInfo.checking && (
                <p className="dir-label">You're up to date.</p>
              )}
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={settings?.updates?.check !== false}
                onChange={(event) => persistSettings({
                  ...settings,
                  updates: { check: event.target.checked, repo: settings?.updates?.repo || DEFAULT_RELEASE_REPO },
                })}
              />
              Check on startup
            </label>
            {updateInfo?.available ? (
              <button type="button" className="btn" onClick={() => installUpdate(updateInfo)}>Install</button>
            ) : (
              <button className="ghost" type="button" disabled={updateInfo?.checking} onClick={() => checkUpdates()}>
                {updateInfo?.checking ? "Checking…" : "Check now"}
              </button>
            )}
          </div>
        </div>

        <form className="search-setup" onSubmit={saveSearch}>
          <h3>Web search</h3>
          <p className="dir-label">Flint searches the web. The model server does not.</p>
          <div className="grid">
            <label>
              Provider
              <FieldSelect
                ariaLabel="Provider"
                value={searchForm.provider === "brave" ? "brave" : "duckduckgo"}
                options={[
                  { value: "duckduckgo", label: "DuckDuckGo", hint: "No key" },
                  { value: "brave", label: "Brave", hint: "Needs a key" },
                ]}
                onChange={(value) => setSearchForm({ ...searchForm, provider: value })}
              />
            </label>
            <label>
              Brave key
              <input
                type="password"
                value={searchForm.braveKey}
                onChange={(e) => setSearchForm({ ...searchForm, braveKey: e.target.value })}
                placeholder={searchForm.provider === "brave" ? "Required for Brave" : "Optional"}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="row end">
            {searchSaved && <span className="dir-label">Saved</span>}
            <button className="btn" type="submit">Save search</button>
          </div>
        </form>

        <form className="search-setup" onSubmit={addMcp}>
          <h3>MCP</h3>
          <p className="dir-label">A local tool server. Flint starts it. The model server does not.</p>
          {(settings.mcp || []).map((item) => (
            <div className="model-row" key={item.id}>
              <span className="copy">
                <b>{item.name}</b>
                <small>{item.command} {item.args}</small>
              </span>
              <button className="ghost" type="button" onClick={() => removeMcp(item.id)}>Remove</button>
            </div>
          ))}
          <div className="grid">
            <label>
              Name
              <input value={mcpForm.name} onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })} placeholder="filesystem" />
            </label>
            <label>
              Command
              <input value={mcpForm.command} onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })} placeholder="npx" />
            </label>
            <label className="span-2">
              Arguments
              <input value={mcpForm.args} onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })} placeholder="-y @modelcontextprotocol/server-filesystem ." />
            </label>
          </div>
          <div className="row end">
            <button className="btn" type="submit">Add MCP server</button>
          </div>
        </form>
      </div>
    </div>
  );
}
