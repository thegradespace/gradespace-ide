import { cn } from "../lib/utils";

/** The light logo has black lettering, the dark one white. */
export function GradespaceLogo({ className }: { className?: string }) {
  return (
    <>
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
    </>
  );
}
