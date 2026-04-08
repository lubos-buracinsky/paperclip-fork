import { useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import type { UpdateStatus } from "../api/health";

function formatCheckedAt(value: string): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "just now";
  const deltaMinutes = Math.round(deltaMs / 60_000);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function UpdateBanner({ updateStatus }: { updateStatus?: UpdateStatus }) {
  const [dismissed, setDismissed] = useState(false);

  if (!updateStatus?.available || dismissed) return null;

  const checkedAt = formatCheckedAt(updateStatus.checkedAt);

  return (
    <div className="border-b border-blue-300/60 bg-blue-50 text-blue-950 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-100">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ArrowUpCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            Upstream update available — {updateStatus.behind} commit{updateStatus.behind === 1 ? "" : "s"} behind
          </span>
          {checkedAt ? (
            <span className="text-xs text-blue-900/60 dark:text-blue-100/50">
              checked {checkedAt}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-blue-900/60 dark:text-blue-100/50">
            {updateStatus.currentSha.slice(0, 7)} → {updateStatus.upstreamSha.slice(0, 7)}
          </span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-1 hover:bg-blue-900/10 dark:hover:bg-blue-100/10"
            aria-label="Dismiss update notification"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
