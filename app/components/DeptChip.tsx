"use client";

import { departmentById } from "@/lib/taxonomy";

/**
 * A department shown as a coloured dot plus its label.
 *
 * The hue is a grouping cue only — the label is always present, so the chip
 * stays readable for anyone who can't distinguish the colours, and the dot
 * never has to carry text contrast.
 */
export function DeptChip({ id }: { id: string }) {
  const dept = departmentById(id);
  if (!dept) return null;

  return (
    <span className="dept-chip">
      <span
        className="dept-dot"
        style={{ ["--dept-color" as string]: `var(--dept-${id})` }}
      />
      {dept.label}
    </span>
  );
}
