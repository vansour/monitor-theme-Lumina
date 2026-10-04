import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ImageUp, Monitor, Settings, Sun, Moon, Trash2 } from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useMe } from "@/hooks/useMe";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { saveFavicon } from "@/lib/config";
import { MAX_FAVICON_BYTES, icoToDataUrl } from "@/utils/favicon";
import { clsx } from "clsx";

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
  { value: "dark", icon: Moon, label: "深色" },
] as const;

/** 站点图标的上传状态：三态互斥，`busy` 时两行按钮都不可点。 */
type IconEdit = { busy: boolean; error: string | null; done: boolean };
const IDLE_ICON_EDIT: IconEdit = { busy: false, error: null, done: false };

/**
 * 右上角常驻的一个菜单按钮，外观、站点图标与后台入口收在点开的面板里。
 *
 * 几条交互约定：
 * - 点按钮开合；点面板外、按 Esc 关闭，Esc 把焦点还给按钮，键盘用户不会迷失。
 * - 选了外观**不关面板**：可以连着比三种，页面立刻变本身就是反馈。
 * - 站点图标那两行只对**登录着后台的站长**显示（`/api/me` 的 `authed`）：保存走的是
 *   hub 的管理员接口，匿名访客点了也只会拿到 401。
 * - 不做模态、不锁焦点 —— 面板里就这么几行，Tab 顺序按 DOM 走。
 */
export function FloatingControls() {
  const { appearance, setAppearance } = usePreferences();
  const { data: me } = useMe();
  const { data: config } = useThemeConfig();
  const { failureStreak } = useNodeStoreStatus();
  const [open, setOpen] = useState(false);
  const [iconEdit, setIconEdit] = useState<IconEdit>(IDLE_ICON_EDIT);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const showAdmin = config?.enable_admin_button !== false;
  const showSyncWarning = failureStreak >= 2;

  async function saveSiteIcon(dataUrl: string | null) {
    setIconEdit({ busy: true, error: null, done: false });
    try {
      await saveFavicon(dataUrl);
      // 设置立刻读回来：图标与「更换 / 移除」两行文案都不用等下一次拉取。
      await queryClient.invalidateQueries({ queryKey: ["theme-config"] });
      setIconEdit({ busy: false, error: null, done: true });
    } catch (error) {
      setIconEdit({
        busy: false,
        error: error instanceof Error ? error.message : "保存失败，稍后再试",
        done: false,
      });
    }
  }

  async function pickIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清掉选择，同一个文件改过之后再传一次也要能触发 change。
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FAVICON_BYTES) {
      setIconEdit({ busy: false, error: `图标不能超过 ${MAX_FAVICON_BYTES / 1024} KiB`, done: false });
      return;
    }
    const dataUrl = icoToDataUrl(new Uint8Array(await file.arrayBuffer()));
    if (!dataUrl) {
      setIconEdit({ busy: false, error: "这不是一个 .ico 文件", done: false });
      return;
    }
    await saveSiteIcon(dataUrl);
  }

  // 只有开着的时候才挂监听。
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 面板一关就把上传反馈清掉：下次打开该是一条干净的面板。
  useEffect(() => {
    if (!open) setIconEdit(IDLE_ICON_EDIT);
  }, [open]);

  return (
    <div className={clsx("floating-controls", showSyncWarning && "has-warning")}>
      <div className="floating-controls-inner">
        <button
          ref={triggerRef}
          type="button"
          className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
          aria-label="设置"
          aria-haspopup="dialog"
          aria-expanded={open}
          title="设置"
          onClick={() => setOpen((value) => !value)}
        >
          <Settings size={16} />
          {showSyncWarning && <span className="floating-controls-warning-dot" aria-hidden />}
        </button>

        {/* 同步异常要的是「不打开菜单也看得见」，所以不搬进面板。 */}
        {showSyncWarning && (
          <div className="floating-controls-warning">
            <AlertTriangle size={12} aria-hidden />
            <span>实时状态同步异常，当前展示的是最近缓存</span>
          </div>
        )}

        {open && (
          <div ref={panelRef} className="floating-panel" role="dialog" aria-label="设置">
            <p className="floating-panel-title">外观</p>
            <div className="floating-panel-list">
              {APPEARANCE_OPTIONS.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  className="floating-panel-option"
                  data-active={appearance === value ? "true" : "false"}
                  aria-pressed={appearance === value}
                  onClick={() => setAppearance(value)}
                >
                  <Icon size={15} aria-hidden />
                  <span>{label}</span>
                  {appearance === value && (
                    <Check className="floating-panel-check" size={14} strokeWidth={2.4} aria-hidden />
                  )}
                </button>
              ))}
            </div>
            {showAdmin && (
              <>
                <div className="floating-panel-divider" />
                {/* 后台是 hub 内置的另一个 app，不是本主题的路由，所以这里是跳转不是 Link。 */}
                <a className="floating-panel-option" href="/admin/">
                  <Settings size={15} aria-hidden />
                  <span>{me?.authed ? "管理后台" : "后台登录"}</span>
                </a>
              </>
            )}
            {me?.authed && (
              <>
                <div className="floating-panel-divider" />
                <p className="floating-panel-title">站点图标</p>
                <div className="floating-panel-list">
                  <button
                    type="button"
                    className="floating-panel-option"
                    disabled={iconEdit.busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <ImageUp size={15} aria-hidden />
                    <span>{config?.favicon ? "更换图标" : "上传图标"}</span>
                  </button>
                  {config?.favicon && (
                    <button
                      type="button"
                      className="floating-panel-option"
                      disabled={iconEdit.busy}
                      onClick={() => void saveSiteIcon(null)}
                    >
                      <Trash2 size={15} aria-hidden />
                      <span>移除图标</span>
                    </button>
                  )}
                </div>
                <p className="floating-panel-note" data-error={iconEdit.error ? "true" : "false"}>
                  {iconEdit.busy
                    ? "正在保存…"
                    : (iconEdit.error ?? (iconEdit.done ? "已更新站点图标" : ".ico · 不超过 32 KiB · 全站可见"))}
                </p>
                {/* 藏起来的文件选择器：点上面那一行才会被唤起。 */}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".ico,image/x-icon"
                  className="hidden"
                  onChange={(event) => void pickIcon(event)}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
