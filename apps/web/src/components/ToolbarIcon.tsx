/** Small dependency-free line icons. The owning button provides the accessible name. */
export function ToolbarIcon({ icon }: { icon: "settings" | "video" | "share" | "stop" }) {
  return <span className="meeting-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none">
    {icon === "settings" && <><circle cx="12" cy="12" r="3" /><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" /></>}
    {icon === "video" && <><rect x="3" y="6" width="12" height="12" rx="3" /><path d="m15 10 6-3v10l-6-3" /></>}
    {(icon === "share" || icon === "stop") && <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8m-4-4v4" />{icon === "share" ? <path d="M12 14V6m-3 3 3-3 3 3" /> : <path d="m9 7 6 6m0-6-6 6" />}</>}
  </svg></span>;
}
