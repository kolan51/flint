import pkg from "../package.json";

export const APP_VERSION = pkg.version || "0.1.0";
export const DEFAULT_RELEASE_REPO = "kolan51/flint";

export function isNewer(latest, current) {
  const parse = (value) => String(value || "").replace(/^v/i, "").split(".").map((part) => parseInt(part, 10) || 0);
  const next = parse(latest);
  const now = parse(current);
  const length = Math.max(next.length, now.length, 3);
  for (let i = 0; i < length; i += 1) {
    const a = next[i] || 0;
    const b = now[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

export async function checkRelease(repo = DEFAULT_RELEASE_REPO) {
  const name = String(repo || DEFAULT_RELEASE_REPO).trim();
  const current = APP_VERSION;
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) {
    return { current, available: false, error: "Couldn't check for updates." };
  }
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${name}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch {
    return { current, available: false, error: "Couldn't check for updates." };
  }
  if (res.status === 404) return { current, available: false, latest: current };
  if (!res.ok) return { current, available: false, error: "Couldn't check for updates." };
  const data = await res.json();
  const latest = String(data.tag_name || data.name || "").replace(/^v/i, "");
  const assets = (data.assets || []).map((asset) => ({ name: asset.name, url: asset.browser_download_url })).filter((asset) => asset.name && asset.url);
  return {
    current,
    repo: name,
    latest,
    available: Boolean(latest) && isNewer(latest, current),
    url: data.html_url || `https://github.com/${name}/releases/latest`,
    notes: String(data.body || "").trim().slice(0, 280),
    assets,
  };
}

export function pickInstaller(assets = []) {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return assets.find((item) => /\.exe$/i.test(item.name));
  if (/Mac/i.test(ua)) {
    const arm = /arm|aarch64/i.test(ua);
    return assets.find((item) => /\.dmg$/i.test(item.name) && (arm ? /arm64/i.test(item.name) : /x64/i.test(item.name)))
      || assets.find((item) => /\.dmg$/i.test(item.name));
  }
  return assets.find((item) => /\.AppImage$/i.test(item.name)) || assets.find((item) => /\.deb$/i.test(item.name));
}
