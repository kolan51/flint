import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function FieldSelect({ value, onChange, options, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const root = useRef(null);
  const menu = useRef(null);
  const current = options.find((item) => item.value === value) || options.find((item) => !item.disabled);

  useEffect(() => {
    if (!open) return undefined;
    function close(event) {
      if (root.current?.contains(event.target) || menu.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const height = Math.min(260, options.length * 36 + 8);
    const top = below < height && rect.top > height ? rect.top - height - 6 : rect.bottom + 6;
    setBox({ top, left: rect.left, width: rect.width });
    setOpen((prev) => !prev);
  }

  return (
    <div className={`field-select ${open ? "open" : ""}`} ref={root}>
      <button type="button" aria-label={ariaLabel} aria-expanded={open} onClick={toggle}>
        <span>{current?.label || "Choose"}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {open && box && createPortal(
        <div
          className="field-menu"
          ref={menu}
          role="listbox"
          style={{ top: box.top, left: box.left, width: box.width }}
        >
          {options.map((item) => (
            <button
              type="button"
              key={item.value}
              role="option"
              aria-selected={item.value === value}
              className={item.value === value ? "on" : ""}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onChange(item.value);
                setOpen(false);
              }}
            >
              <b>{item.label}</b>
              {item.hint && <small>{item.hint}</small>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
