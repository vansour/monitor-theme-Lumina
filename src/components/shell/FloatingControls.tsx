import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Monitor, Settings, Sun, Moon } from "lucide-react";
import { usePreferences } from "@/hooks/usePreferences";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { useMe } from "@/hooks/useMe";
import { useThemeConfig } from "@/hooks/useThemeConfig";
import { clsx } from "clsx";

const APPEARANCE_OPTIONS = [
  { value: "light", icon: Sun, label: "浅色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
  { value: "dark", icon: Moon, label: "深色" },
] as const;

/**
 * 右上角常驻的一个菜单按钮，外观与后台入口收在点开的面板里。
 *
 * 三条交互约定：
 * - 点按钮开合；点面板外、按 Esc 关闭，Esc 把焦点还给按钮，键盘用户不会迷失。
 * - 选了外观**不关面板**：可以连着比三种，页面立刻变本身就是反馈。
 * - 不做模态、不锁焦点 —— 面板里就四行，Tab 顺序按 DOM 走。
 */
export function FloatingControls() {
  const { appearance, setAppearance } = usePreferences();
  const { data: me } = useMe();
  const { data: config } = useThemeConfig();
  const { failureStreak } = useNodeStoreStatus();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const showAdmin = config?.enable_admin_button !== false;
  const showSyncWarning = failureStreak >= 2;

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
          </div>
        )}
      </div>
    </div>
  );
}
