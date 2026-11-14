# ALLOSERVIX — Solution Navigator V8 (prévisualisation)

Une expérience web mobile-first, distincte de la page principale, adaptée à une clientèle marocaine (FR, arabe, darija).

## Fonctionnement
- 100 prestations répertoriées dans 13 domaines (toutes **Sur étude**, sans promesse commerciale).
- Compréhension initiale de demandes : dépannage, installation, choix du matériel et budget, développement, conseil et suivi.
- Au maximum deux questions de clarification avant la recommandation. Réponses basées sur le catalogue public administrable ; l'utilisateur peut ignorer les questions.
- Quatre volets dans le Passeport Solution : prestations liées, matériel potentiel, étapes et budget à étudier.
- Copie, export via impression PDF, WhatsApp seulement quand coordonnées confirmées dans `assets/config.js`.
- Navigation en scènes courtes, accès direct au catalogue, interface FR / عربي, lecture ou dictée vocale facultative avec consentement explicite.
- Bloc de présentation professionnelle : **trois spécialistes, chacun plus de 12 années d'expérience selon le brief de l'équipe**. Cela ne constitue pas une revendication de partenariat avec leurs anciens employeurs.
- Visiteurs non authentifiés : seuls les services publiés sont accessibles, l'administration reste verrouillée.

## Technical
- `POST /api/public/diagnose`, payload `{question, answers:{context?,detail?,budget?}, allow_external_ai?}`.
- `GET /api/public/catalog` conserve les données courantes dans SQLite sous le volume Railway.
- Classement d'intentions et de prestations dans `intent-engine.js` (sans clés API).
- IA externe **désactivée** sauf si administrateur fournit `OPENAI_API_KEY`, active `ENABLE_AI=true`, et si visiteur consent explicitement ; le moteur de règles constitue toujours une solution de repli.
- `ENABLE_ANALYTICS=false`, `ENABLE_INQUIRIES=false` par défaut.
- `npm test` couvre l'accès admin/MFA/CSRF, le catalogue, la disponibilité prudente, les demandes courantes et les questions.

## Environnement
- Le site public existant et `/admin` ne sont pas modifiés visuellement. Nouvelle expérience sur `/solution-v8/index.html`.
- Vérifier avant sortie publique : compétences et habilitations (notamment détection incendie), coordonnées, mentions légales, prix, accueil des demandes, tests de lecture audio sur appareils ciblés.
- Aucun logo d'employeur ni nom de client n'est affiché ; toutes les références nominatives nécessitent autorisation.
