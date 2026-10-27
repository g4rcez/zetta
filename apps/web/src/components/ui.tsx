import {
  Button as LibButton,
  Checkbox as LibCheckbox,
  Input as LibInput,
  Modal as LibModal,
  Radiobox as LibRadiobox,
  Select as LibSelect,
  Textarea as LibTextarea,
} from "@g4rcez/components";
import type { ComponentProps } from "react";

/**
 * The application's primitives are @g4rcez/components. This module keeps the shadcn-style call sites (variant/size) stable
 * while rendering the library's components, so theming, geometry and rounding come from the library's tokens (see index.css).
 */
type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "success" | "link";
type Size = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
const THEME: Record<Variant, string> = {
  default: "primary",
  outline: "neutral",
  secondary: "muted",
  ghost: "ghost-muted",
  destructive: "danger",
  success: "success",
  link: "ghost-primary",
};
const SIZE: Record<Size, string> = {
  default: "default",
  xs: "tiny",
  sm: "small",
  lg: "big",
  icon: "icon",
  "icon-xs": "icon",
  "icon-sm": "icon",
  "icon-lg": "icon",
};

export function Button({
  variant = "default",
  size = "default",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <LibButton
      {...(props as object)}
      theme={THEME[variant] as never}
      size={SIZE[size] as never}
      rounded={size === "icon-lg" ? "circle" : "default"}
      className={className}
    />
  );
}
export const Input = LibInput;
export const Textarea = LibTextarea;
export const Modal = LibModal;
export const Select = LibSelect;
export const Checkbox = LibCheckbox;
export const Radiobox = LibRadiobox;
