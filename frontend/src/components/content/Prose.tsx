import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/cn";

/**
 * Admin-written text on the page. Raw HTML is never rendered, and what is rendered is sanitised again as a second
 * guard. Links that leave the site open safely; headings, lists and tables get the shop's typography.
 */
export function Prose({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 text-body text-ink-soft [&_a]:font-semibold [&_a]:text-primary-strong [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-line-accent [&_blockquote]:pl-4 [&_h1]:font-display [&_h1]:text-heading-md [&_h1]:font-extrabold [&_h1]:text-ink [&_h2]:mt-3 [&_h2]:font-display [&_h2]:text-heading-sm [&_h2]:font-extrabold [&_h2]:text-ink [&_h3]:mt-2 [&_h3]:font-bold [&_h3]:text-ink [&_li]:ml-5 [&_li]:pl-1 [&_ol]:list-decimal [&_strong]:font-bold [&_strong]:text-ink [&_table]:w-full [&_table]:text-body-sm [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_th]:border-b-2 [&_th]:border-line-strong [&_th]:py-2 [&_th]:text-left [&_ul]:list-disc",
        className,
      )}
    >
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ href, children: label }) => {
            const external = !!href && /^https?:\/\//i.test(href);
            return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{label}</a>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
