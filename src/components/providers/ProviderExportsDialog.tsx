import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyText } from "@/lib/clipboard";

interface ProviderExportsDialogProps {
  provider: Provider;
  exportsText: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProviderExportsDialog({
  provider,
  exportsText,
  open,
  onOpenChange,
}: ProviderExportsDialogProps) {
  const { t } = useTranslation();
  const hasExports = exportsText.trim().length > 0;

  const handleCopy = async () => {
    if (!hasExports) return;

    try {
      await copyText(exportsText);
      toast.success(
        t("providerExports.copied", { defaultValue: "已复制 exports" }),
      );
    } catch {
      toast.error(
        t("providerExports.copyFailed", {
          defaultValue: "复制失败，请手动选择文本复制",
        }),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" zIndex="top">
        <DialogHeader>
          <DialogTitle>
            {t("providerExports.title", {
              name: provider.name,
              defaultValue: `${provider.name} exports`,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("providerExports.description", {
              defaultValue: "可选择文本，或一键复制到剪贴板。",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5">
          {hasExports ? (
            <textarea
              readOnly
              value={exportsText}
              onFocus={(event) => event.currentTarget.select()}
              spellCheck={false}
              className="min-h-44 w-full resize-y rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          ) : (
            <div className="rounded-md border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
              {t("providerExports.empty", {
                defaultValue: "当前供应商没有可导出的环境变量。",
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close", { defaultValue: "关闭" })}
          </Button>
          <Button onClick={handleCopy} disabled={!hasExports}>
            <Copy className="h-4 w-4" />
            {t("common.copy", { defaultValue: "复制" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
