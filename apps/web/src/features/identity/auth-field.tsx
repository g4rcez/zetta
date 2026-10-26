import { Input } from "@/components/ui";
import { Label } from "@zetta/ui/components/label";
import type { ComponentProps } from "react";

export function AuthField({
  label,
  errors,
  ...props
}: ComponentProps<typeof Input> & {
  id: string;
  label: string;
  errors: readonly (string | undefined)[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{label}</Label>
      <Input
        {...props}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length ? `${props.id}-error` : undefined}
      />
      {errors.length > 0 && (
        <div id={`${props.id}-error`} role="alert" className="text-sm text-destructive">
          {errors.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
