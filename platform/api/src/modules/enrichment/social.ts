import type { SocialNetwork } from "../../lib/prisma.ts";

/** Caminhos que não identificam um perfil (compartilhamento, login, páginas genéricas). */
const SKIP = new Set([
  "", "home", "pages", "people", "help", "about", "policies", "policy", "legal", "tos", "privacy", "settings", "sharer",
  "sharer.php", "share", "share.php", "tr", "profile.php", "plugins", "dialog", "intent", "login", "signup", "permalink.php",
  "explore", "accounts", "reel", "reels", "p", "stories", "watch", "embed", "hashtag", "search", "groups", "events",
  "marketplace", "gaming", "watch?v", "results", "feed", "jobs", "learning", "pin", "home.php", "story.php", "photo.php",
  "photo", "photos", "video", "videos", "status", "i", "web", "send", "wa", "channel", "c", "user", "school", "showcase",
]);

type Rule = { network: SocialNetwork; host: RegExp; extract: (u: URL) => string | null; canonical: (h: string) => string };

const firstSeg = (u: URL) => decodeURIComponent(u.pathname.split("/").filter(Boolean)[0] ?? "");

const RULES: Rule[] = [
  {
    network: "INSTAGRAM",
    host: /(^|\.)instagram\.com$/,
    extract: (u) => firstSeg(u),
    canonical: (h) => `https://www.instagram.com/${h}/`,
  },
  {
    network: "FACEBOOK",
    host: /(^|\.)(facebook|fb)\.com$/,
    extract: (u) => {
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0] === "pages" && segs.length >= 3) return segs[segs.length - 1] ?? null; // /pages/Nome/123
      if (segs[0] === "profile.php") return u.searchParams.get("id") ? `profile.php?id=${u.searchParams.get("id")}` : null;
      return segs[0] ?? null;
    },
    canonical: (h) => `https://www.facebook.com/${h}`,
  },
  {
    network: "LINKEDIN",
    host: /(^|\.)linkedin\.com$/,
    extract: (u) => {
      const segs = u.pathname.split("/").filter(Boolean);
      if (["company", "school", "showcase", "in"].includes(segs[0] ?? "") && segs[1]) return `${segs[0]}/${decodeURIComponent(segs[1])}`;
      return null;
    },
    canonical: (h) => `https://www.linkedin.com/${h}/`,
  },
  {
    network: "TIKTOK",
    host: /(^|\.)tiktok\.com$/,
    extract: (u) => {
      const s = firstSeg(u);
      return s.startsWith("@") ? s : null;
    },
    canonical: (h) => `https://www.tiktok.com/${h}`,
  },
  {
    network: "YOUTUBE",
    host: /(^|\.)(youtube\.com)$/,
    extract: (u) => {
      const segs = u.pathname.split("/").filter(Boolean);
      if (segs[0]?.startsWith("@")) return segs[0];
      if (["channel", "c", "user"].includes(segs[0] ?? "") && segs[1]) return `${segs[0]}/${segs[1]}`;
      return null;
    },
    canonical: (h) => `https://www.youtube.com/${h}`,
  },
  {
    network: "PINTEREST",
    host: /(^|\.)pinterest\.(com|com\.br|pt)$/,
    extract: (u) => firstSeg(u),
    canonical: (h) => `https://www.pinterest.com/${h}/`,
  },
  {
    network: "X",
    host: /(^|\.)(twitter\.com|x\.com)$/,
    extract: (u) => firstSeg(u),
    canonical: (h) => `https://x.com/${h}`,
  },
  {
    network: "THREADS",
    host: /(^|\.)threads\.(net|com)$/,
    extract: (u) => {
      const s = firstSeg(u);
      return s.startsWith("@") ? s : null;
    },
    canonical: (h) => `https://www.threads.net/${h}`,
  },
  {
    network: "WHATSAPP",
    host: /(^|\.)(wa\.me|whatsapp\.com|api\.whatsapp\.com)$/,
    extract: (u) => {
      if (u.hostname.endsWith("wa.me")) {
        const s = firstSeg(u).replace(/\D/g, "");
        return s.length >= 10 ? s : null;
      }
      const phone = (u.searchParams.get("phone") ?? "").replace(/\D/g, "");
      return phone.length >= 10 ? phone : null;
    },
    canonical: (h) => `https://wa.me/${h}`,
  },
];

export type ParsedSocial = { network: SocialNetwork; handle: string; url: string };

/** Interpreta uma URL de rede social e devolve rede, identificador e URL canônica. */
export function parseSocialUrl(raw: string, hint?: SocialNetwork): ParsedSocial | null {
  let value = raw.trim();
  if (!value) return null;
  // etiquetas do OSM às vezes trazem só o usuário (@perfil)
  if (!/^https?:\/\//i.test(value) && hint) {
    const handle = value.replace(/^@/, "");
    const rule = RULES.find((r) => r.network === hint);
    if (!rule || !/^[A-Za-z0-9_.-]{2,60}$/.test(handle)) return null;
    const h = hint === "TIKTOK" || hint === "THREADS" ? `@${handle}` : handle;
    return { network: hint, handle: h.toLowerCase(), url: rule.canonical(h) };
  }
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|web\.|br\.|pt-br\.)/, "");
  const rule = RULES.find((r) => r.host.test(host));
  if (!rule) return null;
  const handle = rule.extract(u);
  if (!handle) return null;
  const clean = handle.replace(/\/+$/, "");
  if (SKIP.has(clean.toLowerCase()) || clean.length < 2 || clean.length > 100) return null;
  return { network: rule.network, handle: clean.toLowerCase(), url: rule.canonical(clean) };
}
