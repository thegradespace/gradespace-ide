import type { SVGProps } from "react";

export function GradespaceMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="54 54 404 404" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M376 150 A160 160 0 1 0 376 362" stroke="currentColor" strokeWidth="84" />
      <path d="M226 186 L300 256 L226 326" stroke="currentColor" strokeWidth="72" />
    </svg>
  );
}
