import { Prose } from "@/components/content/Prose";

/** Product information text, a little smaller than a full page. */
export function Markdown({ children }: { children: string }) {
  return <Prose className="text-body-sm">{children}</Prose>;
}
