const MODES = new Set(["local_only", "balanced", "quality", "custom"]);

export function normalizeRouting(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const mode = MODES.has(source.mode) ? source.mode : "custom";
  return {
    mode,
    roles: source.roles && typeof source.roles === "object" ? {
      architect: String(source.roles.architect || ""),
      implementer: String(source.roles.implementer || ""),
      verifier: String(source.roles.verifier || ""),
      reviewer: String(source.roles.reviewer || ""),
    } : {},
  };
}

export function isLocalProvider(provider) {
  const base = String(provider?.baseUrl || "");
  return /127\.0\.0\.1|localhost|\[::1\]|::1/i.test(base);
}

function agentById(agents, id) {
  return (agents || []).find((item) => item.id === id) || null;
}

function providerOf(settings, agent) {
  const id = agent?.provider || settings?.activeProvider || "";
  return settings?.providers?.[id] || null;
}

function scoreAgent(agent, settings, job, mode) {
  const provider = providerOf(settings, agent);
  const local = isLocalProvider(provider);
  let score = 0;
  if (mode === "local_only") score += local ? 100 : -100;
  if (mode === "balanced") score += local ? 20 : 5;
  if (mode === "quality") score += local ? 5 : 15;
  const name = `${agent?.name || ""} ${agent?.role || ""}`.toLowerCase();
  if (job === "architect" && /architect|lead|senior|plan/.test(name)) score += 30;
  if (job === "implementer" && /implement|apply|builder|worker|coder/.test(name)) score += 30;
  if (job === "verifier" && /verif|check|test/.test(name)) score += 30;
  if (job === "reviewer" && /review/.test(name)) score += 30;
  if (String(agent?.role || "").toLowerCase() === job) score += 40;
  if (agent?.model) score += 5;
  return score;
}

export function routeFor(job, { settings, agents, fallback = null } = {}) {
  const mode = settings?.routing?.mode || "custom";
  const pinned = settings?.routing?.roles?.[job];
  if (pinned) {
    const hit = agentById(agents, pinned);
    if (hit) {
      const provider = providerOf(settings, hit);
      if (mode === "local_only" && provider && !isLocalProvider(provider)) {
        return {
          job,
          agentId: "",
          providerId: "",
          model: "",
          local: false,
          reason: `Local only is on, and the pinned ${job} agent uses a remote address.`,
          blocked: true,
        };
      }
      return {
        job,
        agentId: hit.id,
        providerId: hit.provider || settings?.activeProvider || "",
        model: hit.model || settings?.defaultModel || "",
        local: isLocalProvider(provider),
        reason: `Custom pin for ${job}.`,
        blocked: false,
      };
    }
  }

  const ranked = [...(agents || [])]
    .map((agent) => ({ agent, score: scoreAgent(agent, settings, job, mode) }))
    .filter((item) => mode !== "local_only" || isLocalProvider(providerOf(settings, item.agent)))
    .sort((a, b) => b.score - a.score);

  const chosen = ranked[0]?.agent || (mode === "local_only" ? null : fallback);
  if (!chosen) {
    return {
      job,
      agentId: "",
      providerId: "",
      model: "",
      local: true,
      reason: mode === "local_only"
        ? "Local only is on, and no local provider is available for this role."
        : `No agent available for ${job}.`,
      blocked: true,
    };
  }
  const provider = providerOf(settings, chosen);
  return {
    job,
    agentId: chosen.id,
    providerId: chosen.provider || settings?.activeProvider || "",
    model: chosen.model || settings?.defaultModel || "",
    local: isLocalProvider(provider),
    reason: mode === "custom"
      ? `Closest matching agent for ${job}.`
      : `${mode.replaceAll("_", " ")} routing picked ${chosen.name || chosen.id} for ${job}.`,
    blocked: false,
  };
}

export function routeCrew(settings, agents) {
  const jobs = ["architect", "implementer", "verifier", "reviewer"];
  const fallback = (agents || [])[0] || null;
  return Object.fromEntries(jobs.map((job) => [job, routeFor(job, { settings, agents, fallback })]));
}
