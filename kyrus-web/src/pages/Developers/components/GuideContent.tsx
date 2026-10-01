// kyrus-web/src/pages/Developers/components/GuideContent.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GuideItem } from '../types';

interface GuideContentProps {
  guide: GuideItem;
}

export const GuideContent: React.FC<GuideContentProps> = ({ guide }) => {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-black prose-h1:text-2xl sm:prose-h1:text-3xl prose-h2:text-xl prose-h3:text-base prose-code:font-mono prose-code:text-xs prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:border prose-pre:border-slate-800 prose-table:text-xs">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th className="bg-slate-100 dark:bg-slate-900 px-3.5 py-2.5 font-bold uppercase text-[11px] text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800" {...props} />
          ),
          td: ({ node, ...props }) => (
            <td className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-800/60" {...props} />
          ),
          code: ({ node, className, children, ...props }: any) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-blue-600 dark:text-blue-400 font-semibold"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {guide.content}
      </ReactMarkdown>
    </article>
  );
};
