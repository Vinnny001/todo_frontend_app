import { useEffect, useRef } from "react";

export type MenuItem = {
  label: string;
  icon: string;
  danger?: boolean;
  onClick: () => void;
};

export function ContextMenu({
  items,
  onClose,
  anchorRef,
}: {
  items: MenuItem[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      )
        onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose, anchorRef]);

  return (
    <div className="ctx-menu" ref={ref}>
      {items.map((item) => (
        <button
          key={item.label}
          className={`ctx-item${item.danger ? " danger" : ""}`}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <span className="ctx-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
