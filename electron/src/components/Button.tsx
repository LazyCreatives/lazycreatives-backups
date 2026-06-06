import type { ButtonHTMLAttributes } from "react";

export function Button({ variant = "primary", style, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const bg = variant === "primary" ? "var(--accent)"
    : variant === "danger" ? "var(--danger)" : "transparent";
  const color = variant === "ghost" ? "var(--text)" : "#0b0d12";
  return (
    <button {...rest} style={{
      background: bg, color, border: variant === "ghost" ? "1px solid var(--border)" : "none",
      padding: "10px 16px", borderRadius: 10, fontWeight: 600, cursor: "pointer",
      opacity: rest.disabled ? 0.5 : 1, ...style,
    }} />
  );
}
