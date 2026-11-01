import { cn } from "../lib/utils";

/** The light logo has black lettering, the dark one white. */
export function GradespaceLogo({ className }: { className?: string }) {
  return (
    // A column-flex parent would stretch a bare img across its width.
    <span className="inline-flex shrink-0 self-start">
      <img
        src="/brand/gradespace-logo-light.png"
        alt="Gradespace"
        width={79}
        height={22}
        className={cn("w-auto shrink-0 dark:hidden", className)}
      />
      <img
        src="/brand/gradespace-logo-dark.png"
        alt="Gradespace"
        width={79}
        height={22}
        className={cn("hidden w-auto shrink-0 dark:block", className)}
      />
    </span>
  );
}
