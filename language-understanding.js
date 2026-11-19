'use strict';
// Moroccan Arabic, Arabizi, French, English and mixed spelling hints. No claims or diagnosis.
const normalize=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const rules=[
 [/\b(?:l?wifi|wi\s?fi|waifi|wifii|wify|wiffi)\b|الويفي|واي فاي/u,'wifi الويفي reseau'],
 [/\b(?:3ndi|andi)\s+(?:mochkil|mouchkil|mushkil)\b|عندي\s+مشكل/u,'مشكل panne'],
 [/\b(?:ma\s*kay\s*khdemch|makaykhdemch|makhadamch|ma\s*khdamch|makhdamch|kayt9ta3|kays9et|ma\s*katssjlech)\b/u,'panne معطل مشكل'],
 [/\b(?:ma\s*kay\s*wselch|makaywselch|makitsselch)\b/u,'ضعيف مشكلة connexion'],
 [/\b(?:7assoub|7asoub|hassoub|kompyoutar|kompiyouter|laptop|ordi)\b/u,'ordinateur pc حاسوب'],
 [/\b(?:s?caner|skaner|scan\s+vers\s+dossier|scan\s+to\s+folder|scan\s+smb|skan)\b|سكانير|سكان\b/u,'scanner imprimante smb'],
 [/\b(?:kamira|camira|kamirat|camra|cctv|nvr|dvr)\b/u,'camera cameras surveillance'],
 [/\b(?:cablage|kablaj|kablag|switch|swich|switsh|rj45|cat6|ethernet)\b|كابلاج|سويتش/u,'reseau lan cablage'],
 [/\b(?:srv|serveur|proxmox|vmware|esxi|hyperv|nas|hyper\s?v)\b|سيرفر/u,'serveur virtualisation'],
 [/\b(?:m365|ms365|office\s*365|teams|sharepoint|azure|entra)\b|مايكروسوفت/u,'microsoft 365 cloud'],
 [/\b(?:appli|ablikasyon|app|logiciel|erp|crm|facturation|stock|magasin|caisse)\b|ابليكاسيون|مخزون|تسيير/u,'logiciel application stock'],
 [/\b(?:parabol|parabole|paraboll|lnb|nilesat|receiver|risiver)\b|بارابول|ستالايت/u,'satellite parabole reception'],
 [/\b(?:bab\s*lgarage|bab\s*automatique|motorisation|portail|domotique|garage)\b|باب\s*الكراج|موتور/u,'motorisation garage domotique'],
 [/\b(?:backup|ransomware|cybersecurite|firewall|piratage)\b|نسخ\s*احتياطي|اختراق/u,'securite sauvegarde'],
 [/\b(?:incendie|smoke\s*alarm|fire\s*alarm)\b|حريق|دخان/u,'incendie fire detecteur'],
 [/\b(?:bghit|bghina)\s+(?:nssayb|nsawb|nssaybou)|\bnssayb\b|نبغي\s*نصاوب/u,'creer developper مشروع'],
 [/\b(?:n9ad|nssla7|nsslh|repair|fix)\b|نصلح/u,'reparer depanner تصليح'],
 [/\b(?:ch7al|chhal|taman|devis|price)\b|الثمن|شحال/u,'prix devis ثمن'],
 [/\b(?:kifach|kifash|how\s*to)\b|كيفاش/u,'comment conseil']
];
function expand(input){const start=normalize(input);if(!start)return '';const additions=[];for(const [regex,tokens] of rules)if(regex.test(start))additions.push(tokens);return [start,...new Set(additions)].join(' ');}
function language(input){const raw=String(input||''),latin=normalize(input),arabic=/[\u0600-\u06ff]/u.test(raw),words=/[a-z]/.test(latin);
 const romanized=/\b(?:bghit|3ndi|ch7al|kifach|n9ad|nssayb|makaykhdemch|makaywselch|lwifi|dyal|khassni)\b/.test(latin);
 if(arabic&&words)return 'mixed';if(arabic)return 'ar';if(romanized)return 'darija-latin';
 if(/\b(?:je|veux|bonjour|mon|une|pour|comment|panne|installation|besoin)\b/.test(latin))return 'fr';
 if(/\b(?:my|please|need|want|broken|how|help|install|server)\b/.test(latin))return 'en';return 'unknown';
}
module.exports={normalize,expand,language};
