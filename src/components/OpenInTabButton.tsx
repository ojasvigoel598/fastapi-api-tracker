import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openInNewTab } from "@/lib/open-tab";

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
