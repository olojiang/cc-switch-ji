import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNQUOTED_VALUE_RE = /^[A-Za-z0-9_/@%+=:,.-]+$/;

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
) {
  if (!isRecord(values)) return;

  for (const [key, value] of Object.entries(values)) {
    if (!ENV_NAME_RE.test(key) || !isExportableValue(value) || seen.has(key)) {
      continue;
    }
    lines.push(`export ${key}=${shellValue(value)}`);
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

export function buildProviderExports(provider: Provider, appId: AppId): string {
  const config = provider.settingsConfig;
  if (!isRecord(config)) return "";

  const lines: string[] = [];
  const seen = new Set<string>();

  pushRecordExports(lines, seen, config.env);
  pushRecordExports(lines, seen, config.auth);

  if (appId === "opencode" || appId === "openclaw" || appId === "hermes") {
    pushOpenAiCompatibleExports(lines, seen, config);
  }

  return lines.join("\n");
}
