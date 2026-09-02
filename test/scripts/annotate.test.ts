import { describe, expect, it } from "vitest";
import { escapeWorkflowCommand } from "../../.github/scripts/annotate.js";

describe("escapeWorkflowCommand", () => {
  it("escapes %, carriage returns, and newlines per GitHub workflow-command rules", () => {
    expect(escapeWorkflowCommand("100% done\r\nmore")).toBe(
      "100%25 done%0D%0Amore",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeWorkflowCommand("tax changed")).toBe("tax changed");
  });

  it("neutralizes an injection attempt containing a forged error command", () => {
    const malicious = "legit\n::error title=forged::injected";
    const escaped = escapeWorkflowCommand(malicious);
    expect(escaped).not.toContain("\n");
    expect(escaped).toContain("%0A");
  });
});
