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
