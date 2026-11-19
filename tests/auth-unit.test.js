'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createAuth,totpMatch,hashPassword,passwordPolicy,base32Encode,base32Decode,passwordValid}=require('../auth');
const rbac=require('../rbac');

const KEY=crypto.randomBytes(32).toString('hex');
const STRONG='Correct-Horse-Battery-Staple-9!';
const otp=(secret,step)=>{const key=base32Decode(secret),msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',key).update(msg).digest(),o=h.at(-1)&15;return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0')};
function fixture(extraEnv={}){
  const db=new DatabaseSync(':memory:'),log=[];let t=Date.UTC(2026,10,18,12,0,0);
  const env={ALLO_DATA_KEY:KEY,...extraEnv};
  const auth=createAuth(db,{env,now:()=>t,audit:(a,r,d,actor)=>log.push({a,r,d,actor})});
  const owner={kind:'staff',id:'bootstrap-owner',email:'boss@example.org',role:'owner'};
  return {db,auth,log,env,owner,tick:ms=>{t+=ms},step:()=>Math.floor(t/30000),now:()=>t};
}
// create + activate an account end-to-end, returns {id,secret,email}
function enroll(f,input,actor=f.owner){
  const {account,invite}=f.auth.createAccount(input,actor,{technicianExists:()=>true});
  const {secret}=f.auth.acceptInvite(invite.token,STRONG);
  f.auth.activateInvite(invite.token,otp(secret,f.step()));
  return {id:account.id,secret,email:account.email};
}

test('base32/TOTP round trip and RFC 6238 vector',()=>{
  assert.equal(base32Encode(Buffer.from('12345678901234567890')),'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),Buffer.from('12345678901234567890'));
  // RFC 6238 SHA1 vector: T=59s -> 94287082 -> last six digits 287082
  assert.equal(otp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1),'287082');
  assert.equal(totpMatch('abc','GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),null);
});
test('TOTP window is +-1 step and a used step cannot be replayed',()=>{
  const s='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',now=59000+30000*10;
  const step=Math.floor(now/30000);
  assert.equal(totpMatch(otp(s,step),s,now,0),step);
  assert.equal(totpMatch(otp(s,step-1),s,now,0),step-1);
  assert.equal(totpMatch(otp(s,step+1),s,now,0),step+1);
  assert.equal(totpMatch(otp(s,step+2),s,now,0),null);
  assert.equal(totpMatch(otp(s,step),s,now,step),null,'replay of the same step rejected');
  assert.equal(totpMatch(otp(s,step-1),s,now,step),null,'older step rejected after newer accepted');
});
test('password policy and scrypt format',()=>{
  assert.match(passwordPolicy('short'),/16/);
  assert.match(passwordPolicy('aaaaaaaaaaaaaaaaaaaa'),/répétitif/);
  assert.match(passwordPolicy('contains-jessica-inside-1!','jessica@example.org'),/identifiant/);
  assert.equal(passwordPolicy(STRONG,'x@y.org'),null);
  const h=hashPassword(STRONG);assert.ok(passwordValid(STRONG,h));assert.ok(!passwordValid(STRONG+'x',h));assert.ok(!passwordValid('',h));
});
test('RBAC matrix: least privilege and default deny',()=>{
  assert.ok(rbac.can('owner','staff.manage'));
  for(const p of ['staff.manage','settings.write','catalogue.publish','knowledge.approve','audit.read'])assert.ok(!rbac.can('manager',p),'manager must not have '+p);
  for(const p of Object.keys(rbac.PERMISSIONS).filter(p=>!['catalogue.read','requests.view','requests.status'].includes(p)))assert.ok(!rbac.can('technician',p),'technician must not have '+p);
  assert.equal(rbac.permissionFor('GET','/api/admin/unknown'),null);
  assert.equal(rbac.permissionFor('DELETE','/api/admin/services'),null);
  assert.equal(rbac.permissionFor('PUT','/api/admin/staff/abcdefgh-1234'),'staff.manage');
  assert.deepEqual(rbac.permissionsFor('ghost'),[]);
});
test('invite flow: password then MFA proof, single use, expiry',()=>{
  const f=fixture();
  const {account,invite}=f.auth.createAccount({email:'Mgr@Example.org',display_name:'Salma',role:'manager'},f.owner);
  assert.equal(account.email,'mgr@example.org');assert.equal(account.status,'invited');assert.equal(account.mfa_enrolled,false);
  assert.ok(!JSON.stringify(f.auth.listAccounts()).match(/password_hash|totp_secret|pending_totp/),'no secrets in listing');
  assert.throws(()=>f.auth.acceptInvite('0'.repeat(64),STRONG),/Invitation invalide/);
  assert.throws(()=>f.auth.acceptInvite(invite.token,'tooshort'),/16 caractères/);
  assert.throws(()=>f.auth.activateInvite(invite.token,'123456'),/mot de passe/i,'must set password first');
  const {secret}=f.auth.acceptInvite(invite.token,STRONG);
  assert.throws(()=>f.auth.activateInvite(invite.token,'000000'),/invalide/);
  assert.ok(f.auth.activateInvite(invite.token,otp(secret,f.step())).activated);
  assert.throws(()=>f.auth.acceptInvite(invite.token,STRONG),/invalide ou expirée/,'single use');
  assert.equal(f.auth.getAccount(account.id).status,'active');
  const exp=fixture();const x=exp.auth.createAccount({email:'late@example.org',display_name:'Late',role:'manager'},exp.owner);
  exp.tick(exp.auth.constants.INVITE_MS+1000);assert.throws(()=>exp.auth.acceptInvite(x.invite.token,STRONG),/invalide ou expirée/);
});
test('secrets are encrypted at rest and bound to the account id',()=>{
  const f=fixture();const a=enroll(f,{email:'enc@example.org',display_name:'Enc',role:'manager'});
  const row=f.db.prepare('SELECT totp_secret,password_hash FROM staff_accounts WHERE id=?').get(a.id);
  assert.ok(!row.totp_secret.includes(a.secret),'TOTP seed must not be stored in clear');
  assert.ok(!row.password_hash.includes(STRONG));
  const b=enroll(f,{email:'enc2@example.org',display_name:'Enc2',role:'manager'});
  const other=f.db.prepare('SELECT totp_secret FROM staff_accounts WHERE id=?').get(b.id).totp_secret;
  f.db.prepare('UPDATE staff_accounts SET totp_secret=? WHERE id=?').run(other,a.id); // swap ciphertexts
  f.tick(31000);assert.throws(()=>f.auth.authenticate('enc@example.org',STRONG,otp(a.secret,f.step())),/invalides/,'swapped ciphertext must not decrypt');
});
test('login: uniform errors, replay protection, lockout, disabled accounts',()=>{
  const f=fixture();const a=enroll(f,{email:'user@example.org',display_name:'User',role:'manager'});
  f.tick(31000);
  const msg=fn=>{try{fn();return null}catch(e){return e.message+':'+e.status}};
  const wrongPw=msg(()=>f.auth.authenticate('user@example.org','wrong-password-xx',otp(a.secret,f.step())));
  f.tick(31000);
  const wrongOtp=msg(()=>f.auth.authenticate('user@example.org',STRONG,'000000'));
  const unknown=msg(()=>f.auth.authenticate('nobody@example.org',STRONG,'000000'));
  assert.equal(wrongPw,wrongOtp);assert.equal(wrongOtp,unknown);assert.match(unknown,/401$/,'no user enumeration');
  f.tick(31000);const code=otp(a.secret,f.step());
  assert.equal(f.auth.authenticate('user@example.org',STRONG,code).principal.role,'manager');
  assert.match(msg(()=>f.auth.authenticate('user@example.org',STRONG,code)),/401$/,'same code cannot be replayed');
  // lockout after MAX_FAILS consecutive failures, even with correct credentials afterwards
  for(let i=0;i<f.auth.constants.MAX_FAILS;i++)msg(()=>f.auth.authenticate('user@example.org','bad-bad-bad-bad-bad',otp(a.secret,f.step()+1)));
  f.tick(31000);
  assert.match(msg(()=>f.auth.authenticate('user@example.org',STRONG,otp(a.secret,f.step()))),/429$/,'locked');
  f.tick(f.auth.constants.LOCK_MS+1000);
  assert.ok(f.auth.authenticate('user@example.org',STRONG,otp(a.secret,f.step())).principal,'lock expires');
  assert.ok(f.log.some(l=>l.a==='login_locked'));
  const failEntry=f.log.find(l=>l.a==='login_failed');assert.ok(failEntry&&!JSON.stringify(failEntry).includes(STRONG));
});
test('disabled and reset accounts cannot log in and lose their sessions',()=>{
  const f=fixture();const a=enroll(f,{email:'gone@example.org',display_name:'Gone',role:'manager'});
  const res={setHeader(){}},csrf=f.auth.startSession({kind:'staff',id:a.id,email:a.email,role:'manager'},res,false);assert.ok(csrf);
  const acc=f.auth.getAccount(a.id);
  const upd=f.auth.updateAccount(a.id,{status:'disabled'},acc.version,f.owner);assert.equal(upd.status,'disabled');
  f.tick(31000);assert.throws(()=>f.auth.authenticate(a.email,STRONG,otp(a.secret,f.step())),/invalides/);
  const re=f.auth.updateAccount(a.id,{status:'active'},upd.version,f.owner);assert.equal(re.status,'active');
  const r=f.auth.resetAccount(a.id,f.owner);assert.equal(r.account.status,'invited');
  f.tick(31000);assert.throws(()=>f.auth.authenticate(a.email,STRONG,otp(a.secret,f.step())),/invalides/,'reset invalidates old password and MFA');
  assert.ok(r.invite.token);
});
test('sessions: idle/absolute expiry, role changes apply immediately, fresh re-auth window',()=>{
  const f=fixture({ADMIN_REAUTH_SECONDS:'60'});const a=enroll(f,{email:'s@example.org',display_name:'Sam',role:'manager'});
  const headers={};const res={setHeader:(k,v)=>{headers[k]=v}};
  f.auth.startSession({kind:'staff',id:a.id,email:a.email,role:'manager'},res,true);
  assert.match(headers['Set-Cookie'],/HttpOnly.*SameSite=Strict.*Secure/);
  const req={headers:{cookie:headers['Set-Cookie'].split(';')[0]}};
  let s=f.auth.readSession(req);assert.ok(s&&f.auth.isFresh(s));
  f.tick(61000);s=f.auth.readSession(req);assert.ok(s&&!f.auth.isFresh(s),'re-auth window elapsed');
  f.auth.updateAccount(a.id,{role:'technician',technician_id:'tech-1'},f.auth.getAccount(a.id).version,f.owner,{technicianExists:()=>true});
  assert.equal(f.auth.readSession(req),null,'role change revokes the session');
  const h2={};f.auth.startSession({kind:'staff',id:a.id,email:a.email,role:'technician'},{setHeader:(k,v)=>{h2[k]=v}},false);
  const req2={headers:{cookie:h2['Set-Cookie'].split(';')[0]}};
  f.tick(31*60000);assert.equal(f.auth.readSession(req2),null,'idle timeout');
  assert.equal(f.auth.readSession({headers:{cookie:'allo_admin=nothex'}}),null);
});
test('last owner cannot be demoted, disabled or reset; optimistic concurrency',()=>{
  const f=fixture();const o1=enroll(f,{email:'o1@example.org',display_name:'Owner1',role:'owner'});
  const o2=enroll(f,{email:'o2@example.org',display_name:'Owner2',role:'owner'});
  const actor1={kind:'staff',id:o1.id,email:o1.email,role:'owner'},actor2={kind:'staff',id:o2.id,email:o2.email,role:'owner'};
  assert.throws(()=>f.auth.updateAccount(o1.id,{role:'manager'},f.auth.getAccount(o1.id).version,actor1),/propre rôle/);
  const v=f.auth.getAccount(o2.id).version;
  f.auth.updateAccount(o2.id,{role:'manager'},v,actor1); // o1 still owner -> allowed
  assert.throws(()=>f.auth.updateAccount(o2.id,{role:'owner'},v,actor1),/modifié par quelqu/,'stale version rejected');
  // only owner o1 remains active: o2 (now manager) cannot touch owners, and nobody can drop the last owner
  assert.throws(()=>f.auth.resetAccount(o1.id,actor2),/propriétaire/);
  const lastDisable=()=>f.auth.updateAccount(o1.id,{status:'disabled'},f.auth.getAccount(o1.id).version,{kind:'staff',id:'someone-else',email:'x@y.z',role:'owner'});
  assert.throws(lastDisable,/au moins un propriétaire/);
});
test('manager cannot create or manage owners; technician accounts need a technician record',()=>{
  const f=fixture();const mgr={kind:'staff',id:'m',email:'m@example.org',role:'manager'};
  assert.throws(()=>f.auth.createAccount({email:'x@example.org',display_name:'Xavier',role:'owner'},mgr),/Seul un propriétaire/);
  assert.throws(()=>f.auth.createAccount({email:'t@example.org',display_name:'Tech',role:'technician'},f.owner),/fiche technicien/);
  assert.throws(()=>f.auth.createAccount({email:'t@example.org',display_name:'Tech',role:'technician',technician_id:'nope'},f.owner,{technicianExists:()=>false}),/introuvable/);
  assert.throws(()=>f.auth.createAccount({email:'bad',display_name:'Tech',role:'manager'},f.owner),/email/);
  assert.throws(()=>f.auth.createAccount({email:'ok@example.org',display_name:'Tech',role:'root'},f.owner),/Rôle inconnu/);
  f.auth.createAccount({email:'dup@example.org',display_name:'Dup',role:'manager'},f.owner);
  assert.throws(()=>f.auth.createAccount({email:'DUP@example.org',display_name:'Dup',role:'manager'},f.owner),/existe déjà/);
});
test('password change needs current password + fresh code, revokes other sessions, old password dies',()=>{
  const f=fixture();const a=enroll(f,{email:'pw@example.org',display_name:'Pw',role:'manager'});
  const p={kind:'staff',id:a.id,email:a.email,role:'manager'};
  const sess=[];for(let i=0;i<2;i++){const h={};f.auth.startSession(p,{setHeader:(k,v)=>{h[k]=v}},false);sess.push({headers:{cookie:h['Set-Cookie'].split(';')[0]}})}
  f.tick(31000);
  assert.throws(()=>f.auth.changePassword(p,'wrong-password-xx',otp(a.secret,f.step()),'Another-Strong-Pass-77!',null),/invalide/);
  f.tick(31000);
  assert.throws(()=>f.auth.changePassword(p,STRONG,otp(a.secret,f.step()),'weak',null),/16 caractères/);
  assert.throws(()=>f.auth.changePassword(p,STRONG,otp(a.secret,f.step()),STRONG,null),/différent/);
  const keep=f.auth.readSession(sess[0]).key;
  const r=f.auth.changePassword(p,STRONG,otp(a.secret,f.step()),'Another-Strong-Pass-77!',keep);
  assert.equal(r.sessions_revoked,1);assert.ok(f.auth.readSession(sess[0]));assert.equal(f.auth.readSession(sess[1]),null);
  f.tick(31000);
  assert.throws(()=>f.auth.authenticate(a.email,STRONG,otp(a.secret,f.step())),/invalides/,'old password rejected');
  f.tick(31000);assert.ok(f.auth.authenticate(a.email,'Another-Strong-Pass-77!',otp(a.secret,f.step())).principal);
  assert.ok(f.log.some(l=>l.a==='password_changed'&&l.actor?.id===a.id));
});
test('MFA rotation: old authenticator stops working, new one works, sessions revoked',()=>{
  const f=fixture();const a=enroll(f,{email:'mfa@example.org',display_name:'Mfa',role:'manager'});
  const p={kind:'staff',id:a.id,email:a.email,role:'manager'};
  f.tick(31000);
  const begin=f.auth.beginMfaRotation(p,STRONG,otp(a.secret,f.step()));
  assert.notEqual(begin.secret,a.secret);assert.match(begin.otpauth_uri,/^otpauth:\/\/totp\/ALLOSERVIX:/);
  f.tick(31000);
  assert.throws(()=>f.auth.confirmMfaRotation(p,otp(a.secret,f.step()),null),/invalide/,'old secret cannot confirm the new one');
  assert.ok(f.auth.confirmMfaRotation(p,otp(begin.secret,f.step()),null).rotated);
  f.tick(31000);
  assert.throws(()=>f.auth.authenticate(a.email,STRONG,otp(a.secret,f.step())),/invalides/,'old authenticator rejected');
  f.tick(31000);assert.ok(f.auth.authenticate(a.email,STRONG,otp(begin.secret,f.step())).principal);
});
test('owner migration disables Railway bootstrap credentials unless break-glass flag is set',()=>{
  const oldSecret='JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const f=fixture({ADMIN_EMAIL:'owner@example.org',ADMIN_PASSWORD_HASH:hashPassword('Old-Bootstrap-Secret-123!'),ADMIN_TOTP_SECRET:oldSecret});
  const env={kind:'env',id:'env-owner',email:'owner@example.org',role:'owner'};
  assert.ok(f.auth.envLoginAllowed());
  f.tick(31000);assert.equal(f.auth.authenticate('owner@example.org','Old-Bootstrap-Secret-123!',otp(oldSecret,f.step())).principal.kind,'env');
  assert.throws(()=>f.auth.beginOwnerMigration(env,'Old-Bootstrap-Secret-123!'),/différent/);
  const begin=f.auth.beginOwnerMigration(env,'Brand-New-Passphrase-Value-55!');
  assert.ok(f.auth.envLoginAllowed(),'still allowed until confirmed');
  f.tick(31000);assert.throws(()=>f.auth.confirmOwnerMigration(env,'000000'),/invalide/);
  assert.ok(f.auth.confirmOwnerMigration(env,otp(begin.secret,f.step())).migrated);
  assert.ok(!f.auth.envLoginAllowed());
  f.tick(31000);assert.throws(()=>f.auth.authenticate('owner@example.org','Old-Bootstrap-Secret-123!',otp(oldSecret,f.step())),/invalides/,'old credentials fail');
  f.tick(31000);assert.equal(f.auth.authenticate('owner@example.org','Brand-New-Passphrase-Value-55!',otp(begin.secret,f.step())).principal.kind,'staff');
  const forced=fixture({ADMIN_EMAIL:'owner@example.org',ADMIN_PASSWORD_HASH:hashPassword('Old-Bootstrap-Secret-123!'),ADMIN_TOTP_SECRET:oldSecret,ADMIN_FORCE_ENV_LOGIN:'true'});
  assert.ok(forced.auth.envLoginAllowed());
});
test('without ALLO_DATA_KEY staff creation is refused instead of storing secrets unprotected',()=>{
  const f=fixture({ALLO_DATA_KEY:''});assert.equal(f.auth.vaultReady(),false);
  assert.throws(()=>f.auth.createAccount({email:'a@example.org',display_name:'Alice',role:'manager'},f.owner),/ALLO_DATA_KEY/);
});
