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
/** Decorative rule: `<hr>`. Between controls it is a vertical `role="separator"`. */
export function Separator({
  orientation = "horizontal",
  className = "",
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return orientation === "vertical" ? (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`w-px shrink-0 self-stretch bg-border ${className}`.trim()}
    />
  ) : (
    <hr className={`m-0 h-px w-full shrink-0 border-0 bg-border ${className}`.trim()} />
  );
}
export const Modal = LibModal;
/** Mounted once in the root layout: it renders the dialog behind `Modal.confirm(...)`, which replaces `window.confirm`. */
export const ModalConfirmProvider = LibModalConfirmProvider;
/**
 * Class for a `Modal type="drawer"` that holds a full panel (sidebar, task, thread): the DS drawer adds its own padding, radius and a
 * 320px minimum width, and a Tailwind `p-0` loses to that CSS. These are the DS tokens for them. Set the width cap per drawer with
 * `[--var-modal-drawer-max-inline-size:…]`.
 */
export const DRAWER_FLUSH =
  "[--var-modal-surface-padding-block:0px] [--var-modal-content-padding-inline:0px] [--var-modal-body-padding-block:0px] [--var-modal-surface-radius:0px] [--var-modal-surface-min-inline-size:0px]";
export const Select = LibSelect;
export const Autocomplete = LibAutocomplete;
export const Checkbox = LibCheckbox;
export const Radiobox = LibRadiobox;
