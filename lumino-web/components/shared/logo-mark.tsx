export function LogoMark({
  appName = "Lumino",
  logoUrl = null,
  logoScale = 1,
  primaryColor = "#0b1220"
}: {
  appName?: string;
  logoUrl?: string | null;
  logoScale?: number | null;
  primaryColor?: string;
}) {
  const initials = appName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-white/60 bg-white/80 text-sm font-semibold text-ink shadow-panel"
      style={{ color: primaryColor }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${appName} logo`}
          className="h-full w-full object-contain"
          style={{ transform: `scale(${logoScale ?? 1})` }}
        />
      ) : (
        initials || "LU"
      )}
    </div>
  );
}
