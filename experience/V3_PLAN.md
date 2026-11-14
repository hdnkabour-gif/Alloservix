# ALLOSERVIX — V3 / Expérience marocaine (2026-11-14)

## Pourquoi cette expérience existe
La première interaction avec ALLOSERVIX viendra souvent d'un QR imprimé sur un flyer, une carte de visite, une enveloppe ou un sticker, d'un lien WhatsApp, d'un rendez-vous ou d'une recherche directe. L'objectif est d'aider un visiteur à formuler un problème et trouver des pistes utiles, pas de gonfler artificiellement son temps passé sur le site. Casablanca est la première zone cible ; les autres grandes villes viendront selon la capacité réelle de l'équipe.

## Ce qui est effectivement implémenté dans /experience/index.html (V3 preview)
1. Interface originale responsive, contraste élevé, palette bleu profond / ivoire / vert-bleu / cuivre, illustration typographique et formes CSS sans images externes.
2. Sélection de profil (maison/villa, commerce/atelier, entreprise, autre), avec exemples de questions adaptés au profil.
3. FR / arabe marocain pour la navigation ; saisie libre FR / AR / darija / EN, alias et correspondances lexicales locales sans déclarer de LLM externe.
4. Recherche de services dans la vraie réponse `/api/public/catalog`, 32 prestations de 10 catégories initiales, sans duplication d'une liste statique dans cette page.
5. Résultats contextuels, fiche détaillée par prestation (modal accessible au clavier), statut indicatif de service et première question de qualification.
6. Préparation d'une demande dans la page, bouton copier, liens WhatsApp / e-mail uniquement si coordonnées explicitement configurées par l'administrateur ; aucun message transmis au serveur par ce formulaire.
7. Préremplissage `?need=...` pour des campagnes à QR, lecture locale de `utm_source`, `utm_campaign` et `src`, sans création de profil ni émission d'événement analytique par cette page.
8. Aucun login public. Authentification administrateur V2 séparée et intacte. Prévisualisation noindex, sans modification de la page d'accueil V2.
9. Navigation clavier, libellés, RTL, `prefers-reduced-motion`, petite taille d'écran et absence de scripts externes.

## Ce qui n'est PAS encore développé ou ne doit pas être présenté comme disponible
- La recherche actuelle est une correspondance lexicale heuristique, pas un modèle génératif IA ni une analyse experte automatique. Une recherche sémantique avec validation des réponses par les contenus approuvés est à faire.
- Pas de conversation mémoire multi-tours, de reconnaissance vocale, de diagnostic technique garanti, de prix instantané ou de calculateur fiable de devis.
- Pas de traduction 100 % complète de toutes les fiches ; la langue anglaise est acceptée surtout comme termes de recherche.
- Pas d'analytics personnalisés dans V3. La V2 contient une infrastructure consentement + statistiques, désactivée par défaut. Une intégration conforme et une étude de minimisation des données sont nécessaires avant activation.
- La V2 possède un seul compte administrateur; les rôles multi-utilisateurs, historique fin par auteur, et récupération de compte doivent être conçus puis testés.
- La disponibilité, la ville de couverture et les capacités de l'équipe ne sont pas encore vérifiées et toutes les fiches demeurent `Sur étude`.
- Le domaine alloservix.ma n'est pas encore basculé. Les infos légales / commerciales et contacts doivent être confirmés.
- Les validations web responsive en navigateur automatisé sont bloquées par l'environnement ; tests statiques, unitaires et endpoints seulement.

## Cahier des charges priorisé
**P0 – Vérification avant page d'accueil publique**
- Entretien avec l'équipe : services effectivement réalisables, interventions à domicile / à distance / sur devis, Casablanca, canaux de contact.
- Nom et marque, mentions légales et exactitude des coordonnées, promesses commerciales, activités réglementées, contrat type et privacy notice.
- Audit du parcours V3 avec 5–8 utilisateurs marocains (propriétaire d'un magasin, particulier, responsable PME, IT manager). Observer rapidité, incompréhension, erreur, confiance et accessibilité.
- Test tactile/mobile réelle, connexion réseau modérée, 320–430px, Android/Chrome, iOS/Safari, RTL; corriger défauts avant V3 par défaut.
- Configurer le premier compte admin avec mot de passe fort + TOTP par Railway, stockage persistant, sauvegarde / restauration testées, gestion des secrets.
- Conserver en mode privé/staging les services non validés et ne pas publier les images de clients sans autorisation.

**P1 – Lancement Maroc**
- Moteur de recherche « besoin → services » avec variantes de darija écrite en latin, corrections, synonymes, intention et absence de résultat explicite, et FAQ validées.
- Contenu rédigé naturellement pour le public local, français professionnel, darija bien relue et arabe ; anglais pour profils techniques.
- Vue service enrichie (périmètre, technologies, prérequis, exemples, FAQ, région, modes d'intervention, statut, conditions, exigences, durée estimative seulement si vérifiée).
- Consentement granularisé, métriques utiles agrégées, taux de recherche sans résultat, campagnes QR (flyer, sticker, carte), suivi des étapes mais jamais de coordonnées personnelles dans les événements.
- Pipeline devis sécurisé, notification, consentement, statut de demande, déduplication anti-spam, restrictions de rétention, politique de confidentialité.
- Pages indexables après validation du contenu, sitemap, canonical/metadata OG, schema.org appropriés, Google Business Profile vérifié, vitesse Core Web Vitals.

**P2 – Assistance enrichie et équipe**
- Assistant conversationnel hybride : lexique + index sémantique + génération facultative avec citations vers fiches approuvées, garde-fous contre hallucinations, budget et limites d'utilisation ; consentement explicite avant IA tierce.
- Questions de clarification adaptatives, diagnostic guidé (sans manipulation risquée), collecte facultative de photo sans métadonnées inutiles, protection des documents.
- Dashboard admin : permission par rôle, MFA, logs et audits, versioning des contenus, prévisualisation, validation, classement des recherches, parcours par étape, abandon agrégé, performances des campagnes, suppression/exports selon droits.
- Agenda de rendez-vous relié aux vraies disponibilités seulement, couverture des villes, durée d'intervention, prise de contact WhatsApp Business officielle, suivi tickets.
- Galerie de réalisations avec autorisation, études de cas AMANZINE et autres projets avec données fictives uniquement, démos interactives isolées.

**P3 – Différenciation**
- Recherche vocale si transcription FR/AR/DA fiable, accessibilité et consentement ; contrôle des coûts et redaction.
- « Passeport de besoin » réutilisable si l'utilisateur choisit de sauvegarder, sans compte obligatoire pour découvrir.
- Visualisations pédagogiques (plan de réseau, parcours commande-stock, architecture Cloud), mini-outils d'aide au choix, comparaison transparente de solutions.
- Réseau de partenaires et zones géographiques basé sur engagements réels ; campagnes ville par ville.

## Exemples d'URL QR à imprimer (ne pas imprimer avant validation)
- Flyer entreprises : `https://alloservix.ma/experience/index.html?src=flyer_b2b&utm_campaign=casa_pilot`
- Sticker commerce : `https://alloservix.ma/experience/index.html?src=sticker_shop&utm_campaign=casa_pilot&need=logiciel%20de%20gestion`
- Carte : `https://alloservix.ma/experience/index.html?src=carte&utm_campaign=casa_pilot`
- Enveloppe : `https://alloservix.ma/experience/index.html?src=letter_premium&utm_campaign=casa_pilot`
Ces exemples deviennent valables lorsque le domaine sera effectivement connecté et que le chemin V3 sera approuvé.

## Règles de confiance et confidentialité
Les visiteurs anonymes peuvent naviguer librement. Une fiche ne peut être présentée comme disponible que si l'équipe a validé son périmètre. Les questions libres ne sont pas persistées par le formulaire V3. Aucun mécanisme caché n'essaie de retenir artificiellement le visiteur. Jamais de logos de partenaires, tarifs, certifications ou références clients non vérifiés. Toute future collecte est documentée, limitée, avec bases juridiques, durée de conservation, accès contrôlé et canal de contact clairement défini.