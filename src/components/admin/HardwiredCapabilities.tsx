import { Cpu } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const CAPABILITIES = [
  "Web Crawl & Live URL Fetch",
  "Run Code (Python / JS sandbox)",
  "Image Annotation & OCR",
  "Execute Tools & Function Calls",
  "Long-Term Memory Recall",
  "Vector Semantic Search",
  "Supabase Read / Write Bridge",
  "File Upload Ingestion (PDF, DOCX, CSV)",
  "Audio Transcription",
  "Speech Synthesis (TTS)",
  "Realtime Streaming Responses",
  "Multi-Turn Context Window",
  "Vision (image understanding)",
  "Markdown & Rich Rendering",
  "Clipboard / Snippet Injection",
  "Domain Whitelist Enforcement",
  "Rate Limit & Quota Guard",
  "OG Coin Metering",
  "Embed Snippet Auto-Refresh",
  "Webhook Dispatch",
  "Persona Override Engine",
  "Foul-Mouth Filter Toggle",
  "Background Music Hub Sync",
  "VIP Privilege Detection",
  "Boss-Only Override Mode",
  "Encrypted Token Rotation",
];

export function HardwiredCapabilities() {
  return (
    <div className="mb-6 rounded-2xl border border-border bg-card/70 shadow-card">
      <Accordion type="single" collapsible>
        <AccordionItem value="caps" className="border-none">
          <AccordionTrigger className="px-5 py-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <span className="font-semibold">System Engine Log (Hard-Wired Capabilities)</span>
              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400 ring-1 ring-emerald-500/30">
                {CAPABILITIES.length} ON
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <p className="mb-3 text-xs text-muted-foreground">
              Read-only. These capabilities are permanently hard-wired into the OG Bot runtime and
              cannot be toggled from this surface.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((cap) => (
                <li
                  key={cap}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm"
                >
                  <span
                    className="relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_oklch(0.74_0.16_160_/_0.7)]"
                    aria-hidden
                  >
                    <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/60" />
                  </span>
                  <span className="flex-1 truncate">{cap}</span>
                  <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    ON
                  </span>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
