import type { SharedStatus } from "./api";

// The line under "Share albums and folders" (Settings, Backups): whether it's on,
// when it last shared and with which computers, or what's in the way.
export function sharedNote(st: SharedStatus | null, hasDest: boolean, computer: string, now = Date.now()): { text: string; bad?: boolean } {
  if (!hasDest) return { text: "Pick a backup drive above first. That's where they're shared." };
  if (!st?.on) return { text: `Off. Albums and Folders stay on this ${computer} only.` };
  if (st.error) return { text: st.error, bad: true };
  if (st.waiting) return { text: st.waiting };
  if (!st.at) return { text: "Sharing now…" };
  const mins = Math.max(0, Math.round((now / 1000 - st.at) / 60));
  const when = mins < 1 ? "just now" : mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const others = st.computers ?? [];
  if (!others.length) return { text: `Shared ${when}. Turn this on in Backups on your other computers too, with the same backup drive.` };
  const names = others.length <= 3 ? others.join(", ") : `${others.slice(0, 2).join(", ")} and ${others.length - 2} more`;
  return { text: `Shared ${when} with ${names}.` };
}
