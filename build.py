import json, html, pathlib, re, unicodedata, urllib.parse
from data import CATS, RAW
root=pathlib.Path(__file__).parent
cats={x[0]:{'id':x[0],'fr':x[1],'ar':x[2],'icon':x[3]} for x in CATS}
services=[]
for slug,category,fr,ar,desc,desc_ar,tags,tech,includes,problems in RAW:
    services.append(dict(slug=slug,category=category,fr=fr,ar=ar,desc=desc,desc_ar=desc_ar,terms=tags,technologies=[x.strip() for x in tech.split(',')],includes=[x.strip() for x in includes.split(';')],problems=[x.strip() for x in problems.split(';')],status='Sur étude'))
(root/'assets'/'services.json').write_text(json.dumps({'categories':list(cats.values()),'services':services},ensure_ascii=False,indent=2),encoding='utf8')
(root/'assets'/'data.js').write_text('window.ALLO_DATA = '+json.dumps({'categories':list(cats.values()),'services':services},ensure_ascii=False)+';',encoding='utf8')
(root/'assets'/'config.js').write_text('''// Add verified business contact details before publishing. Do not store secrets here.
window.ALLO_CONFIG = {
  brand: "ALLOSERVIX",
  location: "Casablanca, Maroc",
  whatsappNumber: "", // international format, digits only, no + (e.g. 2126...)
  businessEmail: "",
  website: "https://alloservix.ma",
  contactReady: false
};
''', encoding='utf8')

def e(s):return html.escape(str(s),quote=True)
def nav(prefix='',active=''):
    return f'''<header class="site-header"><div class="container nav-inner"><a class="brand" href="{prefix}index.html" aria-label="ALLOSERVIX accueil"><span class="brand-mark">A<span class="accent">.</span></span><span><b>ALLOSERVIX</b><small>IT · CLOUD · SOFTWARE</small></span></a><nav class="nav-links" aria-label="Navigation principale"><a href="{prefix}index.html#expertises">Expertises</a><a href="{prefix}index.html#services">Prestations</a><a href="{prefix}index.html#method">Notre approche</a><a href="{prefix}index.html#contact">Contact</a></nav><div class="nav-right"><button class="lang-switch" id="lang-toggle" type="button" aria-label="Changer de langue">العربية</button><a class="nav-cta" href="{prefix}index.html#contact">Demander un devis <span aria-hidden="true">↗</span></a></div></div></header>'''
def footer(prefix=''):
    return f'''<footer class="footer"><div class="container footer-inner"><div><span class="footer-brand">ALLOSERVIX<span class="accent">.</span></span><p>Des solutions technologiques adaptées à vos besoins.</p><small>Catalogue indicatif · Prestations soumises à validation du périmètre et de la disponibilité de notre équipe.</small></div><div><a href="{prefix}index.html#services">Catalogue des prestations</a><a href="{prefix}index.html#contact">Demander un devis</a><a href="{prefix}mentions.html">Mentions & confidentialité</a></div></div><div class="container footer-bottom">© 2026 ALLOSERVIX — Projet de collectif professionnel, statut juridique à confirmer. <span>Casablanca · Maroc</span></div></footer>'''
def head(title,description,base='',noindex=True):
    return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="{e(description)}"><meta name="theme-color" content="#0b1930"><meta name="robots" content="{'noindex,nofollow' if noindex else 'index,follow'}"><link rel="icon" href="{base}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="{base}assets/style.css"><title>{e(title)} | ALLOSERVIX</title></head><body>'''

def category_badges():
    return ''.join(f'<button class="filter-chip" type="button" data-category="{e(c["id"])}"><span aria-hidden="true">◌</span> {e(c["fr"])}</button>' for c in cats.values())

def card(s):
    return f'''<a class="service-card" href="services/{e(s['slug'])}.html" data-category="{e(s['category'])}" data-search="{e(' '.join([s['fr'],s['ar'],s['desc'],s['desc_ar'],s['terms'],cats[s['category']]['fr'],cats[s['category']]['ar']]))}"><span class="service-category">{e(cats[s['category']]['fr'])}</span><h3>{e(s['fr'])}</h3><p>{e(s['desc'])}</p><span class="service-link">Voir la prestation <span aria-hidden="true">↗</span></span></a>'''

assistant_section='<section class="section" id="assistant"><div class="container"><div class="assistant-layout"><div><span class="kicker">ASSISTANT DES PRESTATIONS</span><h2>Décrivez votre problème.<br><span>Trouvez une piste de solution.</span></h2><p class="section-lead">Notre assistant consulte uniquement notre catalogue validé. Il ne remplace pas un diagnostic et ne promet aucune prestation avant confirmation.</p><p class="assistant-note">Ne partagez pas de mots de passe, documents personnels ou informations confidentielles.</p></div><form class="assistant-form" id="assistant-form"><label for="assistant-question">Quel est votre besoin ?</label><textarea id="assistant-question" rows="4" maxlength="500" placeholder="Ex. Mon scanner n\'envoie plus les fichiers vers le PC... / أحتاج برنامج للمخزون" required></textarea><button type="submit" class="primary-button">Analyser ma demande ↗</button><div id="assistant-response" class="assistant-result" role="status" aria-live="polite"></div></form></div></div></section>'
index=head('Solutions IT, Cloud & logiciels sur mesure','Catalogue de prestations informatiques à Casablanca : réseaux, cloud, logiciels, maintenance et sécurité.')+nav()+f'''
<main>
<section class="hero"><div class="container hero-grid"><div class="hero-content"><div class="eyebrow"><span class="pulse"></span> PRESTATIONS IT & TRANSFORMATION DIGITALE · CASABLANCA</div><h1>Vos défis techniques.<br><span>Nos solutions.</span></h1><p class="hero-desc">Informatique, réseaux, Cloud, cybersécurité, logiciels métier et solutions techniques. Explorez notre catalogue et trouvez le service adapté à votre activité.</p><div class="hero-actions"><a class="primary-button" href="#services">Explorer les prestations <span aria-hidden="true">↗</span></a><a class="secondary-button" href="#contact">Décrire mon besoin</a></div><div class="hero-trust"><span>◈ Expertise multidisciplinaire</span><span>◈ Approche sur mesure</span><span>◈ Étude avant intervention</span></div></div><div class="hero-graphic"><div class="graphic-grid"></div><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="hero-terminal"><div class="term-header"><span class="term-lights"><i></i><i></i><i></i></span> ALLOSERVIX / SOLUTIONS</div><div class="terminal-lines"><div><span class="terminal-arrow">›</span> Analyse de votre besoin</div><div><span class="terminal-check">✓</span> Identification des solutions</div><div><span class="terminal-check">✓</span> Plan d'action adapté</div><div><span class="terminal-cursor">_</span></div></div></div><div class="floating-tag tag-top">RÉSEAUX <span>●</span> CLOUD</div><div class="floating-tag tag-bottom">LOGICIELS <span>●</span> SÉCURITÉ</div></div></div></section>
<section class="stats-strip"><div class="container stats-content"><span><strong>{len(services)}</strong> pistes de prestations à explorer</span><span><strong>{len(cats)}</strong> domaines d'expertise</span><span><strong>FR · AR</strong> Recherche multilingue</span></div></section>
<section id="expertises" class="section expertise-section"><div class="container"><span class="kicker">UN ÉCOSYSTÈME COMPLET</span><h2>Toutes vos problématiques,<br><span>un point de contact.</span></h2><p class="section-lead">Un collectif de profils complémentaires pour étudier des besoins simples ou des projets plus complexes.</p><div class="expertise-grid">{''.join(f'<a href="#services" class="expertise-card" data-go-category="{e(c["id"])}"><span class="expertise-number">{i:02d}</span><div><h3>{e(c["fr"])}</h3><p class="arabic-hint" lang="ar" dir="rtl">{e(c["ar"])}</p></div><span aria-hidden="true">↗</span></a>' for i,c in enumerate(cats.values(),1))}</div></div></section>
<section id="services" class="section catalog-section"><div class="container"><span class="kicker">CATALOGUE DE SERVICES</span><div class="section-split"><div><h2>Que recherchez-vous ?</h2><p class="section-lead">Cherchez un équipement, une technologie ou décrivez votre problème en français, en arabe ou en anglais.</p></div><span class="catalog-count" id="result-count">{len(services)} prestations</span></div><div class="search-row"><label for="service-search" class="sr-only">Rechercher une prestation</label><span class="search-icon" aria-hidden="true">⌕</span><input type="search" id="service-search" placeholder="Ex. Wi-Fi faible, caméra IP, stock, Microsoft 365, طابعة..." autocomplete="off"><button type="button" id="clear-search" aria-label="Effacer la recherche" hidden>×</button></div><div class="search-examples">Essayez : <button data-search-example="Wi-Fi" type="button">Wi-Fi</button><button data-search-example="stock" type="button">gestion de stock</button><button data-search-example="caméra" type="button">caméras IP</button><button data-search-example="طابعة" type="button">طابعة</button></div><div class="filter-scroll"><div class="filters" id="filters"><button class="filter-chip active" type="button" data-category="all">Tous les services</button>{category_badges()}</div></div><div class="service-grid" id="service-grid">{''.join(card(s) for s in services)}</div><div class="no-results" id="no-results" hidden><h3>Votre demande mérite une étude.</h3><p>Nous n'avons pas trouvé de prestation correspondante dans ce catalogue indicatif. Décrivez votre besoin : nous examinerons sa faisabilité.</p><a class="primary-button" href="#contact">Décrire mon besoin ↗</a></div></div></section>
<section class="section method-section" id="method"><div class="container"><span class="kicker">NOTRE MÉTHODE</span><h2>Clair, méthodique,<br><span>adapté à votre activité.</span></h2><div class="steps"><article><b>01</b><h3>Vous expliquez</h3><p>Parlez-nous de votre besoin ou du problème rencontré.</p></article><article><b>02</b><h3>Nous étudions</h3><p>Nous validons les compétences disponibles, le périmètre et les contraintes.</p></article><article><b>03</b><h3>Nous proposons</h3><p>Une solution, un calendrier et un devis adaptés après analyse.</p></article><article><b>04</b><h3>Nous accompagnons</h3><p>Tests, documentation et suivi selon le contrat convenu.</p></article></div></div></section>
{assistant_section}<section class="section contact-section" id="contact"><div class="container contact-grid"><div><span class="kicker">PARLONS DE VOTRE PROJET</span><h2>Une question ?<br><span>Décrivez votre besoin.</span></h2><p>Nous proposons une étude préliminaire de votre demande. Les délais d'intervention et les prestations sont confirmés avant tout engagement.</p><p class="contact-location">◉ Casablanca · Maroc — autres villes sur étude.</p><div class="contact-warning" id="contact-warning">Version de démonstration : coordonnées professionnelles à renseigner avant mise en ligne.</div></div><form class="request-form" id="request-form"><label>Votre nom ou entreprise<input name="name" type="text" placeholder="Nom / société" maxlength="100" required></label><label>Le service concerné<select name="category"><option value="">Choisissez un domaine</option>{''.join(f'<option value="{e(c["fr"])}">{e(c["fr"])}</option>' for c in cats.values())}</select></label><label>Votre demande<textarea name="message" rows="5" placeholder="Expliquez votre situation, votre matériel ou le résultat attendu..." maxlength="3000" required></textarea></label><button type="submit" class="primary-button form-submit" id="send-request">Préparer ma demande ↗</button><p class="form-help" id="form-help">En démonstration, le formulaire permet de préparer votre message ; il n'envoie ni n'enregistre de données.</p></form></div></section>
</main>'''+footer()+'''<script src="assets/config.js"></script><script src="assets/data.js"></script><script src="assets/app.js"></script><script src="assets/site-v2.js"></script></body></html>'''
(root/'index.html').write_text(index, encoding='utf8')

for s in services:
    path=root/'services'/f"{s['slug']}.html"
    category=cats[s['category']]
    includes=''.join(f'<li>{e(x)}</li>' for x in s['includes'])
    problems=''.join(f'<li>{e(x)}</li>' for x in s['problems'])
    tech=''.join(f'<span class="tech-tag">{e(x)}</span>' for x in s['technologies'])
    body=head(s['fr'],s['desc'], '../')+nav('../')+f'''<main class="detail-main"><div class="container"><nav class="breadcrumbs"><a href="../index.html">Accueil</a><span>›</span><a href="../index.html#services">Services</a><span>›</span>{e(category['fr'])}</nav><div class="detail-top"><div><span class="kicker">{e(category['fr'])}</span><h1>{e(s['fr'])}<span class="detail-line">.</span></h1><p class="detail-desc">{e(s['desc'])}</p><div class="status-note">◈ Prestation sur étude — périmètre et disponibilité à confirmer.</div><a class="primary-button" href="../index.html#contact">Demander une étude ↗</a></div><div class="detail-aside"><span class="aside-label">BESOIN FRÉQUENT</span><h3>Vous rencontrez l'un de ces problèmes ?</h3><ul>{problems}</ul></div></div><div class="detail-sections"><section class="detail-panel"><span class="kicker">CE QUE NOUS ÉTUDIONS</span><h2>Une prestation structurée</h2><ul class="check-list">{includes}</ul></section><section class="detail-panel"><span class="kicker">TECHNOLOGIES ASSOCIÉES</span><h2>Équipements & solutions</h2><div class="tech-list">{tech}</div><p>La solution finale et les produits retenus dépendent du diagnostic, de la compatibilité, des licences nécessaires et du devis accepté.</p></section></div><section class="arabic-panel" lang="ar" dir="rtl"><span>ملخص الخدمة بالعربية</span><h2>{e(s['ar'])}</h2><p>{e(s['desc_ar'])}</p></section><div class="end-cta"><h2>Un besoin similaire ?</h2><p>Présentez votre contexte pour recevoir une proposition étudiée.</p><a class="primary-button" href="../index.html#contact">Décrire mon projet ↗</a></div></div></main>'''+footer('../')+'''<script src="../assets/config.js"></script><script src="../assets/app.js"></script><script src="../assets/site-v2.js"></script></body></html>'''
    path.write_text(body,encoding='utf8')
mentions=head('Informations & confidentialité','Informations sur le site ALLOSERVIX et confidentialité.')+nav()+'''<main class="legal-main"><div class="container"><span class="kicker">TRANSPARENCE</span><h1>Informations du site</h1><p>ALLOSERVIX est un projet de collectif de services technologiques en phase de préparation. Les informations légales définitives (responsable de publication, structure juridique, adresse, email professionnel, identifiants réglementaires) devront être fournies et validées avant publication commerciale.</p><h2>Données personnelles</h2><p>Dans cette version de démonstration, le formulaire ne transmet aucune donnée à un serveur. Il prépare un message que l'utilisateur peut copier ou transmettre volontairement lorsque les coordonnées professionnelles auront été configurées. Aucun outil d'analyse ou cookie marketing n'est installé dans cette version.</p><h2>Services</h2><p>Les offres décrites sont des pistes à valider : elles ne représentent pas un engagement ferme de disponibilité, de certification, de partenariat ou de délai d'intervention.</p><p><a href="index.html">← Retour à l'accueil</a></p></div></main>'''+footer()+'''<script src="assets/config.js"></script><script src="assets/app.js"></script><script src="assets/site-v2.js"></script></body></html>'''
(root/'mentions.html').write_text(mentions,encoding='utf8')
(root/'robots.txt').write_text('User-agent: *\nDisallow: /\n# Remove this staging-only restriction after approving website content and contact/legal details.\n',encoding='utf8')
(root/'README.md').write_text(f'''# ALLOSERVIX — Site vitrine / catalogue de prestations (prototype)

**Status: DRAFT, not authorized for public launch until contact/legal/company scope reviewed.**

## Contents
- Responsive home page, category filters, full-text search with FR/AR/EN related keywords.
- {len(services)} static SEO-ready service detail pages, {len(cats)} categories.
- Request form: copies a draft; WhatsApp only activates when configured.
- No API, database, tracking, cookies, secrets, or third-party assets.
- `assets/config.js`: verified professional email / WhatsApp / location. Do not add secrets.
- `data.py`: service catalogue; every offering is *sur étude* pending real team capability confirmation.

## Preview locally
`python -m http.server 8000` then open `http://localhost:8000`.

## Railway deploy
Use a new GitHub repository and a Railway service. Root `Dockerfile` serves the generated static pages on `$PORT` via Node built-in HTTP server (no dependencies).

## Changes before go-live
1. Confirm the exact brand spelling and legal right to use it.
2. Validate every service and responsibilities with the team.
3. Fill in official contacts in `assets/config.js` and test WhatsApp/Email links.
4. Write final legal/privacy pages after legal review; configure domain DNS.
5. Remove `noindex` metadata and disallow-all `robots.txt` only when launch approved.
6. Review French/Arabic wording, mobile navigation, SEO, and requests end-to-end.
7. Set up analytics only with appropriate privacy information/consent if necessary.

## Editing
Run `python build.py` after changing `data.py` to regenerate the catalogue and pages. `assets/style.css`, `assets/app.js` and `assets/config.js` are not overwritten.
''',encoding='utf8')
print('Generated',len(services),'services in',len(cats),'categories')
