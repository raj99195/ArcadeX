// src/components/Seo.jsx
//
// React 19 native document metadata — NO react-helmet needed. Any <title>,
// <meta>, or <link> rendered by a component is automatically hoisted into
// <head> and de-duplicated by React 19. Render <Seo/> anywhere in a page.
//
// Canonical URLs always use the www host, which (together with the Vercel
// www→ 301 redirect) fixes the www / non-www split that was diluting rankings.

const SITE = "https://www.playarcadex.in";
const DEFAULT_IMG = `${SITE}/og-image.png`; // add a 1200x630 image at public/og-image.png

export default function Seo({
  title,
  description,
  path = "/",
  image,
  type = "website",
  jsonLd = null,
}) {
  const url = SITE + (path.startsWith("/") ? path : `/${path}`);
  const fullTitle = title
    ? `${title} | ArcadeX`
    : "ArcadeX — Play Web3 Games & Earn On-Chain";
  const desc = (description || "Play free on-chain arcade games on ArcadeX. Compete on verified leaderboards and earn token rewards — no download, instantly playable on mobile and desktop.").slice(0, 160);
  const img = image || DEFAULT_IMG;

  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content="ArcadeX" />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={img} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={img} />

      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}