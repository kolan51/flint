import React from "react";
import { faceOf } from "../faces.js";

export default function AgentFace({ agent, live = false, size = "sm" }) {
  const face = faceOf(agent);
  return (
    <span
      className={`face face-${size}${live ? " live" : ""}`}
      style={{ "--agent": agent?.color || "var(--amber)" }}
      aria-hidden="true"
    >
      {face.image ? <img src={face.image} alt="" /> : face.emoji}
    </span>
  );
}
