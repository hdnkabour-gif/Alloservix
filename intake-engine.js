'use strict';
// Structured, non-authoritative extraction. Provider output is never a customer-facing answer.
const intent=require('./intent-engine');
const BUSINESS=[
  ['restaurant',/(restaurant|resto|snack|cafe|café|مطعم|مقهى|سناك|pizzeria|pizzéria)/iu],
  ['retail',/(boutique|magasin|épicerie|epicerie|commerce|محل|حانوت|بقالة|متجر)/iu],
  ['garage',/(garage|atelier mécanique|mecanique|carrosserie|كراج|ميكانيك|ورشة)/iu],
  ['pharmacy',/(pharmacie|صيدلية)/iu],
  ['clinic',/(cabinet médical|clinique|dentiste|عيادة|طبيب)/iu],
  ['office',/(bureau|agence|مكتب|وكالة)/iu],
  ['warehouse',/(entrepôt|entrepot|dépôt|depot|مستودع|مخزن)/iu],
  ['other',/(autre activité|other business)/iu]
];
const MODES=new Set(['general','field_visit']);
const TYPES=new Set(['restaurant','retail','garage','pharmacy','clinic','office','warehouse','other','unknown']);
const GOALS=new Set(['repair','install','choose','build','learn','followup','unknown']);
const FIELDS=['business_type','business_description','business_name','need_summary','existing_equipment','location_city','desired_outcome','urgency','site_size','visit_reason'];
const max={business_type:30,business_description:180,business_name:90,need_summary:300,existing_equipment:180,location_city:80,desired_outcome:180,urgency:30,site_size:60,visit_reason:180};
const normalize=s=>typeof s==='string'?s.trim().slice(0,500):'';
function extract(message,mode='general',previous={}){
 if(!MODES.has(mode))throw Error('Invalid mode');
 const clean=normalize(message);
 const base=Object.fromEntries(FIELDS.map(k=>[k,normalize(previous[k]).slice(0,max[k])]));
 const domain=BUSINESS.find(([,p])=>p.test(clean));
 if(mode==='field_visit'&&domain&&(!base.business_type||base.business_type==='unknown'))base.business_type=domain[0];
 if(!base.need_summary)base.need_summary=clean.slice(0,300);
 if(mode==='field_visit'&&!base.visit_reason)base.visit_reason=clean.slice(0,180);
 const detected=intent.detect(clean);
 return {mode,fields:base,intent:{topic:detected.topic,action:detected.action,confidence:detected.confidence},
   field_sources:Object.fromEntries(FIELDS.filter(k=>base[k]).map(k=>[k,k==='business_type'&&domain?'heuristic':'visitor'])),
   missing:missing(base,mode),questions:questions(base,mode),source:'local',external_ai_used:false};
}
function missing(fields,mode){return (mode==='field_visit'?['business_type','business_description','need_summary','desired_outcome']:['need_summary']).filter(k=>!fields[k]||fields[k]==='unknown');}
const prompts={
 business_type:{fr:'Quel type de commerce ou d’activité avez-vous ?',ar:'شنو نوع المحل أو النشاط ديالك؟'},
 business_description:{fr:'Que fait votre établissement au quotidien ?',ar:'شنو كيدير المحل ديالك فالخدمة اليومية؟'},
 need_summary:{fr:'Quel est le problème ou le projet principal ?',ar:'شنو هو المشكل أو المشروع اللي باغي؟'},
 desired_outcome:{fr:'Quel résultat souhaitez-vous obtenir ?',ar:'شنو النتيجة اللي باغي توصل ليها؟'}
};
function questions(fields,mode){return missing(fields,mode).slice(0,3).map(k=>({field:k,...prompts[k]}));}
function mergeAI(local,raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return local;
 const fields={...local.fields},sources={...local.field_sources};
 const proposed=raw.fields&&typeof raw.fields==='object'&&!Array.isArray(raw.fields)?raw.fields:{};
 for(const k of FIELDS){const v=proposed[k];if(typeof v!=='string'||!v.trim()||v.length>max[k])continue;
   if(k==='business_type'&&!TYPES.has(v))continue;
   // Do not overwrite explicit visitor-provided fields; inferred business type can be refined.
   if(!fields[k]||fields[k]==='unknown'||sources[k]==='heuristic'){fields[k]=v.trim();sources[k]='external_ai_unverified';}
 }
 const action=GOALS.has(raw.action)?raw.action:local.intent.action;
 const topic=typeof raw.topic==='string'&&/^[a-z_]{2,30}$/.test(raw.topic)?raw.topic:local.intent.topic;
 return {...local,fields,field_sources:sources,intent:{...local.intent,topic,action,confidence:'à confirmer'},missing:missing(fields,local.mode),questions:questions(fields,local.mode),source:'hybrid',external_ai_used:true};
}
function candidate(input){
 if(!input||input.consent!==true||input.confirmed_by_visitor!==true)throw Error('Visitor confirmation and consent required');
 const kind=String(input.kind||'').trim();
 if(!['business_term','intent_correction','service_gap','faq_suggestion','visit_type'].includes(kind))throw Error('Invalid candidate kind');
 const text=normalize(input.text).slice(0,500);
 if(text.length<8)throw Error('Candidate too short');
 const corrected=normalize(input.corrected_value).slice(0,160);
 return {kind,text,corrected_value:corrected,source:'visitor_confirmed',status:'pending_review'};
}
module.exports={extract,mergeAI,candidate,missing,questions,FIELDS};
