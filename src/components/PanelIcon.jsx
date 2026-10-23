export default function PanelIcon({ name }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "term") {
    return (
      <svg {...props}>
        <path d="M3 4.5h10" />
        <path d="M3.5 11.2 6.4 8.4 3.5 5.6" />
        <path d="M8 11.2h4.5" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg {...props}>
        <path d="M3 3.5h4.2v9H3z" />
        <path d="M8.8 3.5H13v9H8.8z" />
        <path d="M5 6.2h1.4M10.2 6.2H12M5 8.4h1.4M10.2 9.6H12" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...props}>
        <circle cx="7" cy="7" r="3.2" />
        <path d="M9.4 9.4 13 13" />
      </svg>
    );
  }
  if (name === "git") {
    return (
      <svg {...props}>
        <circle cx="4" cy="3.8" r="1.3" />
        <circle cx="4" cy="12.2" r="1.3" />
        <circle cx="12" cy="8" r="1.3" />
        <path d="M4 5.1v5.8M4 8h6.6" />
      </svg>
    );
  }
  if (name === "problems") {
    return (
      <svg {...props}>
        <path d="M8 2.6 13.4 12.6H2.6z" />
        <path d="M8 6.2v3" />
        <path d="M8 11h.01" />
      </svg>
    );
  }
  if (name === "plan") {
    return (
      <svg {...props}>
        <path d="M3 4.2h10M3 8h10M3 11.8h6" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M5 3.2 12.2 8 5 12.8z" />
    </svg>
  );
}
