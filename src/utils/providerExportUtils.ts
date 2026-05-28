import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNQUOTED_VALUE_RE = /^[A-Za-z0-9_/@%+=:,.-]+$/;
const DEFAULT_CLAUDE_PROXY_BASE_URL = "http://127.0.0.1:15721";
const CLAUDE_AUTH_ENV_KEYS = new Set([
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isExportableValue = (
  value: unknown,
): value is string | number | boolean =>
  ["string", "number", "boolean"].includes(typeof value);

function shellValue(value: string | number | boolean): string {
  const text = String(value);
  if (text.length > 0 && UNQUOTED_VALUE_RE.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function pushRecordExports(
  lines: string[],
  seen: Set<string>,
  values: unknown,
  options?: {
    skipKeys?: Set<string>;
    overrides?: Record<string, string | number | boolean>;
  },
) {
  if (!isRecord(values)) return;

  for (const [key, value] of Object.entries(values)) {
    const exportValue = options?.overrides?.[key] ?? value;
    if (
      !ENV_NAME_RE.test(key) ||
      options?.skipKeys?.has(key) ||
      !isExportableValue(exportValue) ||
      seen.has(key)
    ) {
      continue;
    }
    lines.push(`export ${key}=${shellValue(exportValue)}`);
    seen.add(key);
  }
}

function pushMappedExport(
  lines: string[],
  seen: Set<string>,
  key: string,
  value: unknown,
) {
  if (!isExportableValue(value) || seen.has(key)) return;
  lines.push(`export ${key}=${shellValue(value)}`);
  seen.add(key);
}

function pushOpenAiCompatibleExports(
  lines: string[],
  seen: Set<string>,
  config: Record<string, unknown>,
) {
  const options = isRecord(config.options) ? config.options : undefined;

  pushMappedExport(lines, seen, "OPENAI_BASE_URL", config.base_url);
  pushMappedExport(lines, seen, "OPENAI_BASE_URL", config.baseUrl);
  pushMappedExport(lines, seen, "OPENAI_BASE_URL", options?.baseURL);
  pushMappedExport(lines, seen, "OPENAI_BASE_URL", options?.baseUrl);

  pushMappedExport(lines, seen, "OPENAI_API_KEY", config.api_key);
  pushMappedExport(lines, seen, "OPENAI_API_KEY", config.apiKey);
  pushMappedExport(lines, seen, "OPENAI_API_KEY", options?.apiKey);

  const firstModel = Array.isArray(config.models)
    ? config.models.find(
        (model) => isRecord(model) && isExportableValue(model.id),
      )
    : undefined;
  if (isRecord(firstModel)) {
    pushMappedExport(lines, seen, "OPENAI_MODEL", firstModel.id);
  }
}

function claudeProviderNeedsLocalProxy(provider: Provider): boolean {
  const apiFormat = provider.meta?.apiFormat;
  return Boolean(apiFormat && apiFormat !== "anthropic");
}

function pushClaudeEnvExports(
  lines: string[],
  seen: Set<string>,
  provider: Provider,
) {
  const env = provider.settingsConfig.env;

  if (!claudeProviderNeedsLocalProxy(provider)) {
    pushRecordExports(lines, seen, env);
    return;
  }

  pushMappedExport(
    lines,
    seen,
    "ANTHROPIC_BASE_URL",
    DEFAULT_CLAUDE_PROXY_BASE_URL,
  );
  pushRecordExports(lines, seen, env, {
    skipKeys: new Set(["ANTHROPIC_BASE_URL", ...CLAUDE_AUTH_ENV_KEYS]),
  });
}

export function buildProviderExports(provider: Provider, appId: AppId): string {
  const config = provider.settingsConfig;
  if (!isRecord(config)) return "";

  const lines: string[] = [];
  const seen = new Set<string>();

  if (appId === "claude") {
    pushClaudeEnvExports(lines, seen, provider);
  } else {
    pushRecordExports(lines, seen, config.env);
  }
  pushRecordExports(lines, seen, config.auth);

  if (appId === "opencode" || appId === "openclaw" || appId === "hermes") {
    pushOpenAiCompatibleExports(lines, seen, config);
  }

  return lines.join("\n");
}
