import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const KEY = "flint.panes";
const DEFAULTS = { left: 248, right: 380, dock: 240, preview: 42, agents: 280 };
const LIMITS = {
  left: [150, 520],
  right: [200, 720],
  dock: [140, 640],
  preview: [24, 70],
  agents: [120, 560],
};

export function fitPanes(shellWidth, preferredLeft, preferredRight, leftOpen, rightOpen) {
  const width = Math.round(Number(shellWidth));
  const leftWanted = leftOpen ? clamp("left", preferredLeft) : 0;
  const rightWanted = rightOpen ? clamp("right", preferredRight) : 0;
  if (!leftWanted && !rightWanted) return { left: 0, right: 0 };
  if (!Number.isFinite(width) || width <= 0) return { left: leftWanted, right: rightWanted };

  const leftFloor = leftWanted ? 156 : 0;
  const rightFloor = rightWanted ? 200 : 0;
  const editorFloor = 180;
  if (width >= leftWanted + rightWanted + editorFloor) return { left: leftWanted, right: rightWanted };

  const floors = leftFloor + rightFloor + editorFloor;
  if (width >= floors) {
    let extra = width - floors;
    let left = leftFloor;
    let right = rightFloor;
    const leftGrow = Math.max(0, leftWanted - leftFloor);
    const rightGrow = Math.max(0, rightWanted - rightFloor);
    const grow = leftGrow + rightGrow;
    if (grow > 0 && extra > 0) {
      const giveLeft = Math.min(leftGrow, Math.round(extra * (leftGrow / grow)));
      left += giveLeft;
      right += Math.min(rightGrow, extra - giveLeft);
    }
    return { left, right };
  }

  const editorShare = 0.3;
  const leftShare = leftWanted ? 0.3 : 0;
  const rightShare = rightWanted ? 0.4 : 0;
  const scale = 1 / (leftShare + rightShare + editorShare);
  let left = leftWanted ? Math.round(width * leftShare * scale) : 0;
  let right = rightWanted ? Math.round(width * rightShare * scale) : 0;
  const editorKeep = Math.min(96, Math.round(width * 0.22));
  if (left + right > width - editorKeep) {
    const fit = Math.max(0, width - editorKeep);
    const sum = left + right || 1;
    left = left ? Math.round(fit * (left / sum)) : 0;
    right = right ? fit - left : 0;
  }
  return { left: Math.max(0, left), right: Math.max(0, right) };
}

const PaneContext = createContext(null);

function clamp(name, value) {
  const [min, max] = LIMITS[name];
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULTS[name];
  return Math.min(max, Math.max(min, Math.round(number)));
}

function readSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      left: clamp("left", saved.left),
      right: clamp("right", saved.right),
      dock: clamp("dock", saved.dock),
      preview: clamp("preview", saved.preview),
      agents: clamp("agents", saved.agents),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function PaneProvider({ children }) {
  const [sizes, setSizes] = useState(readSizes);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  }, [sizes]);
  const api = useMemo(() => ({
    sizes,
    set(name, value) {
      setSizes((prev) => ({ ...prev, [name]: clamp(name, value) }));
    },
    reset(name) {
      setSizes((prev) => ({ ...prev, [name]: DEFAULTS[name] }));
    },
  }), [sizes]);
  return <PaneContext.Provider value={api}>{children}</PaneContext.Provider>;
}

export function usePanes() {
  return useContext(PaneContext);
}

const AXIS = {
  left: { cursor: "col-resize", from: (event) => event.clientX, sign: 1 },
  right: { cursor: "col-resize", from: (event) => event.clientX, sign: -1 },
  dock: { cursor: "row-resize", from: (event) => event.clientY, sign: -1 },
  agents: { cursor: "row-resize", from: (event) => event.clientY, sign: 1 },
  preview: { cursor: "col-resize", from: (event) => event.clientX, sign: -1 },
};

export function Splitter({ name }) {
  const panes = usePanes();
  if (!panes) return null;
  const axis = AXIS[name];

  function apply(start, event) {
    if (name === "preview") {
      const width = start.width || 1;
      const fromRight = start.right - event.clientX;
      panes.set(name, (fromRight / width) * 100);
      return;
    }
    const delta = axis.from(event) - start.at;
    panes.set(name, start.value + delta * axis.sign);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const previewHost = name === "preview" ? event.currentTarget.parentElement : null;
    const rect = previewHost?.getBoundingClientRect();
    const app = event.currentTarget.closest(".app");
    const applied = parseFloat(app ? getComputedStyle(app).getPropertyValue(`--${name}`) : "");
    const start = {
      at: axis.from(event),
      value: Number.isFinite(applied) && applied > 0 ? applied : panes.sizes[name],
      width: rect?.width || 0,
      right: rect?.right || 0,
    };
    function move(ev) {
      apply(start, ev);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.documentElement.style.cursor = "";
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.documentElement.style.cursor = axis.cursor;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
  }

  function onKeyDown(event) {
    const step = event.shiftKey ? 24 : 8;
    const horizontal = name === "left" || name === "right" || name === "preview";
    let next = panes.sizes[name];
    if (horizontal && event.key === "ArrowRight") next += name === "left" ? step : -step;
    else if (horizontal && event.key === "ArrowLeft") next += name === "left" ? -step : step;
    else if (!horizontal && event.key === "ArrowUp") next += step;
    else if (!horizontal && event.key === "ArrowDown") next -= step;
    else return;
    event.preventDefault();
    panes.set(name, next);
  }

  return (
    <button
      type="button"
      className={`splitter split-${name}`}
      aria-label={`Resize ${name === "preview" ? "preview" : name === "dock" ? "bottom panel" : name === "agents" ? "file list" : name === "left" ? "files" : "chat"}`}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={() => panes.reset(name)}
      onKeyDown={onKeyDown}
    />
  );
}
