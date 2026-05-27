import { describe, expect, it } from "vitest";

import {
  buildInitApplyPlan,
  buildInitWizardModel,
  defaultInitSelections,
  validateInitSelections,
} from "../../src/setup/init-model.js";

const context = {
  stateDir: "/tmp/firstpass-state",
  configExists: false,
  dbExists: false,
  detectedAgent: { spec: "acp:claude", id: "claude" },
  serviceManager: "launchd",
};

describe("setup/init model", () => {
  it("defaults to auto ACP, no source, and managed service setup", () => {
    const selections = defaultInitSelections();
    const plan = buildInitApplyPlan(selections, context);

    expect(plan.agent).toMatchObject({ mode: "auto", configValue: null });
    expect(plan.source).toMatchObject({ type: "skip", pluginId: null });
    expect(plan.daemon).toMatchObject({
      installService: true,
      startDaemon: true,
    });
    expect(plan.sideEffects.map((effect) => effect.id)).toEqual(
      expect.arrayContaining(["state", "database", "config", "service"]),
    );
    expect(plan.sideEffects.map((effect) => effect.id)).not.toContain("mock");
    expect(plan.trustBoundaries.join("\n")).toContain("ACP");
  });

  it("builds a GitHub explicit-repository plan without exposing test plugins", () => {
    const selections = {
      ...defaultInitSelections(),
      agentMode: "custom",
      customAgent: "acp:opencode",
      source: "github",
      githubScope: "explicit",
      githubRepos: ["kunchenguid/firstpass"],
      installService: false,
      startDaemon: false,
    };

    const plan = buildInitApplyPlan(selections, context);

    expect(plan.agent).toMatchObject({
      mode: "custom",
      configValue: "acp:opencode",
    });
    expect(plan.source).toMatchObject({
      type: "github",
      pluginId: "github",
      config: { explicit_repos: ["kunchenguid/firstpass"] },
    });
    expect(plan.commands).toContain("firstpass plugin add github");
    expect(plan.commands.join("\n")).not.toContain("mock");
  });

  it("validates ACP targets and only allows GitHub or skip as setup sources", () => {
    expect(
      validateInitSelections({
        ...defaultInitSelections(),
        agentMode: "custom",
        customAgent: "opencode",
      }),
    ).toContain("Custom agent targets must start with acp:");

    expect(
      validateInitSelections({
        ...defaultInitSelections(),
        source: "mock",
      }),
    ).toContain("Setup supports GitHub or skipping source setup only");
  });

  it("renders the current wizard step from pure state", () => {
    const model = buildInitWizardModel(
      { ...defaultInitSelections(), currentStep: "agent" },
      context,
    );

    expect(model.title).toBe("setup wizard");
    expect(model.steps.map((step) => step.id)).toEqual([
      "core",
      "agent",
      "source",
      "daemon",
      "apply",
      "first-run",
    ]);
    expect(model.screen.heading).toBe("Agent Boundary");
    expect(model.screen.choices.map((choice) => choice.id)).toEqual([
      "auto",
      "custom",
    ]);
  });
});
