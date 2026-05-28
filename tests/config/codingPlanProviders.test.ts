import { describe, expect, it } from "vitest";
import { detectCodingPlanProvider } from "@/config/codingPlanProviders";

describe("detectCodingPlanProvider", () => {
  it("detects providers with coding-plan-specific URLs", () => {
    expect(detectCodingPlanProvider("https://api.kimi.com/coding")).toBe(
      "kimi",
    );
    expect(detectCodingPlanProvider("https://open.bigmodel.cn/api/anthropic"))
      .toBe("zhipu");
  });

  it("does not auto-detect MiniMax because ordinary API keys share the same host", () => {
    expect(
      detectCodingPlanProvider("https://api.minimaxi.com/anthropic"),
    ).toBeNull();
    expect(detectCodingPlanProvider("https://api.minimax.io/anthropic"))
      .toBeNull();
  });
});
