import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Opens the current app URL in a full browser tab.
 *
 * The Freebuff preview runs the app inside a managed pane/iframe. Opening the
 * app in its own tab escapes that context, which also avoids third-party
 * cookie/storage partitioning that can otherwise interfere with the session.
 */
export function openInNewTab(): void {
  window.open(window.location.href, "_blank", "noopener,noreferrer");
}

export function OpenInTabButton({
  variant = "outline",
  size = "sm",
  className,
}: {
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={openInNewTab}
      title="Open this page in a new browser tab"
    >
      <ExternalLink className="h-4 w-4 mr-1.5" />
      Open in tab
    </Button>
  );
}
