const STEP_ORDER = ["core", "agent", "source", "daemon", "apply", "first-run"];

const STEP_LABELS = {
  core: "core",
  agent: "agent",
  source: "source",
  daemon: "daemon",
  apply: "apply",
  "first-run": "first run",
};

const GITHUB_SCOPE_LABELS = {
  explicit: "Explicit repositories",
  owned: "Owned repositories",
  public_owned: "Public owned repositories",
  public_starred: "Public owned repositories you starred",
  authored_external: "Authored external work",
};

const VALID_SOURCES = new Set(["skip", "github"]);
const VALID_AGENT_MODES = new Set(["auto", "custom"]);
const VALID_GITHUB_SCOPES = new Set(Object.keys(GITHUB_SCOPE_LABELS));

export function defaultInitSelections(overrides = {}) {
  return {
    currentStep: "core",
    agentMode: "auto",
    customAgent: "",
    source: "skip",
    githubScope: "explicit",
    githubRepos: [],
    githubRepoInput: "",
    githubUsername: "",
    installService: true,
    startDaemon: true,
    runFirstSync: false,
    choiceIndex: 0,
    notice: "",
    ...overrides,
  };
}

function normalizeSelections(selections = {}) {
  const defaults = defaultInitSelections();
  const normalized = { ...defaults, ...selections };
  normalized.githubRepos = Array.isArray(normalized.githubRepos)
    ? normalized.githubRepos.filter((repo) => typeof repo === "string")
    : [];
  normalized.customAgent = String(normalized.customAgent ?? "").trim();
  normalized.githubRepoInput = String(normalized.githubRepoInput ?? "").trim();
  normalized.githubUsername = String(normalized.githubUsername ?? "").trim();
  if (!STEP_ORDER.includes(normalized.currentStep)) {
    normalized.currentStep = defaults.currentStep;
  }
  if (!VALID_AGENT_MODES.has(normalized.agentMode)) {
    normalized.agentMode = defaults.agentMode;
  }
  if (!VALID_SOURCES.has(normalized.source)) {
    normalized.source = String(normalized.source ?? "");
  }
  if (!VALID_GITHUB_SCOPES.has(normalized.githubScope)) {
    normalized.githubScope = defaults.githubScope;
  }
  return normalized;
}

function isValidRepoName(repo) {
  return typeof repo === "string" && /^[^/\s]+\/[^/\s]+$/.test(repo);
}

function githubConfig(selections) {
  if (selections.source !== "github") return {};
  const config = {};
  if (selections.githubUsername) {
    config.username = selections.githubUsername;
  }
  if (selections.githubScope === "explicit") {
    config.explicit_repos = selections.githubRepos;
  } else if (selections.githubScope === "owned") {
    config.owned_repos = true;
  } else if (selections.githubScope === "public_owned") {
    config.repo_conditions = ["all_public_owned"];
  } else if (selections.githubScope === "public_starred") {
    config.repo_conditions = ["all_public_owned_and_starred"];
  } else if (selections.githubScope === "authored_external") {
    config.authored_external = true;
  }
  return config;
}

export function validateInitSelections(input = {}) {
  const selections = normalizeSelections(input);
  const errors = [];

  if (!VALID_AGENT_MODES.has(selections.agentMode)) {
    errors.push("Agent mode must be auto or custom");
  }
  if (
    selections.agentMode === "custom" &&
    !selections.customAgent.startsWith("acp:")
  ) {
    errors.push("Custom agent targets must start with acp:");
  }
  if (!VALID_SOURCES.has(selections.source)) {
    errors.push("Setup supports GitHub or skipping source setup only");
  }
  if (
    selections.source === "github" &&
    !VALID_GITHUB_SCOPES.has(selections.githubScope)
  ) {
    errors.push("GitHub source scope is invalid");
  }
  if (selections.source === "github" && selections.githubScope === "explicit") {
    if (selections.githubRepos.length === 0) {
      errors.push("At least one GitHub repository is required");
    }
    for (const repo of selections.githubRepos) {
      if (!isValidRepoName(repo)) {
        errors.push(`Invalid GitHub repository: ${repo}`);
      }
    }
  }
  return errors;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

export function buildInitApplyPlan(input = {}, context = {}) {
  const selections = normalizeSelections(input);
  const configValue =
    selections.agentMode === "custom" ? selections.customAgent : null;
  const agentLabel =
    selections.agentMode === "custom"
      ? selections.customAgent
      : context.detectedAgent?.spec
        ? `auto (${context.detectedAgent.spec})`
        : "auto-detect provider CLI";
  const sourceConfig = githubConfig(selections);
  const commands = ["firstpass"];
  const sideEffects = [
    {
      id: "state",
      label: `Create or reuse ${context.stateDir ?? "the FirstPass state dir"}`,
    },
    { id: "database", label: "Create or migrate firstpass.sqlite" },
    { id: "config", label: `Set agent to ${agentLabel}` },
  ];

  if (selections.source === "github") {
    sideEffects.push({
      id: "github",
      label: "Install and configure the bundled GitHub source",
    });
    commands.unshift("firstpass plugin add github");
    commands.unshift(
      [
        "firstpass plugin configure github",
        ...Object.entries(sourceConfig).map(
          ([key, value]) =>
            `--config ${key}=${shellQuote(JSON.stringify(value))}`,
        ),
      ].join(" "),
    );
  }

  if (selections.installService) {
    sideEffects.push({
      id: "service",
      label: context.serviceManager
        ? `Install ${context.serviceManager} login service and start it now`
        : "Install the managed login service and start it now",
    });
    commands.unshift("firstpass daemon install");
  } else if (selections.startDaemon) {
    sideEffects.push({
      id: "daemon-start",
      label: "Start the daemon for this login session",
    });
    commands.unshift("firstpass daemon start");
  }

  if (selections.runFirstSync) {
    sideEffects.push({ id: "sync", label: "Ask the daemon to sync now" });
    commands.unshift("firstpass sync");
  }

  return {
    stateDir: context.stateDir ?? null,
    agent: {
      mode: selections.agentMode,
      label: agentLabel,
      configValue,
    },
    source:
      selections.source === "github"
        ? {
            type: "github",
            pluginId: "github",
            scope: selections.githubScope,
            scopeLabel: GITHUB_SCOPE_LABELS[selections.githubScope],
            config: sourceConfig,
          }
        : { type: "skip", pluginId: null, config: {} },
    daemon: {
      installService: Boolean(selections.installService),
      startDaemon: Boolean(selections.startDaemon),
    },
    firstRun: { syncNow: Boolean(selections.runFirstSync) },
    sideEffects,
    commands: [...new Set(commands.reverse())],
    trustBoundaries: [
      "Source credentials stay with the local source plugin and provider CLI.",
      "ACP recommendations may send source-derived context to the configured agent target.",
      "The daemon runs as the sole background worker for sync, triage, and approved actions.",
      "Source-visible writes still require preview plus explicit approval.",
    ],
    errors: validateInitSelections(selections),
  };
}

function stepStatus(step, currentStep) {
  const current = STEP_ORDER.indexOf(currentStep);
  const index = STEP_ORDER.indexOf(step);
  if (index < current) return "done";
  if (index === current) return "current";
  return "todo";
}

function agentScreen(selections, context) {
  return {
    heading: "Agent Boundary",
    body: [
      "Recommendations are produced through ACP.",
      "Prompt context can include source-derived issue or pull request details.",
      "Next you can connect GitHub or skip source setup.",
    ],
    choices: [
      {
        id: "auto",
        label: "Auto-detect provider CLI",
        detail: context.detectedAgent?.spec
          ? `Detected ${context.detectedAgent.spec} from PATH.`
          : "Use claude, codex, or opencode when found on PATH.",
        selected: selections.agentMode === "auto",
      },
      {
        id: "custom",
        label: "Custom ACP target",
        detail: selections.customAgent || "Use acp:<target-or-command>.",
        selected: selections.agentMode === "custom",
      },
    ],
  };
}

function sourceScreen(selections) {
  if (selections.source === "github") {
    return {
      heading: "GitHub Source",
      body: [
        "GitHub is the only user-facing bundled source in setup.",
        "Use gh auth status first; run gh auth login if credentials are missing.",
      ],
      choices: Object.entries(GITHUB_SCOPE_LABELS).map(([id, label]) => ({
        id,
        label,
        detail:
          id === "explicit"
            ? selections.githubRepos.length > 0
              ? selections.githubRepos.join(", ")
              : "Enter owner/repo below."
            : "The GitHub plugin resolves this scope during sync.",
        selected: selections.githubScope === id,
      })),
      input:
        selections.githubScope === "explicit"
          ? {
              label: "Repository",
              value:
                selections.githubRepoInput || selections.githubRepos.join(", "),
              placeholder: "owner/repo",
            }
          : null,
    };
  }
  return {
    heading: "First Source",
    body: [
      "Choose GitHub setup or skip source setup for now.",
      "Internal test sources are not shown in the first-run wizard.",
    ],
    choices: [
      {
        id: "github",
        label: "GitHub",
        detail: "Sync issues and pull requests through the gh CLI.",
        selected: false,
      },
      {
        id: "skip",
        label: "Skip source setup",
        detail: "Initialize local state now and configure sources later.",
        selected: true,
      },
    ],
  };
}

function screenFor(selections, context, plan) {
  if (selections.currentStep === "core") {
    return {
      heading: "Local State",
      body: [
        `State dir: ${context.stateDir ?? "~/.firstpass"}`,
        context.dbExists
          ? "Database already exists."
          : "Database will be created.",
        context.configExists
          ? "Config already exists."
          : "Config will be written.",
      ],
      choices: [],
    };
  }
  if (selections.currentStep === "agent")
    return agentScreen(selections, context);
  if (selections.currentStep === "source") return sourceScreen(selections);
  if (selections.currentStep === "daemon") {
    return {
      heading: "Daemon",
      body: [
        "The daemon is the sole worker for sync, triage, and approved actions.",
        "The default installs a managed login service and starts it now.",
      ],
      choices: [
        {
          id: "install-service",
          label: "Install managed service",
          detail: context.serviceManager ?? "launchd, systemd, or schtasks",
          selected: selections.installService,
        },
        {
          id: "skip-service",
          label: "Do not install service",
          detail: "You can run firstpass daemon start later.",
          selected: !selections.installService,
        },
      ],
    };
  }
  if (selections.currentStep === "apply") {
    return {
      heading: "Review And Apply",
      body: plan.sideEffects.map((effect) => effect.label),
      choices: [],
    };
  }
  return {
    heading: "First Run",
    body: [
      "Setup can finish with commands for you to run next.",
      "Run firstpass to open the inbox after the daemon has synced items.",
    ],
    choices: [
      {
        id: "sync-now",
        label: "Request first sync now",
        detail: "Only after the ACP and source disclosures above.",
        selected: selections.runFirstSync,
      },
      {
        id: "finish",
        label: "Finish with commands",
        detail: "Run firstpass sync yourself when ready.",
        selected: !selections.runFirstSync,
      },
    ],
  };
}

export function buildInitWizardModel(input = {}, context = {}) {
  const selections = normalizeSelections(input);
  const plan = buildInitApplyPlan(selections, context);
  return {
    title: "setup wizard",
    stateDir: context.stateDir ?? null,
    currentStep: selections.currentStep,
    steps: STEP_ORDER.map((id) => ({
      id,
      label: STEP_LABELS[id],
      status: stepStatus(id, selections.currentStep),
    })),
    screen: screenFor(selections, context, plan),
    plan,
    notice: selections.notice,
    errors: plan.errors,
  };
}

export function nextInitStep(currentStep) {
  const index = STEP_ORDER.indexOf(currentStep);
  return STEP_ORDER[Math.min(STEP_ORDER.length - 1, Math.max(0, index) + 1)];
}

export function previousInitStep(currentStep) {
  const index = STEP_ORDER.indexOf(currentStep);
  return STEP_ORDER[Math.max(0, index - 1)];
}

export function githubConfigFromSelections(selections = {}) {
  return githubConfig(normalizeSelections(selections));
}
