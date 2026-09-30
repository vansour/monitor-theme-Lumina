import { useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Monitor, Settings, Sun, Moon } from "lucide-react";
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
const COLLAPSED_STORAGE_KEY = "lumina:floating-controls-collapsed";

function readStoredCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage 不可用时保留内存里的状态。
  }
}

export function FloatingControls() {
  const { appearance, setAppearance } = usePreferences();
  const { data: me } = useMe();
  const { data: config } = useThemeConfig();
  const { failureStreak } = useNodeStoreStatus();
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const showAdmin = config?.enable_admin_button !== false;
  const showSyncWarning = failureStreak >= 2;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;

  return (
    <div
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            <div className="control-group" role="group" aria-label="外观选择">
              {APPEARANCE_OPTIONS.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAppearance(value)}
                  aria-label={label}
                  aria-pressed={appearance === value}
                  title={label}
                  tabIndex={hiddenTabIndex}
                  className={clsx(
                    "control-button control-toggle grid h-9 w-9 place-items-center",
                    appearance === value && "is-active",
                  )}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
            {showAdmin && (
              // 后台是 hub 内置的另一个 app，不是本主题的路由，所以这里是跳转不是 Link。
              <a
                href="/admin/"
                aria-label={me?.authed ? "管理" : "后台登录"}
                title={me?.authed ? "管理" : "后台登录"}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <Settings size={16} />
              </a>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
            aria-expanded={!collapsed}
            onClick={() => {
              setCollapsed((value) => {
                const next = !value;
                persistCollapsed(next);
                return next;
              });
            }}
            title={collapsed ? "展开快捷按钮" : "收起快捷按钮"}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
        </div>
        {showSyncWarning && !collapsed && (
          <div className="pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--status-offline)] shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>实时状态同步异常，当前展示的是最近缓存</span>
          </div>
        )}
      </div>
    </div>
  );
}
