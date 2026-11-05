import {
  Autocomplete as LibAutocomplete,
  Button as LibButton,
  Checkbox as LibCheckbox,
  Input as LibInput,
  Modal as LibModal,
  ModalConfirmProvider as LibModalConfirmProvider,
  Radiobox as LibRadiobox,
  Select as LibSelect,
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

/** The library has one icon size (about 24px); the old shadcn sizes were 32 / 24 / 28 / 40px, so the box is set here. */
const ICON_BOX: Partial<Record<Size, string>> = {
  icon: "size-8",
  "icon-xs": "size-6",
  "icon-sm": "size-7",
  "icon-lg": "size-10",
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
      className={`${ICON_BOX[size] ?? ""} ${className}`.trim()}
    />
  );
}
export const Input = LibInput;
export const Modal = LibModal;
/** Mounted once in the root layout: it renders the dialog behind `Modal.confirm(...)`, which replaces `window.confirm`. */
export const ModalConfirmProvider = LibModalConfirmProvider;
export const Select = LibSelect;
export const Autocomplete = LibAutocomplete;
export const Checkbox = LibCheckbox;
export const Radiobox = LibRadiobox;
