// SEO: per-page head tags, JSON-LD, sitemap, robots, canonical redirects and the old Blogger URL redirects.
import fs from 'node:fs';
import path from 'node:path';
import { all, one, getSetting } from './db.js';
import { TRIPS } from './trips-content.js';
import { AREAS } from './areas-content.js';
import { applyTexts, applyLanding, seoText, setSeoDefaults } from './content.js';

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

export const baseUrl = (req) => (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const biz = () => getSetting('business_name') || 'Get A Bus NY';

const PAGES = {
  '/': { file: 'index.html', title: () => `${biz()} | Charter Bus Rentals for Camp Trips, Shabbatons and Simchas`, desc: 'Charter buses, party buses and trolleys for camp trips, Shabbatons, Kehila trips, Kivrei Tzadikim, yeshiva and school trips, and weddings. Request a quote online. In business since 2016.' },
  '/fleet': { file: 'fleet.html', title: () => `Our Fleet: Coach Buses, Party Buses and Trolleys | ${biz()}`, desc: 'See the full fleet with seat counts and amenities: 56 seater coach bus, party buses, trolleys and a limo. Request a quote for any vehicle.' },
  '/about': { file: 'about.html', title: () => `About ${biz()} | Bus Charter Since 2016`, desc: `${biz()} is a charter bus broker serving the Jewish community since 2016. Learn how we work and what to expect.` },
  '/contact': { file: 'contact.html', title: () => `Contact and Hours of Operation | ${biz()}`, desc: 'Call, email or send a message. Office hours Sunday to Thursday 10:00 AM to 7:00 PM, Friday 10:00 AM to 12:30 PM, closed Saturday.' },
  '/book': { file: 'book.html', title: () => `Request a Quote | ${biz()}`, desc: 'Tell us your dates, times, pickups and stops. We reply with a price for your bus charter.' },
  '/terms': { file: 'terms.html', title: () => `Terms and Conditions | ${biz()}`, desc: 'Booking, payment, cancellation and rider terms for charter bus service.' },
  '/privacy': { file: 'privacy.html', title: () => `Privacy Policy | ${biz()}`, desc: 'How we handle your contact details, payments and text message preferences.' },
};

const NOINDEX = ['/bus.html', '/trip.html', '/admin', '/driver', '/d/', '/quote/', '/pay/', '/contract/', '/cal/', '/banner/', '/api/', '/uploads/', '/r/'];

function orgSchema(base) {
  const days = [['Sunday', 'Thursday', '10:00', '19:00'], ['Friday', 'Friday', '10:00', '12:30']];
  const dayList = (a, b) => { const w = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; return w.slice(w.indexOf(a), w.indexOf(b) + 1); };
  let soc = {}; try { soc = JSON.parse(getSetting('socials') || '{}'); } catch { /* ignore */ }
  const socials = Object.values(soc).filter((u) => /^https?:\/\//.test(u || ''));
  const phone = getSetting('phone'), email = getSetting('email');
  const o = {
    '@context': 'https://schema.org', '@type': 'TravelAgency', '@id': `${base}/#business`, name: biz(), url: base + '/', logo: `${base}/img/logo.png`, image: `${base}/img/logo.png`,
    description: 'Charter bus, party bus and trolley rentals for camp trips, Shabbatons, Kehila trips, Kivrei Tzadikim, yeshiva and school trips, and simchas.',
    foundingDate: '2016', areaServed: AREAS.map((a) => ({ '@type': 'Place', name: a.name.replace(/^the /, '') })),
    openingHoursSpecification: days.map(([a, b, o1, c1]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayList(a, b), opens: o1, closes: c1 })),
  };
  if (phone) o.telephone = phone;
  if (email) o.email = email;
  if (socials.length) o.sameAs = socials;
  return o;
}

function vehicleList(base) {
  return all('SELECT id,name,category,capacity,description FROM vehicles WHERE active=1 ORDER BY sort,id');
}

/** Head tags for one page. */
function headFor(req, route, meta, extra = '') {
  const base = baseUrl(req);
  const url = base + (route === '/' ? '/' : route);
  const ogImg = `${base}/img/logo.png`;
  return `<link rel="canonical" href="${esc(url)}"><meta name="description" content="${esc(meta.desc)}">`
    + `<meta property="og:site_name" content="${esc(biz())}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(ogImg)}">`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(meta.title)}"><meta name="twitter:description" content="${esc(meta.desc)}"><meta name="twitter:image" content="${esc(ogImg)}">`
    + `<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/png" sizes="192x192" href="/img/icon-192.png"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#14110f">`
    + extra;
}

/** Take page HTML and replace/insert the SEO head tags. */
export function inject(html, headTags, title) {
  html = html.replace(/<title>[^<]*<\/title>/i, '').replace(/<meta\s+name=["']description["'][^>]*>/gi, '').replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '').replace(/<!--OG-->/g, '');
  if (headTags.includes('rel="icon"')) html = html.replace(/<link\s+rel="(?:icon|apple-touch-icon)"[^>]*>/gi, '');
  return html.replace(/<\/head>/i, `<title>${esc(title)}</title>${headTags}</head>`);
}

const crumb = (base, items) => jsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: base + p })) });

export function mountSeo(app, PUB) {
  setSeoDefaults(Object.fromEntries(Object.entries(PAGES).flatMap(([r, m]) => { const k = r === '/' ? 'home' : r.slice(1); return [[`${k}.title`, m.title()], [`${k}.desc`, m.desc]]; })));
  const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

  // 1. Canonical host and https (production only, where BASE_URL is set)
  app.use((req, res, next) => {
    const b = process.env.BASE_URL; if (!b || req.path === '/healthz') return next();
    let want; try { want = new URL(b); } catch { return next(); }
    const host = (req.get('host') || '').toLowerCase();
    const proto = req.protocol;
    if ((host !== want.host && host === 'www.' + want.host) || (want.protocol === 'https:' && proto !== 'https' && !/^(localhost|127\.)/.test(host))) return res.redirect(301, want.origin + req.originalUrl);
    next();
  });

  // 2. Old Blogger URLs. Every one keeps its ranking by pointing at the closest new page.
  const LEGACY = [
    [/^\/p\/request-quote(\.html)?$/i, '/book'], [/^\/p\/to-get-bus-ny(\.html)?$/i, '/contact'], [/^\/2022\/03\/blog-post(\.html)?$/i, '/fleet'],
    [/^\/p\/make-a-payment.*$/i, '/pay'], [/^\/p\/(about|about-us)(\.html)?$/i, '/about'], [/^\/p\/(contact|contact-us)(\.html)?$/i, '/contact'],
    [/^\/(feeds\/.*|atom\.xml|rss\.xml|search.*)$/i, '/'], [/^\/\d{4}\/\d{2}(\/.*)?$/, '/fleet'], [/^\/p\/.+$/i, '/'],
  ];
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    for (const [re, to] of LEGACY) if (re.test(req.path)) return res.redirect(301, to);
    const clean = req.path.match(/^\/(index|fleet|about|contact|book|terms|privacy)\.html$/);
    if (clean) return res.redirect(301, clean[1] === 'index' ? '/' : '/' + clean[1]);
    next();
  });

  // 3. robots, sitemap, manifest
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\n${['/admin', '/api/', '/d/', '/driver', '/quote/', '/pay/', '/contract/', '/cal/', '/banner/', '/uploads/', '/r/'].map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (req, res) => {
    const b = baseUrl(req), day = new Date().toISOString().slice(0, 10);
    const urls = [['/', 1.0], ['/fleet', 0.9], ['/book', 0.9], ...TRIPS.map((t) => ['/trips/' + t.slug, 0.8]), ...AREAS.map((a) => ['/areas/' + a.slug, 0.7]), ['/about', 0.6], ['/contact', 0.7], ...vehicleList().map((v) => ['/bus/' + v.id, 0.7]), ['/terms', 0.3], ['/privacy', 0.3]];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([p, pr]) => `<url><loc>${esc(b + (p === '/' ? '/' : p))}</loc><lastmod>${day}</lastmod><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);
  });
  app.get('/site.webmanifest', (req, res) => {
    res.type('application/manifest+json').send(JSON.stringify({ name: biz(), short_name: biz(), start_url: '/', display: 'browser', background_color: '#14110f', theme_color: '#14110f', icons: [{ src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
  });

  // 4. Noindex on private and transactional pages
  app.use((req, res, next) => { if (NOINDEX.some((p) => req.path === p.replace(/\/$/, '') || req.path.startsWith(p))) res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

  // 5. Public pages with injected head tags
  for (const [route, meta] of Object.entries(PAGES)) {
    app.get(route, (req, res, next) => {
      let html; try { html = applyTexts(read(meta.file)); } catch { return next(); }
      const pk = route === '/' ? 'home' : route.slice(1);
      const base = baseUrl(req), title = seoText(pk, 'title', meta.title()), pdesc = seoText(pk, 'desc', meta.desc);
      let extra = '';
      if (route === '/') {
        const list = vehicleList(base);
        extra += jsonLd(orgSchema(base)) + jsonLd({ '@context': 'https://schema.org', '@type': 'WebSite', url: base + '/', name: biz() });
      } else if (route === '/fleet') {
        const list = vehicleList(base);
        extra += crumb(base, [['Home', '/'], ['Fleet', '/fleet']]) + jsonLd({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Fleet', itemListElement: list.map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/bus/${v.id}`, name: v.name })) });
      } else if (route === '/contact') {
        extra += crumb(base, [['Home', '/'], ['Contact', '/contact']]) + jsonLd(orgSchema(base));
      } else if (route === '/about' || route === '/book') {
        extra += crumb(base, [['Home', '/'], [route === '/about' ? 'About' : 'Request a quote', route]]);
      }
      if (route === '/terms' || route === '/privacy') res.setHeader('X-Robots-Tag', 'index, follow');
      res.type('html').send(inject(html, headFor(req, route, { title, desc: pdesc }, extra), title));
    });
  }

  // 6. Trip-type landing pages (content in trips-content.js, shell in public/trip.html)
  app.get('/trips', (req, res) => res.redirect(301, '/#trips'));
  app.get('/areas', (req, res) => res.redirect(301, '/#areas'));
  const landing = (kind, list, otherLabel) => (req, res, next) => {
    const t0 = list.find((x) => x.slug === req.params.slug); if (!t0) return next();
    const t = applyLanding(kind, t0);
    let html; try { html = read('trip.html'); } catch { return next(); }
    const base = baseUrl(req), route = `/${kind}/` + t.slug, title = `${t.title} | ${biz()}`;
    const others = list.filter((x) => x.slug !== t.slug);
    const body = `<h1>${esc(t.h1)}</h1><p class="lead">${esc(t.lead)}</p>${t.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('')}`
      + `<h2>Common questions</h2>${t.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}`
      + `<p><a class="btn btn-lime" href="/book">Request a quote</a> <a class="btn" href="/fleet">See the fleet</a></p>`
      + `<h2>${otherLabel}</h2><ul>${others.map((x) => `<li><a href="/${kind}/${x.slug}">${esc(x.name)}</a></li>`).join('')}</ul>`;
    const extra = crumb(base, [['Home', '/'], [t.name, route]])
      + jsonLd({ '@context': 'https://schema.org', '@type': 'Service', name: t.h1, serviceType: 'Charter bus rental', provider: { '@id': `${base}/#business` }, areaServed: kind === 'areas' ? { '@type': 'Place', name: t.name.replace(/^the /, '') } : AREAS.map((a) => ({ '@type': 'Place', name: a.name.replace(/^the /, '') })), description: t.desc })
      + jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: t.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
    html = html.replace('<!--TRIP-->', body);
    res.type('html').send(inject(html, headFor(req, route, { title, desc: t.desc }, extra), title));
  };
  app.get('/trips/:slug', landing('trips', TRIPS, 'Other trips we run'));
  app.get('/areas/:slug', landing('areas', AREAS, 'Other places we cover'));

  // 7. Vehicle pages
  app.get('/bus/:id', (req, res) => {
    const v = one('SELECT id,name,category,capacity,description,features,image,images FROM vehicles WHERE id=? AND active=1', req.params.id);
    let html; try { html = read('bus.html'); } catch { return res.status(404).sendFile(path.join(PUB, '404.html')); }
    const base = baseUrl(req);
    if (!v) return res.status(404).type('html').send(inject(html, '<meta name="robots" content="noindex">', `Vehicle not found | ${biz()}`));
    let feats = []; try { feats = JSON.parse(v.features || '[]'); } catch { feats = String(v.features || '').split(','); }
    const title = `${v.name}, Seats ${v.capacity} | ${biz()}`;
    const desc = `${v.name}: ${v.category.toLowerCase()} seating ${v.capacity}. ${v.description || ''} Request a quote from ${biz()}.`.replace(/\s+/g, ' ').trim().slice(0, 300);
    const img = v.image ? (v.image.startsWith('http') ? v.image : base + v.image) : `${base}/img/logo.png`;
    const route = '/bus/' + v.id;
    const extra = crumb(base, [['Home', '/'], ['Fleet', '/fleet'], [v.name, route]])
      + jsonLd({ '@context': 'https://schema.org', '@type': 'Product', name: v.name, category: v.category, description: v.description, image: (() => { let a = []; try { a = JSON.parse(v.images || '[]'); } catch { /* none */ } const abs = (u) => (String(u).startsWith('http') ? u : base + u); return a.length ? a.map(abs) : img; })(), brand: { '@type': 'Brand', name: biz() }, additionalProperty: [{ '@type': 'PropertyValue', name: 'Seats', value: v.capacity }, ...feats.slice(0, 20).map((f) => ({ '@type': 'PropertyValue', name: 'Amenity', value: String(f) }))] });
    const tags = headFor(req, route, { title, desc }, extra).replace(/(<meta property="og:image" content=")[^"]*/, `$1${esc(img)}`).replace(/(<meta name="twitter:image" content=")[^"]*/, `$1${esc(img)}`);
    res.type('html').send(inject(html, tags, title));
  });
}
