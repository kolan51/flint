import React, { useEffect, useState } from "react";
import { useApp } from "../store.jsx";

export default function AskDialog() {
  const { askBox, finishAsk } = useApp();
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(askBox?.value || "");
  }, [askBox]);

  useEffect(() => {
    if (!askBox) return undefined;
    function onKey(event) {
      if (event.key === "Escape") finishAsk(askBox.input ? null : false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [askBox, finishAsk]);

  if (!askBox) return null;
  const confirm = askBox.confirm || (askBox.input ? "Save" : "Delete");

  function submit(event) {
    event?.preventDefault();
    if (askBox.input) {
      const next = value.trim();
      finishAsk(next || null);
      return;
    }
    finishAsk(true);
  }

  return (
    <div className="modal-back ask-back" onClick={() => finishAsk(askBox.input ? null : false)}>
      <form className="ask" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <h2>{askBox.title || "Are you sure?"}</h2>
        {askBox.body && <p>{askBox.body}</p>}
        {askBox.input && (
          <input
            className="field"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <div className="ask-actions">
          <button type="button" className="ghost" onClick={() => finishAsk(askBox.input ? null : false)}>
            {askBox.cancel || "Cancel"}
          </button>
          <button type="submit" className={`btn ${askBox.danger ? "danger" : ""}`} autoFocus={!askBox.input}>
            {confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
