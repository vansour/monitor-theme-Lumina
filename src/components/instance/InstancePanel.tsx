import type { ReactNode } from "react";
import { clsx } from "clsx";

export function InstancePanel({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("instance-panel", className)}>
      <header className="instance-panel-header">
        <div className="instance-panel-headings">
          <h2 className="instance-panel-title">{title}</h2>
        </div>
        {aside && <div className="instance-panel-aside">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
