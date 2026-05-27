import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Search,
  TestTube2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { useDragSort } from "@/hooks/useDragSort";
import {
  useOpenClawLiveProviderIds,
  useOpenClawDefaultModel,
} from "@/hooks/useOpenClaw";
import {
  useHermesLiveProviderIds,
  useHermesModelConfig,
} from "@/hooks/useHermes";
import { useStreamCheck } from "@/hooks/useStreamCheck";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderEmptyState } from "@/components/providers/ProviderEmptyState";
import {
  useAutoFailoverEnabled,
  useFailoverQueue,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
} from "@/lib/query/failover";
import {
  useCurrentOmoProviderId,
  useCurrentOmoSlimProviderId,
} from "@/lib/query/omo";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api/settings";
import {
  streamCheckProvider,
  type StreamCheckResult,
} from "@/lib/api/model-test";

interface ProviderListProps {
  providers: Record<string, Provider>;
  currentProviderId: string;
  appId: AppId;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onCreate?: () => void;
  isLoading?: boolean;
  isProxyRunning?: boolean; // 代理服务运行状态
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管）
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  onSetAsDefault?: (provider: Provider) => void; // OpenClaw: set as default model
}

export function ProviderList({
  providers,
  currentProviderId,
  appId,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onCreate,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  activeProviderId,
  onSetAsDefault,
}: ProviderListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { checkProvider, isChecking } = useStreamCheck(appId);
  const { sortedProviders, sensors, handleDragEnd } = useDragSort(
    providers,
    appId,
  );

  const { data: opencodeLiveIds } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode",
  });

  // OpenClaw: 查询 live 配置中的供应商 ID 列表，用于判断 isInConfig
  const { data: openclawLiveIds } = useOpenClawLiveProviderIds(
    appId === "openclaw",
  );

  // Hermes: 查询 live 配置中的供应商 ID 列表，用于判断 isInConfig
  const { data: hermesLiveIds } = useHermesLiveProviderIds(appId === "hermes");

  // Hermes: 读取当前 model.provider，用于判断哪个供应商是"当前激活"（高亮）
  const { data: hermesModelConfig } = useHermesModelConfig(appId === "hermes");
  const hermesCurrentProviderId = hermesModelConfig?.provider;

  // 判断供应商是否已添加到配置（累加模式应用：OpenCode/OpenClaw/Hermes）
  const isProviderInConfig = useCallback(
    (providerId: string): boolean => {
      if (appId === "opencode") {
        return opencodeLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "openclaw") {
        return openclawLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "hermes") {
        return hermesLiveIds?.includes(providerId) ?? false;
      }
      return true; // 其他应用始终返回 true
    },
    [appId, opencodeLiveIds, openclawLiveIds, hermesLiveIds],
  );

  // OpenClaw: query default model to determine which provider is default
  const { data: openclawDefaultModel } = useOpenClawDefaultModel(
    appId === "openclaw",
  );

  const isProviderDefaultModel = useCallback(
    (providerId: string): boolean => {
      if (appId !== "openclaw" || !openclawDefaultModel?.primary) return false;
      return openclawDefaultModel.primary.startsWith(providerId + "/");
    },
    [appId, openclawDefaultModel],
  );

  // 故障转移相关
  const { data: isAutoFailoverEnabled } = useAutoFailoverEnabled(appId);
  const { data: failoverQueue } = useFailoverQueue(appId);
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();

  const isFailoverModeActive =
    isProxyTakeover === true && isAutoFailoverEnabled === true;

  const isOpenCode = appId === "opencode";
  const { data: currentOmoId } = useCurrentOmoProviderId(isOpenCode);
  const { data: currentOmoSlimId } = useCurrentOmoSlimProviderId(isOpenCode);

  const getFailoverPriority = useCallback(
    (providerId: string): number | undefined => {
      if (!isFailoverModeActive || !failoverQueue) return undefined;
      const index = failoverQueue.findIndex(
        (item) => item.providerId === providerId,
      );
      return index >= 0 ? index + 1 : undefined;
    },
    [isFailoverModeActive, failoverQueue],
  );

  const isInFailoverQueue = useCallback(
    (providerId: string): boolean => {
      if (!isFailoverModeActive || !failoverQueue) return false;
      return failoverQueue.some((item) => item.providerId === providerId);
    },
    [isFailoverModeActive, failoverQueue],
  );

  const handleToggleFailover = useCallback(
    (providerId: string, enabled: boolean) => {
      if (enabled) {
        addToQueue.mutate({ appType: appId, providerId });
      } else {
        removeFromQueue.mutate({ appType: appId, providerId });
      }
    },
    [appId, addToQueue, removeFromQueue],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showStreamCheckConfirm, setShowStreamCheckConfirm] = useState(false);
  const [pendingTestProvider, setPendingTestProvider] =
    useState<Provider | null>(null);
  const [pendingTestAll, setPendingTestAll] = useState(false);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testingAllIds, setTestingAllIds] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<
    Record<string, StreamCheckResult>
  >({});
  const { data: claudeDesktopStatus } = useQuery({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => providersApi.getClaudeDesktopStatus(),
    enabled: appId === "claude-desktop",
    refetchInterval: appId === "claude-desktop" ? 5000 : false,
  });

  // Query settings for streamCheckConfirmed flag
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const runSingleTest = useCallback(
    async (provider: Provider) => {
      const result = await checkProvider(provider.id, provider.name);
      if (result) {
        setTestResults((prev) => ({ ...prev, [provider.id]: result }));
      }
    },
    [checkProvider],
  );

  const handleTest = useCallback(
    (provider: Provider) => {
      if (!settings?.streamCheckConfirmed) {
        setPendingTestProvider(provider);
        setShowStreamCheckConfirm(true);
      } else {
        void runSingleTest(provider);
      }
    },
    [runSingleTest, settings?.streamCheckConfirmed],
  );

  const runTestAll = useCallback(async () => {
    if (isTestingAll) return;

    const providersToTest = sortedProviders;
    if (providersToTest.length === 0) return;

    setIsTestingAll(true);
    setTestingAllIds(new Set(providersToTest.map((provider) => provider.id)));

    const completedResults: Array<[string, StreamCheckResult]> = [];
    try {
      await Promise.all(
        providersToTest.map(async (provider) => {
          let result: StreamCheckResult;

          try {
            result = await streamCheckProvider(appId, provider.id);
          } catch (error) {
            result = {
              status: "failed",
              success: false,
              message:
                error instanceof Error ? error.message : String(error ?? ""),
              modelUsed: "",
              testedAt: Date.now(),
              retryCount: 0,
            };
          }

          completedResults.push([provider.id, result]);
          setTestResults((prev) => ({ ...prev, [provider.id]: result }));
          setTestingAllIds((prev) => {
            const next = new Set(prev);
            next.delete(provider.id);
            return next;
          });
        }),
      );

      const passed = completedResults.filter(
        ([, result]) => result.success,
      ).length;
      const failed = completedResults.length - passed;
      if (failed === 0) {
        toast.success(
          t("streamCheck.allPassed", {
            passed,
            total: completedResults.length,
            defaultValue: `全部测试通过 (${passed}/${completedResults.length})`,
          }),
        );
      } else {
        toast.warning(
          t("streamCheck.allFinishedWithFailures", {
            passed,
            failed,
            total: completedResults.length,
            defaultValue: `测试完成：${passed} 个成功，${failed} 个失败`,
          }),
          { closeButton: true },
        );
      }
    } catch (error) {
      toast.error(
        t("streamCheck.allFailed", {
          error: error instanceof Error ? error.message : String(error ?? ""),
          defaultValue: "批量测试失败：{{error}}",
        }),
      );
    } finally {
      setIsTestingAll(false);
      setTestingAllIds(new Set());
    }
  }, [appId, isTestingAll, sortedProviders, t]);

  const handleTestAll = useCallback(() => {
    if (!settings?.streamCheckConfirmed) {
      setPendingTestProvider(null);
      setPendingTestAll(true);
      setShowStreamCheckConfirm(true);
      return;
    }

    void runTestAll();
  }, [runTestAll, settings?.streamCheckConfirmed]);

  const handleStreamCheckConfirm = async () => {
    setShowStreamCheckConfirm(false);
    try {
      if (settings) {
        const { webdavSync: _, ...rest } = settings;
        await settingsApi.save({ ...rest, streamCheckConfirmed: true });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      console.error("Failed to save stream check confirmed:", error);
    }
    if (pendingTestProvider) {
      void runSingleTest(pendingTestProvider);
      setPendingTestProvider(null);
    }
    if (pendingTestAll) {
      setPendingTestAll(false);
      void runTestAll();
    }
  };

  // Import current live config as default provider
  const importMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      if (appId === "opencode") {
        const count = await providersApi.importOpenCodeFromLive();
        return count > 0;
      }
      if (appId === "openclaw") {
        const count = await providersApi.importOpenClawFromLive();
        return count > 0;
      }
      if (appId === "hermes") {
        const count = await providersApi.importHermesFromLive();
        return count > 0;
      }
      if (appId === "claude-desktop") {
        const count = await providersApi.importClaudeDesktopFromClaude();
        return count > 0;
      }
      return providersApi.importDefault(appId);
    },
    onSuccess: (imported) => {
      if (imported) {
        queryClient.invalidateQueries({ queryKey: ["providers", appId] });
        if (appId === "claude-desktop") {
          queryClient.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
        }
        toast.success(t("provider.importCurrentDescription"));
      } else {
        toast.info(t("provider.noProviders"));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const [isProviderListTransferring, setIsProviderListTransferring] =
    useState(false);

  const providerListExportName = useCallback(() => {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    return `cc-switch-claude-providers-${stamp}.json`;
  }, []);

  const handleExportClaudeProviders = useCallback(async () => {
    if (appId !== "claude" || isProviderListTransferring) return;
    setIsProviderListTransferring(true);
    try {
      const destination = await settingsApi.saveJsonFileDialog(
        providerListExportName(),
      );
      if (!destination) return;

      const result =
        await providersApi.exportClaudeProvidersToFile(destination);
      toast.success(
        t("provider.exportListSuccess", {
          defaultValue: "已导出 {{count}} 个 Claude Code 供应商",
          count: result.total,
        }) + `\n${result.filePath}`,
        { closeButton: true },
      );
    } catch (error) {
      console.error("[ProviderList] Failed to export Claude providers", error);
      toast.error(
        t("provider.exportListFailed", {
          defaultValue: "导出供应商列表失败：{{message}}",
          message: error instanceof Error ? error.message : String(error ?? ""),
        }),
      );
    } finally {
      setIsProviderListTransferring(false);
    }
  }, [appId, isProviderListTransferring, providerListExportName, t]);

  const handleImportClaudeProviders = useCallback(async () => {
    if (appId !== "claude" || isProviderListTransferring) return;
    setIsProviderListTransferring(true);
    try {
      const filePath = await settingsApi.openJsonFileDialog();
      if (!filePath) return;

      const result = await providersApi.importClaudeProvidersFromFile(filePath);
      await queryClient.invalidateQueries({ queryKey: ["providers", appId] });
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
      await providersApi.updateTrayMenu();

      toast.success(
        t("provider.importListSuccess", {
          defaultValue:
            "已导入 {{imported}} 个、更新 {{updated}} 个 Claude Code 供应商",
          imported: result.imported ?? 0,
          updated: result.updated ?? 0,
          skipped: result.skipped ?? 0,
          total: result.total,
        }),
        { closeButton: true },
      );
    } catch (error) {
      console.error("[ProviderList] Failed to import Claude providers", error);
      toast.error(
        t("provider.importListFailed", {
          defaultValue: "导入供应商列表失败：{{message}}",
          message: error instanceof Error ? error.message : String(error ?? ""),
        }),
      );
    } finally {
      setIsProviderListTransferring(false);
    }
  }, [appId, isProviderListTransferring, queryClient, t]);

  const handleClearClaudeCurrentProvider = useCallback(async () => {
    if (appId !== "claude" || !currentProviderId) return;

    try {
      await providersApi.clearCurrent(appId);
      await queryClient.invalidateQueries({ queryKey: ["providers", appId] });
      await providersApi.updateTrayMenu();
      toast.success(
        t("provider.clearInUseSuccess", {
          defaultValue: "已取消所有 Claude Code 供应商的使用状态",
        }),
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        t("provider.clearInUseFailed", {
          defaultValue: "取消使用状态失败：{{message}}",
          message: error instanceof Error ? error.message : String(error ?? ""),
        }),
      );
    }
  }, [appId, currentProviderId, queryClient, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  const filteredProviders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return sortedProviders;
    return sortedProviders.filter((provider) => {
      const fields = [provider.name, provider.notes, provider.websiteUrl];
      return fields.some((field) =>
        field?.toString().toLowerCase().includes(keyword),
      );
    });
  }, [searchTerm, sortedProviders]);

  const testSummary = useMemo(() => {
    const visibleResults = sortedProviders
      .map((provider) => testResults[provider.id])
      .filter((result): result is StreamCheckResult => Boolean(result));

    if (visibleResults.length === 0) return null;

    const passed = visibleResults.filter((result) => result.success).length;
    return {
      passed,
      failed: visibleResults.length - passed,
      total: visibleResults.length,
    };
  }, [sortedProviders, testResults]);

  const claudeDesktopStatusMessages = useMemo(() => {
    if (appId !== "claude-desktop" || !claudeDesktopStatus) return [];

    const messages: string[] = [];
    if (!claudeDesktopStatus.supported) {
      messages.push(
        t("claudeDesktop.statusUnsupported", {
          defaultValue: "当前平台暂不支持 Claude Desktop 3P 配置写入。",
        }),
      );
      return messages;
    }

    if (claudeDesktopStatus.staleRawModels) {
      messages.push(
        t("claudeDesktop.statusStaleRawModels", {
          defaultValue:
            "Claude Desktop profile 中存在非 claude-* 模型名，新版 Claude Desktop 可能拒绝加载；重新切换当前供应商可修复。",
        }),
      );
    }
    if (claudeDesktopStatus.missingRouteMappings) {
      messages.push(
        t("claudeDesktop.statusMissingRouteMappings", {
          defaultValue:
            "当前供应商启用了模型映射，但没有有效路由；请编辑供应商并补全至少一个模型映射。",
        }),
      );
    }
    if (
      claudeDesktopStatus.mode === "proxy" &&
      !claudeDesktopStatus.gatewayTokenConfigured
    ) {
      messages.push(
        t("claudeDesktop.statusGatewayTokenMissing", {
          defaultValue:
            "当前本地路由 token 尚未生成；重新切换该供应商会写入新的本地 token。",
        }),
      );
    }

    const expected = claudeDesktopStatus.expectedBaseUrl?.replace(/\/+$/, "");
    const actual = claudeDesktopStatus.actualBaseUrl?.replace(/\/+$/, "");
    if (expected && actual && expected !== actual) {
      messages.push(
        t("claudeDesktop.statusBaseUrlMismatch", {
          expected,
          actual,
          defaultValue:
            "Claude Desktop profile 指向的地址与当前供应商不一致；当前为 {{actual}}，应为 {{expected}}。重新切换当前供应商可修复。",
        }),
      );
    }

    return messages;
  }, [appId, claudeDesktopStatus, t]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="w-full border border-dashed rounded-lg h-28 border-muted-foreground/40 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (sortedProviders.length === 0) {
    return (
      <ProviderEmptyState
        appId={appId}
        onCreate={onCreate}
        onImport={() => importMutation.mutate()}
        onImportList={
          appId === "claude" ? handleImportClaudeProviders : undefined
        }
      />
    );
  }

  const renderProviderList = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={filteredProviders.map((provider) => provider.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {filteredProviders.map((provider) => {
            const isOmo = provider.category === "omo";
            const isOmoSlim = provider.category === "omo-slim";
            const isOmoCurrent = isOmo && provider.id === (currentOmoId || "");
            const isOmoSlimCurrent =
              isOmoSlim && provider.id === (currentOmoSlimId || "");
            const isHermesCurrent =
              appId === "hermes" && hermesCurrentProviderId === provider.id;
            return (
              <SortableProviderCard
                key={provider.id}
                provider={provider}
                isCurrent={
                  isOmo
                    ? isOmoCurrent
                    : isOmoSlim
                      ? isOmoSlimCurrent
                      : appId === "hermes"
                        ? isHermesCurrent
                        : provider.id === currentProviderId
                }
                appId={appId}
                isInConfig={isProviderInConfig(provider.id)}
                isOmo={isOmo}
                isOmoSlim={isOmoSlim}
                onSwitch={onSwitch}
                onEdit={onEdit}
                onDelete={onDelete}
                onRemoveFromConfig={onRemoveFromConfig}
                onDisableOmo={onDisableOmo}
                onDisableOmoSlim={onDisableOmoSlim}
                onDuplicate={onDuplicate}
                onConfigureUsage={onConfigureUsage}
                onOpenWebsite={onOpenWebsite}
                onOpenTerminal={onOpenTerminal}
                onTest={handleTest}
                isTesting={
                  isChecking(provider.id) || testingAllIds.has(provider.id)
                }
                testResult={testResults[provider.id]}
                isProxyRunning={isProxyRunning}
                isProxyTakeover={isProxyTakeover}
                isAutoFailoverEnabled={isFailoverModeActive}
                failoverPriority={getFailoverPriority(provider.id)}
                isInFailoverQueue={isInFailoverQueue(provider.id)}
                onToggleFailover={(enabled) =>
                  handleToggleFailover(provider.id, enabled)
                }
                activeProviderId={activeProviderId}
                // OpenClaw: default model / Hermes: model.provider === provider.id
                isDefaultModel={
                  appId === "hermes"
                    ? isHermesCurrent
                    : isProviderDefaultModel(provider.id)
                }
                onSetAsDefault={
                  onSetAsDefault ? () => onSetAsDefault(provider) : undefined
                }
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {testSummary && (
          <div
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground"
            title={t("streamCheck.lastBatchSummary", {
              passed: testSummary.passed,
              failed: testSummary.failed,
              total: testSummary.total,
              defaultValue:
                "最近测试：{{passed}} 成功，{{failed}} 失败，共 {{total}} 个",
            })}
          >
            {testSummary.failed === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            )}
            <span>
              {testSummary.passed}/{testSummary.total}
            </span>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleTestAll}
          disabled={isTestingAll}
        >
          {isTestingAll ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <TestTube2 className="mr-2 h-4 w-4" />
          )}
          {t("streamCheck.testAll", {
            defaultValue: "测试所有",
          })}
        </Button>
        {appId === "claude" && (
          <>
            {currentProviderId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearClaudeCurrentProvider}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("provider.clearInUse", {
                  defaultValue: "取消使用",
                })}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleImportClaudeProviders}
              disabled={isProviderListTransferring}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("provider.importList", {
                defaultValue: "导入列表",
              })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportClaudeProviders}
              disabled={isProviderListTransferring}
            >
              <Download className="mr-2 h-4 w-4" />
              {t("provider.exportList", {
                defaultValue: "导出列表",
              })}
            </Button>
          </>
        )}
      </div>
      {claudeDesktopStatusMessages.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("claudeDesktop.statusTitle", {
              defaultValue: "Claude Desktop 配置需要检查",
            })}
          </div>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed">
            {claudeDesktopStatusMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            key="provider-search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-[6.5rem] z-40 w-[min(90vw,26rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0"
          >
            <div className="p-4 space-y-3 border shadow-md rounded-2xl border-white/10 bg-background/95 shadow-black/20 backdrop-blur-md">
              <div className="relative flex items-center gap-2">
                <Search className="absolute w-4 h-4 -translate-y-1/2 pointer-events-none left-3 top-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t("provider.searchPlaceholder", {
                    defaultValue: "Search name, notes, or URL...",
                  })}
                  aria-label={t("provider.searchAriaLabel", {
                    defaultValue: "Search providers",
                  })}
                  className="pr-16 pl-9"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute text-xs -translate-y-1/2 right-11 top-1/2"
                    onClick={() => setSearchTerm("")}
                  >
                    {t("common.clear", { defaultValue: "Clear" })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => setIsSearchOpen(false)}
                  aria-label={t("provider.searchCloseAriaLabel", {
                    defaultValue: "Close provider search",
                  })}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {t("provider.searchScopeHint", {
                    defaultValue: "Matches provider name, notes, and URL.",
                  })}
                </span>
                <span>
                  {t("provider.searchCloseHint", {
                    defaultValue: "Press Esc to close",
                  })}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filteredProviders.length === 0 ? (
        <div className="px-6 py-8 text-sm text-center border border-dashed rounded-lg border-border text-muted-foreground">
          {t("provider.noSearchResults", {
            defaultValue: "No providers match your search.",
          })}
        </div>
      ) : (
        renderProviderList()
      )}

      <ConfirmDialog
        isOpen={showStreamCheckConfirm}
        variant="info"
        title={t("confirm.streamCheck.title")}
        message={t("confirm.streamCheck.message")}
        confirmText={t("confirm.streamCheck.confirm")}
        onConfirm={() => void handleStreamCheckConfirm()}
        onCancel={() => {
          setShowStreamCheckConfirm(false);
          setPendingTestProvider(null);
          setPendingTestAll(false);
        }}
      />
    </div>
  );
}

interface SortableProviderCardProps {
  provider: Provider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig: boolean;
  isOmo: boolean;
  isOmoSlim: boolean;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onTest?: (provider: Provider) => void;
  isTesting: boolean;
  testResult?: StreamCheckResult;
  isProxyRunning: boolean;
  isProxyTakeover: boolean;
  isAutoFailoverEnabled: boolean;
  failoverPriority?: number;
  isInFailoverQueue: boolean;
  onToggleFailover: (enabled: boolean) => void;
  activeProviderId?: string;
  // OpenClaw: default model
  isDefaultModel?: boolean;
  onSetAsDefault?: () => void;
}

function SortableProviderCard({
  provider,
  isCurrent,
  appId,
  isInConfig,
  isOmo,
  isOmoSlim,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onTest,
  isTesting,
  testResult,
  isProxyRunning,
  isProxyTakeover,
  isAutoFailoverEnabled,
  failoverPriority,
  isInFailoverQueue,
  onToggleFailover,
  activeProviderId,
  isDefaultModel,
  onSetAsDefault,
}: SortableProviderCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProviderCard
        provider={provider}
        isCurrent={isCurrent}
        appId={appId}
        isInConfig={isInConfig}
        isOmo={isOmo}
        isOmoSlim={isOmoSlim}
        onSwitch={onSwitch}
        onEdit={onEdit}
        onDelete={onDelete}
        onRemoveFromConfig={onRemoveFromConfig}
        onDisableOmo={onDisableOmo}
        onDisableOmoSlim={onDisableOmoSlim}
        onDuplicate={onDuplicate}
        onConfigureUsage={
          onConfigureUsage ? (item) => onConfigureUsage(item) : () => undefined
        }
        onOpenWebsite={onOpenWebsite}
        onOpenTerminal={onOpenTerminal}
        onTest={onTest}
        isTesting={isTesting}
        testResult={testResult}
        isProxyRunning={isProxyRunning}
        isProxyTakeover={isProxyTakeover}
        dragHandleProps={{
          attributes,
          listeners,
          isDragging,
        }}
        isAutoFailoverEnabled={isAutoFailoverEnabled}
        failoverPriority={failoverPriority}
        isInFailoverQueue={isInFailoverQueue}
        onToggleFailover={onToggleFailover}
        activeProviderId={activeProviderId}
        // OpenClaw: default model
        isDefaultModel={isDefaultModel}
        onSetAsDefault={onSetAsDefault}
      />
    </div>
  );
}
