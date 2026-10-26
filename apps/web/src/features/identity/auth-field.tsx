import { Input } from "@/components/ui";
import type { ComponentProps } from "react";

export function AuthField({
  label,
  errors,
  ...props
}: Omit<ComponentProps<"input">, "title" | "size"> & {
  id: string;
  label: string;
  errors: readonly (string | undefined)[];
}) {
  const error = errors.filter(Boolean).join(" ");
  return <Input {...(props as object)} title={label} error={error || undefined} aria-invalid={errors.length > 0} />;
}
