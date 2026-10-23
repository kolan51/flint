// Microsoft Fluent Emoji 3D, MIT. https://github.com/microsoft/fluentui-emoji
export const FACES = [
  { id: "fox", label: "Fox", emoji: "🦊", src: "/faces/fox.png" },
  { id: "owl", label: "Owl", emoji: "🦉", src: "/faces/owl.png" },
  { id: "wolf", label: "Wolf", emoji: "🐺", src: "/faces/wolf.png" },
  { id: "bee", label: "Bee", emoji: "🐝", src: "/faces/bee.png" },
  { id: "octopus", label: "Octopus", emoji: "🐙", src: "/faces/octopus.png" },
  { id: "turtle", label: "Turtle", emoji: "🐢", src: "/faces/turtle.png" },
  { id: "dragon", label: "Dragon", emoji: "🐉", src: "/faces/dragon.png" },
  { id: "robot", label: "Robot", emoji: "🤖", src: "/faces/robot.png" },
  { id: "alien", label: "Alien", emoji: "👾", src: "/faces/alien.png" },
  { id: "cat", label: "Cat", emoji: "🐱", src: "/faces/cat.png" },
  { id: "unicorn", label: "Unicorn", emoji: "🦄", src: "/faces/unicorn.png" },
  { id: "frog", label: "Frog", emoji: "🐸", src: "/faces/frog.png" },
  { id: "lion", label: "Lion", emoji: "🦁", src: "/faces/lion.png" },
  { id: "panda", label: "Panda", emoji: "🐼", src: "/faces/panda.png" },
  { id: "butterfly", label: "Butterfly", emoji: "🦋", src: "/faces/butterfly.png" },
  { id: "bolt", label: "Bolt", emoji: "⚡", src: "/faces/bolt.png" },
];

const byId = Object.fromEntries(FACES.map((face) => [face.id, face]));
const byEmoji = Object.fromEntries(FACES.map((face) => [face.emoji, face]));

export function defaultFace(agent) {
  const key = String(agent?.id || agent?.name || "agent");
  let n = 0;
  for (const ch of key) n = (n + ch.charCodeAt(0)) % FACES.length;
  return FACES[n];
}

export function defaultEmoji(agent) {
  return defaultFace(agent).emoji;
}

export function isImageFace(value) {
  return String(value || "").startsWith("data:image/");
}

export function catalogFace(value) {
  const text = String(value || "").trim();
  if (!text || isImageFace(text)) return null;
  return byId[text] || byEmoji[text] || null;
}

export function cleanMark(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("data:")) return "";
  if (/[<>]/.test(text) || /[A-Za-z0-9]/.test(text)) return "";
  return [...text].slice(0, 8).join("");
}

export function storedAvatar(value) {
  if (isImageFace(value)) return value;
  const known = catalogFace(value);
  if (known) return known.id;
  return cleanMark(value);
}

export function resolveAgent(agents, hint) {
  const list = agents || [];
  return list.find((item) => hint?.agentId && item.id === hint.agentId)
    || list.find((item) => hint?.id && item.id === hint.id)
    || list.find((item) => hint?.name && item.name === hint.name)
    || {
      id: hint?.agentId || hint?.id || hint?.name || "",
      name: hint?.name || "",
      color: hint?.color || "",
      avatar: hint?.avatar || "",
    };
}

export function agentJob(agent) {
  const prompt = String(agent?.systemPrompt || "").replace(/\s+/g, " ").trim();
  const role = prompt.match(/you are (?:[\w .'-]{0,32}?,\s*)?the ([a-z][a-z -]{1,36})/i);
  if (!role) return "";
  const job = role[1].replace(/\.$/, "").trim();
  return job.charAt(0).toUpperCase() + job.slice(1);
}

export function faceOf(agent) {
  const avatar = String(agent?.avatar || "");
  if (isImageFace(avatar)) return { image: avatar, emoji: "" };
  const face = catalogFace(avatar);
  if (face) return { image: face.src, emoji: "" };
  const emoji = cleanMark(avatar);
  if (emoji) return { image: "", emoji };
  return { image: defaultFace(agent).src, emoji: "" };
}
