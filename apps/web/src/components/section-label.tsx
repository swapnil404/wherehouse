import { cn } from "@wherehouse/ui/lib/utils";

import { text } from "./panel-styles";

/**
 * Uppercase micro-heading above a group of controls.
 *
 * Previously written out inline in four files, all four spelling the same
 * intent slightly differently. A rail this dense needs the headings to be
 * mechanically identical, because they are the only thing separating one
 * group of controls from the next.
 *
 * Renders `h2` by default. The score panel's headings sit inside a card that
 * is itself a section, so they pass `as="p"` to avoid claiming a document
 * outline level they do not own.
 */
export default function SectionLabel({
  children,
  as: Tag = "h2",
  className,
}: {
  children: React.ReactNode;
  as?: "h2" | "p";
  className?: string;
}) {
  return <Tag className={cn(text.label, className)}>{children}</Tag>;
}
