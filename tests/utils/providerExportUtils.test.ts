import { describe, expect, it } from "vitest";
import type { Provider } from "@/types";
import { buildProviderExports } from "@/utils/providerExportUtils";

const provider = (settingsConfig: Record<string, unknown>): Provider => ({
  id: "minimax",
  name: "MiniMax",
  category: "cn_official",
  settingsConfig,
});

const providerWithMeta = (
  settingsConfig: Record<string, unknown>,
  meta: Provider["meta"],
): Provider => ({
  ...provider(settingsConfig),
  meta,
});

describe("buildProviderExports", () => {
  it("builds Claude env exports in provider order", () => {
    expect(
      buildProviderExports(
        provider({
          env: {
            ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
            ANTHROPIC_AUTH_TOKEN: "sk-test",
            ANTHROPIC_MODEL: "MiniMax-M2.7",
            ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7",
          },
        }),
        "claude",
      ),
    ).toBe(
      [
        "export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic",
        "export ANTHROPIC_AUTH_TOKEN=sk-test",
        "export ANTHROPIC_MODEL=MiniMax-M2.7",
        "export ANTHROPIC_SMALL_FAST_MODEL=MiniMax-M2.7",
      ].join("\n"),
    );
  });

  it("quotes values that need shell escaping", () => {
    expect(
      buildProviderExports(
        provider({
          env: {
            ANTHROPIC_MODEL: "model with spaces",
            EMPTY_VALUE: "",
            QUOTED_VALUE: "model's value",
          },
        }),
        "claude",
      ),
    ).toBe(
      [
        "export ANTHROPIC_MODEL='model with spaces'",
        "export EMPTY_VALUE=''",
        "export QUOTED_VALUE='model'\\''s value'",
      ].join("\n"),
    );
  });

  it("maps OpenAI-compatible provider fields when no env object exists", () => {
    expect(
      buildProviderExports(
        provider({
          base_url: "https://api.minimaxi.com/v1",
          api_key: "sk-test",
          models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
        }),
        "hermes",
      ),
    ).toBe(
      [
        "export OPENAI_BASE_URL=https://api.minimaxi.com/v1",
        "export OPENAI_API_KEY=sk-test",
        "export OPENAI_MODEL=MiniMax-M2.7",
      ].join("\n"),
    );
  });

  it("exports proxied Claude providers through the local CC Switch proxy", () => {
    expect(
      buildProviderExports(
        providerWithMeta(
          {
            env: {
              ANTHROPIC_AUTH_TOKEN: "sk-upstream",
              ANTHROPIC_BASE_URL:
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
              ANTHROPIC_MODEL: "doubao-seed-code-preview-251028",
              ANTHROPIC_DEFAULT_SONNET_MODEL:
                "doubao-seed-code-preview-251028",
            },
          },
          { apiFormat: "openai_chat", isFullUrl: true },
        ),
        "claude",
      ),
    ).toBe(
      [
        "export ANTHROPIC_BASE_URL=http://127.0.0.1:15721",
        "export ANTHROPIC_MODEL=doubao-seed-code-preview-251028",
        "export ANTHROPIC_DEFAULT_SONNET_MODEL=doubao-seed-code-preview-251028",
      ].join("\n"),
    );
  });
});
