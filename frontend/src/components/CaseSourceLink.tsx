import { ExternalLink } from "lucide-react";

// Mock placeholders and non-web schemes are provenance, not navigable sources.
export function CaseSourceLink({ url, label = "查看原文" }: { url: string; label?: string }) {
  let href: string | undefined;
  try {
    const parsed = new URL(url);
    if (["https:", "http:"].includes(parsed.protocol) && !/(^|\.)(example\.(com|org|net)|test|invalid|localhost)$/.test(parsed.hostname)) href = parsed.href;
  } catch { /* Retain an explicit unavailable state for missing source URLs. */ }
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-stone-700 underline underline-offset-4 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400">{label}<ExternalLink className="size-3.5" /><span className="sr-only">（另開分頁）</span></a> : <span className="text-xs text-stone-600">未提供可開啟的原文連結</span>;
}
