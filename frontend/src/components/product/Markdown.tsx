import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

/** Admin-written text. Raw HTML is not rendered, and what is rendered is sanitised again as a second guard. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-3 text-body-sm text-ink-soft [&_a]:text-primary-strong [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-bold [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
