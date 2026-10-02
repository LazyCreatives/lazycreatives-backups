import type { ButtonHTMLAttributes } from "react";

export function Button({ variant = "primary", size, className = "", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" | "danger"; size?: "sm" }) {
  const cls = `btn btn--${variant}${size === "sm" ? " btn--sm" : ""} ${className}`.trim();
  return <button {...rest} className={cls} />;
}
