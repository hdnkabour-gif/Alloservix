'use strict';
// ALLOSERVIX role-based access control. Least privilege, default deny.
// Every /api/admin/* route MUST appear in ROUTES; an unmapped route is refused (403).

const PERMISSIONS = Object.freeze({
  'dashboard.view': 'Voir le centre de contrôle (agrégats, sans données personnelles)',
  'catalogue.read': 'Consulter le catalogue des prestations',
  'catalogue.edit': 'Proposer des modifications de prestations (brouillons)',
  'catalogue.history': 'Voir qualité, doublons, taxonomie, brouillons et historique du catalogue',
  'catalogue.publish': 'Modifier en direct, approuver les brouillons, publier et changer la disponibilité',
  'knowledge.read': 'Consulter Knowledge Studio',
  'knowledge.edit': 'Créer ou modifier concepts et relations (brouillons)',
  'knowledge.approve': 'Approuver / archiver concepts et relations',
  'requests.view': 'Voir les demandes (selon le périmètre du rôle)',
  'requests.pii': 'Voir les coordonnées décryptées des clients',
  'requests.manage': 'Classer, évaluer et affecter les demandes',
  'requests.status': 'Changer le statut d’une demande (périmètre du rôle)',
  'technicians.read': 'Consulter les fiches techniciens (données privées)',
  'technicians.manage': 'Créer / modifier les techniciens',
  'analytics.read': 'Consulter les statistiques consenties',
  'inquiries.read': 'Consulter les formulaires de contact (données personnelles)',
  'settings.write': 'Modifier les informations publiques du site',
  'ai.monitor': 'Surveiller l’assistant et les fournisseurs IA',
  'system.status': 'Voir l’état opérationnel (sans secrets)',
  'system.backup': 'Créer un instantané vérifié de la base',
  'audit.read': 'Consulter le journal d’audit',
  'staff.read': 'Lister les comptes de l’équipe',
  'staff.manage': 'Inviter, modifier, désactiver, réinitialiser des comptes'
});

const ALL = Object.keys(PERMISSIONS);

const ROLES = Object.freeze({
  owner: Object.freeze([...ALL]),
  manager: Object.freeze([
    'dashboard.view', 'catalogue.read', 'catalogue.edit', 'catalogue.history', 'knowledge.read', 'knowledge.edit',
    'requests.view', 'requests.pii', 'requests.manage', 'requests.status',
    'technicians.read', 'technicians.manage', 'analytics.read', 'inquiries.read',
    'ai.monitor', 'system.status', 'staff.read'
  ]),
  technician: Object.freeze(['catalogue.read', 'requests.view', 'requests.status'])
});

const ROLE_LABELS = Object.freeze({ owner: 'Propriétaire', manager: 'Gestionnaire', technician: 'Technicien' });

const permissionsFor = role => (ROLES[role] ? [...ROLES[role]] : []);
const can = (role, permission) => Boolean(ROLES[role] && ROLES[role].includes(permission));

// 'session' = any authenticated staff member (no specific permission).
const ROUTES = [
  ['POST', /^\/api\/admin\/logout$/, 'session'],
  ['GET', /^\/api\/admin\/me$/, 'session'],
  ['POST', /^\/api\/admin\/reauth$/, 'session'],
  ['POST', /^\/api\/admin\/me\/password$/, 'session'],
  ['POST', /^\/api\/admin\/me\/mfa\/begin$/, 'session'],
  ['POST', /^\/api\/admin\/me\/mfa\/confirm$/, 'session'],
  ['POST', /^\/api\/admin\/me\/migrate\/begin$/, 'session'],
  ['POST', /^\/api\/admin\/me\/migrate\/confirm$/, 'session'],
  ['GET', /^\/api\/admin\/studio$/, 'knowledge.read'],
  ['POST', /^\/api\/admin\/studio\/services$/, 'catalogue.edit'],
  ['POST', /^\/api\/admin\/studio\/(?:concepts|links)$/, 'knowledge.edit'],
  ['PUT', /^\/api\/admin\/studio\/(?:concepts|links)\/[1-9][0-9]{0,8}\/review$/, 'knowledge.approve'],
  ['PUT', /^\/api\/admin\/studio\/(?:concepts|links)\/[1-9][0-9]{0,8}$/, 'knowledge.edit'],
  ['GET', /^\/api\/admin\/ai\/status$/, 'ai.monitor'],
  ['GET', /^\/api\/admin\/ops\/config$/, 'requests.view'],
  ['GET', /^\/api\/admin\/ops\/notifications$/, 'requests.manage'],
  ['GET', /^\/api\/admin\/ops\/requests$/, 'requests.view'],
  ['GET', /^\/api\/admin\/ops\/requests\/[^/]+$/, 'requests.view'],
  ['PUT', /^\/api\/admin\/ops\/requests\/[^/]+\/classify$/, 'requests.manage'],
  ['GET', /^\/api\/admin\/ops\/requests\/[^/]+\/candidates$/, 'requests.manage'],
  ['PUT', /^\/api\/admin\/ops\/requests\/[^/]+\/status$/, 'requests.status'],
  ['PUT', /^\/api\/admin\/ops\/requests\/[^/]+\/assignment$/, 'requests.manage'],
  ['GET', /^\/api\/admin\/ops\/technicians(?:\/[^/]+)?$/, 'technicians.read'],
  ['POST', /^\/api\/admin\/ops\/technicians$/, 'technicians.manage'],
  ['PUT', /^\/api\/admin\/ops\/technicians\/[^/]+$/, 'technicians.manage'],
  ['GET', /^\/api\/admin\/control-center$/, 'dashboard.view'],
  ['GET', /^\/api\/admin\/overview$/, 'analytics.read'],
  ['GET', /^\/api\/admin\/services$/, 'catalogue.read'],
  ['PUT', /^\/api\/admin\/services\/[^/]+$/, 'catalogue.publish'],
  ['GET', /^\/api\/admin\/catalogue\/(?:overview|quality|duplicates|duplicate-check|taxonomy|drafts)$/, 'catalogue.history'],
  ['GET', /^\/api\/admin\/services\/[^/]+\/revisions(?:\/[0-9]{1,6})?$/, 'catalogue.history'],
  ['POST', /^\/api\/admin\/catalogue\/drafts$/, 'catalogue.edit'],
  ['PUT', /^\/api\/admin\/catalogue\/drafts\/[1-9][0-9]{0,8}$/, 'catalogue.edit'],
  ['POST', /^\/api\/admin\/catalogue\/drafts\/[1-9][0-9]{0,8}\/(?:submit|withdraw)$/, 'catalogue.edit'],
  ['POST', /^\/api\/admin\/catalogue\/drafts\/[1-9][0-9]{0,8}\/(?:approve|reject)$/, 'catalogue.publish'],
  ['POST', /^\/api\/admin\/catalogue\/taxonomy\/merge$/, 'catalogue.publish'],
  ['POST', /^\/api\/admin\/services\/[^/]+\/revisions\/[0-9]{1,6}\/restore$/, 'catalogue.edit'],
  ['PUT', /^\/api\/admin\/settings$/, 'settings.write'],
  ['GET', /^\/api\/admin\/inquiries$/, 'inquiries.read'],
  ['GET', /^\/api\/admin\/audit$/, 'audit.read'],
  ['GET', /^\/api\/admin\/audit\/verify$/, 'audit.read'],
  ['GET', /^\/api\/admin\/staff$/, 'staff.read'],
  ['POST', /^\/api\/admin\/staff$/, 'staff.manage'],
  ['PUT', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}$/, 'staff.manage'],
  ['POST', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}\/invite$/, 'staff.manage'],
  ['POST', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}\/revoke-sessions$/, 'staff.manage'],
  ['GET', /^\/api\/admin\/rbac$/, 'session'],
  ['GET', /^\/api\/admin\/brain\/(?:overview|providers|eval\/cases|eval\/runs)$/, 'ai.monitor'],
  ['GET', /^\/api\/admin\/brain\/eval\/runs\/[1-9][0-9]{0,8}$/, 'ai.monitor'],
  ['GET', /^\/api\/admin\/brain\/unmatched$/, 'inquiries.read'],
  ['POST', /^\/api\/admin\/brain\/eval\/run$/, 'ai.monitor'],
  ['POST', /^\/api\/admin\/brain\/eval\/cases$/, 'knowledge.edit'],
  ['PUT', /^\/api\/admin\/brain\/eval\/cases\/[1-9][0-9]{0,8}$/, 'knowledge.edit'],
  ['GET', /^\/api\/admin\/system\/(?:status|errors|backups)$/, 'system.status'],
  ['POST', /^\/api\/admin\/system\/domain-check$/, 'system.status'],
  ['POST', /^\/api\/admin\/system\/backups$/, 'system.backup'],
  ['POST', /^\/api\/admin\/system\/encrypt-legacy$/, 'system.backup'],
  ['POST', /^\/api\/admin\/system\/backups\/alloservix-\d{8}-\d{6}\.sqlite\/(?:verify-restore|export)$/, 'system.backup']
];

// Routes that additionally need a fresh password+TOTP re-verification (see auth.js REAUTH_MS).
const SENSITIVE = [
  ['POST', /^\/api\/admin\/staff$/],
  ['PUT', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}$/],
  ['POST', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}\/invite$/],
  ['POST', /^\/api\/admin\/staff\/[A-Za-z0-9-]{8,64}\/revoke-sessions$/],
  ['PUT', /^\/api\/admin\/settings$/],
  ['POST', /^\/api\/admin\/me\/migrate\/begin$/],
  ['POST', /^\/api\/admin\/system\/backups$/],
  ['POST', /^\/api\/admin\/system\/encrypt-legacy$/],
  ['POST', /^\/api\/admin\/system\/backups\/alloservix-\d{8}-\d{6}\.sqlite\/export$/],
  ['POST', /^\/api\/admin\/catalogue\/drafts\/[1-9][0-9]{0,8}\/approve$/],
  ['POST', /^\/api\/admin\/catalogue\/taxonomy\/merge$/]
];

function permissionFor(method, pathname) {
  for (const [m, re, perm] of ROUTES) if (m === method && re.test(pathname)) return perm;
  return null;
}
function needsReauth(method, pathname) {
  return SENSITIVE.some(([m, re]) => m === method && re.test(pathname));
}

module.exports = { PERMISSIONS, ROLES, ROLE_LABELS, ROUTES, permissionsFor, can, permissionFor, needsReauth };
