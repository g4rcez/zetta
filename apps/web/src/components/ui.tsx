import {
  Autocomplete as LibAutocomplete,
  Button as LibButton,
  Checkbox as LibCheckbox,
  Input as LibInput,
  Modal as LibModal,
  ModalConfirmProvider as LibModalConfirmProvider,
  Progress as LibProgress,
  Radiobox as LibRadiobox,
  Select as LibSelect,
} from "@g4rcez/components";
import { Dropdown as LibDropdown } from "@g4rcez/components/dropdown";
import { Menu as LibMenu, MenuItem as LibMenuItem } from "@g4rcez/components/menu";
import type { ComponentProps, ReactNode } from "react";

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

/**
 * Action menus and panels. `Menu` opens at the bottom-start of its trigger (flipping when there is no room) and has no `align`/`side`.
 * Pass `hover={false}` (a menu opens on click, not on hover); the focus goes back to the trigger by default. Width goes in
 * `floatingClassName`; the max height is the token `[--var-menu-surface-max-block-size:…]`, because a Tailwind class loses to the library CSS.
 * A trigger with its own `aria-label` passes `title=""`: `title` is required for an element label and would show a native tooltip.
 */
export const Menu = LibMenu;
export const MenuItem = LibMenuItem;
export const Dropdown = LibDropdown;

/** A destructive menu item (Delete, Cancel): the danger color on a `MenuItem`. */
export const MENU_DANGER = "text-[var(--var-color-danger)]";

/** A heading for a group of menu items. The items live in a `role="group"` element that this names. */
export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex w-full flex-col">
      {label && (
        <p aria-hidden="true" className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/** A line between groups of menu items. */
export function MenuSeparator() {
  return <hr role="separator" className="my-1 w-full border-0 border-t border-border" />;
}

const PROGRESS_TONE = {
  primary: "",
  success: "[--var-color-primary:var(--var-color-success)]",
  warn: "[--var-color-primary:var(--var-color-warn)]",
  danger: "[--var-color-primary:var(--destructive)]",
} as const;
const PROGRESS_SIZE = {
  thin: "[--var-progress-track-block-size:0.25rem]",
  small: "[--var-progress-track-block-size:0.375rem]",
  medium: "[--var-progress-track-block-size:0.5rem]",
} as const;

/**
 * The library `Progress` as a thin bar. The library draws a percentage over the track; here the track is a few pixels high, so
 * `label` is the accessible name only (hidden for the eye), and the text next to the bar is the caller's. The color and the size are
 * the library's tokens set on the track, because a Tailwind class loses to the library CSS.
 */
export function Progress({
  value,
  min = 0,
  max = 100,
  label,
  tone = "primary",
  size = "thin",
  className = "",
}: {
  value: number;
  min?: number;
  max?: number;
  /** The accessible name of the bar. */
  label: string;
  tone?: keyof typeof PROGRESS_TONE;
  size?: keyof typeof PROGRESS_SIZE;
  className?: string;
}) {
  return (
    // The library track is `inline-size: 100%`, which a width class cannot beat: the caller sizes this wrapper.
    <div className={className}>
      <LibProgress
        value={value}
        min={min}
        max={max}
        label={label}
        // Important: the library sets the label's width, margin and display in unlayered CSS, which a plain `sr-only` would lose to.
        textClassName="sr-only!"
        container={`[--var-color-background:var(--muted)] ${PROGRESS_SIZE[size]} ${PROGRESS_TONE[tone]}`}
      />
    </div>
  );
}
