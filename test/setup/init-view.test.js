import { renderToString } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";

import { InitWizardView } from "../../src/setup/init-view.js";
import {
  buildInitWizardModel,
  defaultInitSelections,
} from "../../src/setup/init-model.js";

const h = React.createElement;

describe("setup/InitWizardView", () => {
  it("uses the existing terminal visual language without exposing test plugins", () => {
    const model = buildInitWizardModel(
      { ...defaultInitSelections(), currentStep: "agent" },
      {
        stateDir: "/tmp/firstpass-state",
        configExists: false,
        dbExists: false,
        detectedAgent: { spec: "acp:claude", id: "claude" },
        serviceManager: "launchd",
      },
    );

    const out = renderToString(
      h(InitWizardView, { model, width: 100, height: 30 }),
    );

    expect(out).toContain("firstpass");
    expect(out).toContain("setup wizard");
    expect(out).toContain("Agent Boundary");
    expect(out).toContain("Auto-detect provider CLI");
    expect(out).toContain("GitHub");
    expect(out.toLowerCase()).not.toContain("mock");
  });
});
