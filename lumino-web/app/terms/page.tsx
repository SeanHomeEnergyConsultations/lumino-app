import {
  CLICKWRAP_EFFECTIVE_DATE,
  CLICKWRAP_INTRO,
  CLICKWRAP_SECTIONS,
  CLICKWRAP_TITLE,
  CURRENT_AGREEMENT_VERSION
} from "@/lib/legal/clickwrap";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7f3ea_0%,#edf2f8_100%)] px-6 py-12">
      <div className="mx-auto max-w-3xl rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-panel backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mist">Terms</div>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{CLICKWRAP_TITLE}</h1>
        <p className="mt-3 text-sm text-slate-600">
          Effective Date: {CLICKWRAP_EFFECTIVE_DATE}. Version {CURRENT_AGREEMENT_VERSION}.
        </p>
        <p className="mt-4 text-sm leading-7 text-slate-600">{CLICKWRAP_INTRO}</p>

        <div className="mt-8 space-y-6">
          {CLICKWRAP_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold text-ink">{section.heading}</h2>
              <div className="mt-2 space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-slate-600">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
