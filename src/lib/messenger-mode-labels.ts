import type { MessengerMode } from "@/hooks/use-messenger-mode";

/**
 * Pure label/state helpers for the Loner ↔ OG Battle Zone toggle.
 * Centralised so UI copy and the underlying mode can't drift apart
 * (covered by src/lib/messenger-mode-labels.test.ts).
 */

export function isCommunityMode(mode: MessengerMode): boolean {
  return mode === "community";
}

export function modeHeading(mode: MessengerMode): string {
  return isCommunityMode(mode) ? "OG Battle Zone" : "0G B0T Loner Mode";
}

export function modeBadge(mode: MessengerMode): string {
  return isCommunityMode(mode)
    ? "OG Battle Zone · everyone vs 0G B0T"
    : "0G B0T Loner Mode · private";
}

/** Visible pill copy — describes the action the NEXT click will perform. */
export function toggleActionLabel(mode: MessengerMode, isSaving: boolean): string {
  if (isSaving) return "Saving…";
  return isCommunityMode(mode) ? "Start Private Mode" : "Leave Private Mode";
}

/** Screen-reader label — full action sentence. */
export function toggleAriaLabel(mode: MessengerMode): string {
  return isCommunityMode(mode)
    ? "Start Private Mode (leave the OG Battle Zone)"
    : "Leave Private Mode (enter the OG Battle Zone)";
}

/** The mode the toggle will move to when clicked. */
export function nextMode(mode: MessengerMode): MessengerMode {
  return isCommunityMode(mode) ? "loner" : "community";
}
