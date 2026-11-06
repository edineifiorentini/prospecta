/**
 * Tecnologias detectáveis no HTML público (assinaturas de scripts, metatags e classes). Detecção é evidência de
 * presença; não detectar NÃO prova ausência (scripts carregados depois, por consentimento ou em outras páginas).
 */
export type TechCategory = "cms" | "ecommerce" | "framework" | "analytics" | "pixel" | "chat" | "marketing" | "conversao";
export type Technology = { name: string; category: TechCategory; evidence: string };

const SIGNATURES: { name: string; category: TechCategory; re: RegExp }[] = [
  { name: "WordPress", category: "cms", re: /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+wordpress/i },
  { name: "Elementor", category: "cms", re: /elementor-(kit|widget|section)|\/elementor\//i },
  { name: "Wix", category: "cms", re: /static\.wixstatic\.com|<meta[^>]+generator[^>]+wix\.com/i },
  { name: "Squarespace", category: "cms", re: /static1\.squarespace\.com|<meta[^>]+generator[^>]+squarespace/i },
  { name: "Joomla", category: "cms", re: /<meta[^>]+generator[^>]+joomla|\/media\/jui\//i },
  { name: "Drupal", category: "cms", re: /<meta[^>]+generator[^>]+drupal|drupal-settings-json/i },
  { name: "Webflow", category: "cms", re: /data-wf-page=|assets\.website-files\.com|<meta[^>]+generator[^>]+webflow/i },
  { name: "Google Sites", category: "cms", re: /<meta[^>]+generator[^>]+google sites|sites\.google\.com\/view/i },
  { name: "Shopify", category: "ecommerce", re: /cdn\.shopify\.com|shopify\.theme/i },
  { name: "WooCommerce", category: "ecommerce", re: /woocommerce/i },
  { name: "Nuvemshop", category: "ecommerce", re: /nuvemshop|tiendanube/i },
  { name: "Loja Integrada", category: "ecommerce", re: /lojaintegrada/i },
  { name: "Tray", category: "ecommerce", re: /tray\.com\.br|traycdn/i },
  { name: "VTEX", category: "ecommerce", re: /vtexassets\.com|vteximg\.com\.br|vtex\.com\.br/i },
  { name: "Magento", category: "ecommerce", re: /mage\/cookies|magento_|\/static\/version\d+\/frontend\//i },
  { name: "Next.js", category: "framework", re: /\/_next\/static\/|id="__next"/i },
  { name: "Nuxt", category: "framework", re: /\/_nuxt\/|id="__nuxt"/i },
  { name: "Angular", category: "framework", re: /ng-version="/i },
  { name: "React", category: "framework", re: /data-reactroot|react(-dom)?(\.production)?(\.min)?\.js/i },
  { name: "Vue.js", category: "framework", re: /data-v-[0-9a-f]{6,}|vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/i },
  { name: "jQuery", category: "framework", re: /jquery(-\d[\d.]*)?(\.min)?\.js/i },
  { name: "Bootstrap", category: "framework", re: /bootstrap(\.bundle)?(\.min)?\.(css|js)/i },
  { name: "Google Analytics 4", category: "analytics", re: /googletagmanager\.com\/gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i },
  { name: "Google Tag Manager", category: "analytics", re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/ },
  { name: "Google Analytics (Universal)", category: "analytics", re: /google-analytics\.com\/analytics\.js|['"]UA-\d{4,}-\d+['"]/i },
  { name: "Hotjar", category: "analytics", re: /static\.hotjar\.com/i },
  { name: "Microsoft Clarity", category: "analytics", re: /clarity\.ms\/tag/i },
  { name: "Meta Pixel", category: "pixel", re: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i },
  { name: "TikTok Pixel", category: "pixel", re: /analytics\.tiktok\.com/i },
  { name: "LinkedIn Insight", category: "pixel", re: /snap\.licdn\.com/i },
  { name: "Google Ads", category: "pixel", re: /googleadservices\.com\/pagead\/conversion|['"]AW-\d{6,}['"]/i },
  { name: "Pinterest Tag", category: "pixel", re: /s\.pinimg\.com\/ct\/core\.js|pintrk\(/i },
  { name: "Tawk.to", category: "chat", re: /embed\.tawk\.to/i },
  { name: "JivoChat", category: "chat", re: /code\.jivosite\.com|code\.jivo\.chat/i },
  { name: "Zendesk", category: "chat", re: /static\.zdassets\.com|v2\.zopim\.com/i },
  { name: "Intercom", category: "chat", re: /widget\.intercom\.io|intercomSettings/i },
  { name: "Crisp", category: "chat", re: /client\.crisp\.chat/i },
  { name: "Drift", category: "chat", re: /js\.driftt\.com/i },
  { name: "Octadesk", category: "chat", re: /octadesk/i },
  { name: "Botão flutuante de WhatsApp", category: "chat", re: /(joinchat|whatsapp-button|wa-float|float-whatsapp|whatsapp-float|btn-whatsapp)/i },
  { name: "HubSpot", category: "marketing", re: /js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics/i },
  { name: "RD Station", category: "marketing", re: /rdstation|d335luupugsy2\.cloudfront\.net/i },
  { name: "Mailchimp", category: "marketing", re: /chimpstatic\.com|list-manage\.com/i },
  { name: "Calendly", category: "conversao", re: /calendly\.com\/[a-z0-9]/i },
  { name: "Typeform", category: "conversao", re: /embed\.typeform\.com|form\.typeform\.com/i },
  { name: "Doctoralia", category: "conversao", re: /doctoralia\.com\.br/i },
  { name: "Google reCAPTCHA", category: "conversao", re: /google\.com\/recaptcha|grecaptcha/i },
];

export function detectTechnologies(html: string): Technology[] {
  const out: Technology[] = [];
  for (const s of SIGNATURES) {
    const m = html.match(s.re);
    if (m) out.push({ name: s.name, category: s.category, evidence: m[0].slice(0, 60) });
  }
  return out;
}

export const TECH_CATEGORY_LABEL: Record<TechCategory, string> = {
  cms: "Plataforma do site (CMS)",
  ecommerce: "Loja virtual",
  framework: "Frameworks e bibliotecas",
  analytics: "Análise de audiência",
  pixel: "Pixels de anúncios",
  chat: "Atendimento no site",
  marketing: "Automação de marketing",
  conversao: "Recursos de conversão",
};
