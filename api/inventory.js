'use strict';
const crypto = require('crypto');

function cookieValue(cookieHeader, name) {
  const parts = String(cookieHeader || '').split(';');
  for (const part of parts) { const i=part.trim().indexOf('='); if(i>0 && part.trim().slice(0,i)===name) return part.trim().slice(i+1); }
  return '';
}
function signature(value, secret) { return crypto.createHmac('sha256',secret).update(value).digest('hex'); }
function safeEqual(a,b) { const aa=Buffer.from(String(a));const bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb); }
function validSession(req) {
  const secret=process.env.SESSION_SECRET; if(!secret) return false;
  const token=cookieValue(req.headers.cookie,'chem_session'); const [issued,sig]=token.split('.');
  if(!issued||!sig||!/^\d+$/.test(issued)) return false;
  const age=Date.now()-Number(issued); if(age<0||age>8*60*60*1000) return false;
  return safeEqual(sig,signature(issued,secret));
}
function send(res,status,body) { res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body)); }

module.exports = async (req,res) => {
  if(req.method!=='POST') return send(res,405,{ok:false,error:'Méthode non autorisée.'});
  const origin=req.headers.origin;
  if(origin){try{const u=new URL(origin);if(u.host!==req.headers.host)return send(res,403,{ok:false,error:'Origine de requête non autorisée.'});}catch(_){return send(res,403,{ok:false,error:'Origine invalide.'});}}
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body);}catch(_){return send(res,400,{ok:false,error:'Corps JSON invalide.'});}}
  if(!body||typeof body!=='object') return send(res,400,{ok:false,error:'Requête invalide.'});
  const action=String(body.action||'');const payload=body.payload||{};

  if(action==='login'){
    const pin=String(payload.pin||'');const configured=process.env.APP_ACCESS_PIN;const secret=process.env.SESSION_SECRET;
    if(!configured||!secret)return send(res,503,{ok:false,error:'Configuration manquante : APP_ACCESS_PIN et SESSION_SECRET doivent être définis dans Vercel.'});
    if(!safeEqual(pin,configured))return send(res,401,{ok:false,error:'Code d’accès incorrect.'});
    const issued=String(Date.now());const sig=signature(issued,secret);
    res.setHeader('Set-Cookie',`chem_session=${issued}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return send(res,200,{ok:true,data:{authenticated:true}});
  }
  if(action==='logout'){
    res.setHeader('Set-Cookie','chem_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return send(res,200,{ok:true,data:{loggedOut:true}});
  }
  if(!validSession(req))return send(res,401,{ok:false,error:'Session expirée ou non authentifiée. Reconnectez-vous.'});

  const scriptUrl=process.env.CHEMICALS_WEBHOOK_URL;const token=process.env.CHEMICALS_WEBHOOK_TOKEN;
  if(!scriptUrl||!token)return send(res,503,{ok:false,error:'Configuration Google manquante dans les variables Vercel.'});
  try{
    const upstream=await fetch(scriptUrl,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action,payload})});
    const contentType=upstream.headers.get('content-type')||'';const raw=await upstream.text();
    let parsed;
    try{parsed=JSON.parse(raw);}catch(_){
      const isHtml=/html/i.test(contentType)||/^\s*<!doctype html|^\s*<html/i.test(raw);
      const message=isHtml
        ? `Google Apps Script a renvoyé une page HTML (HTTP ${upstream.status}). Vérifiez le déploiement Web App, l’accès "Anyone" et l’URL /exec active.`
        : `Réponse Google non JSON (HTTP ${upstream.status}, ${contentType||'type inconnu'}).`;
      return send(res,502,{ok:false,error:message});
    }
    if(!upstream.ok)return send(res,502,{ok:false,error:parsed.error||`Erreur Google Apps Script (HTTP ${upstream.status}).`});
    if(parsed.ok===false||parsed.status==='error')return send(res,400,{ok:false,error:parsed.error||'Google Apps Script a refusé la requête.'});
    return send(res,200,{ok:true,data:parsed.data!==undefined?parsed.data:parsed});
  }catch(error){
    return send(res,502,{ok:false,error:`Impossible de joindre Google Apps Script : ${error.message}`});
  }
};
