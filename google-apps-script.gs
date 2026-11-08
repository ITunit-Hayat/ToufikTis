/**
 * Chemical Inventory - Google Apps Script backend
 * Create/open the Google Sheet, then paste this complete file into Apps Script.
 * Script Properties required: SPREADSHEET_ID and WEBHOOK_TOKEN.
 */
const CI_SHEETS = {
  products: 'Products',
  receipts: 'Receipts',
  consumption: 'Consumption',
  audit: 'Audit'
};
const CI_HEADERS = {
  Products: ['id','name','unit','initial_stock','active'],
  Receipts: ['id','date','month','product_id','quantity','supplier','reference','note','created_at'],
  Consumption: ['id','date','month','product_id','quantity','department','reason','reference','note','created_at'],
  Audit: ['timestamp','action','record_id','product_id','quantity','date','details']
};
const CI_DEFAULT_PRODUCTS = [
  ['hydrosulfite','Hydrosulfite','Kg',0,true],
  ['soude-caustique','Soude caustique','Kg',0,true],
  ['eau-oxygenee','Eau oxygénée','Kg',0,true],
  ['acide-acetique','Acide acétique','Kg',0,true]
];

// Spreadsheet selected by the user. Script Property SPREADSHEET_ID, when set, takes precedence.
const CI_CONFIGURED_SPREADSHEET_ID = '1sQWFalptwPSxu25Dh_oGn1fO7RFMo65JX0K3sBpKegw';

function doGet() {
  return ciJson_({ok:true,status:'ok',service:'chemical-inventory',message:'Web App actif. Utilisez POST via le serveur Vercel pour accéder aux données.'});
}
function doPost(e) {
  const lock=LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const request=JSON.parse(e && e.postData && e.postData.contents || '{}');
    const expected=PropertiesService.getScriptProperties().getProperty('WEBHOOK_TOKEN');
    if(!expected || !ciSafeEqual_(String(request.token||''),expected)) return ciJson_({ok:false,error:'Unauthorized. Vérifiez WEBHOOK_TOKEN.'});
    const ss=ciSpreadsheet_();ciEnsureSheets_(ss);
    const action=String(request.action||'');const payload=request.payload||{};
    let data;
    switch(action){
      case 'bootstrap': data=ciBootstrap_(ss);break;
      case 'save_receipt_batch': data=ciSaveReceiptBatch_(ss,payload);break;
      case 'save_consumption': data=ciSaveConsumption_(ss,payload);break;
      case 'update_initial_stock': data=ciUpdateInitialStock_(ss,payload);break;
      case 'update_record': data=ciUpdateRecord_(ss,payload);break;
      default: throw new Error('Action inconnue.');
    }
    return ciJson_({ok:true,data:data});
  } catch(err) {
    return ciJson_({ok:false,error:err && err.message ? err.message : String(err)});
  } finally {
    try{lock.releaseLock();}catch(_){ }
  }
}
function ciJson_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function ciSafeEqual_(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function ciSpreadsheet_(){
  const propertyId=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const id=CI_CONFIGURED_SPREADSHEET_ID || propertyId;
  if(id)return SpreadsheetApp.openById(id);
  const active=SpreadsheetApp.getActiveSpreadsheet();
  if(active)return active;
  throw new Error('SPREADSHEET_ID est absent de la configuration.');
}
function ciEnsureSheets_(ss){
  Object.keys(CI_HEADERS).forEach(name=>{
    let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);
    const headers=CI_HEADERS[name];
    if(sh.getLastRow()===0){sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);sh.getRange(1,1,1,headers.length).setFontWeight('bold');}
    else{
      const current=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0].map(String);
      const missing=headers.filter(h=>current.indexOf(h)===-1);
      if(missing.length)throw new Error('En-têtes incompatibles dans la feuille '+name+'. Colonnes manquantes : '+missing.join(', '));
    }
  });
  const p=ss.getSheetByName(CI_SHEETS.products);
  if(p.getLastRow()===1)p.getRange(2,1,CI_DEFAULT_PRODUCTS.length,5).setValues(CI_DEFAULT_PRODUCTS);
}
function ciRows_(sh){
  const values=sh.getDataRange().getValues();if(values.length<2)return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!==null)).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]);return o;});
}
function ciProducts_(ss){return ciRows_(ss.getSheetByName(CI_SHEETS.products)).map(p=>({id:String(p.id),name:String(p.name),unit:String(p.unit||'Kg'),initial_stock:Number(p.initial_stock)||0,active:String(p.active).toLowerCase()!=='false'}));}
function ciTransactions_(ss){
  const receipts=ciRows_(ss.getSheetByName(CI_SHEETS.receipts)).map(r=>({id:String(r.id),date:ciDate_(r.date),month:String(r.month||ciDate_(r.date).slice(0,7)),product_id:String(r.product_id),quantity:Number(r.quantity)||0,supplier:String(r.supplier||''),reference:String(r.reference||''),note:String(r.note||''),created_at:String(r.created_at||'')}));
  const consumptions=ciRows_(ss.getSheetByName(CI_SHEETS.consumption)).map(r=>({id:String(r.id),date:ciDate_(r.date),month:String(r.month||ciDate_(r.date).slice(0,7)),product_id:String(r.product_id),quantity:Number(r.quantity)||0,department:String(r.department||''),reason:String(r.reason||''),reference:String(r.reference||''),note:String(r.note||''),created_at:String(r.created_at||'')}));
  return {receipts:receipts,consumptions:consumptions};
}
function ciDate_(value){if(value instanceof Date)return Utilities.formatDate(value,Session.getScriptTimeZone(),'yyyy-MM-dd');return String(value||'').slice(0,10);}
function ciValidateDate_(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Date invalide. Utilisez AAAA-MM-JJ.');const d=new Date(date+'T00:00:00Z');if(isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)throw new Error('Date invalide.');return date;}
function ciNumber_(value,label,allowZero){const n=Number(value);if(!isFinite(n)||(allowZero?n<0:n<=0))throw new Error(label+' doit être '+(allowZero?'positive ou égale à zéro':'strictement positive')+'.');return Math.round(n*1000)/1000;}
function ciProductMap_(ss){const map={};ciProducts_(ss).forEach(p=>map[p.id]=p);return map;}
function ciValidateLedger_(products,receipts,consumptions){
  products.forEach(p=>{
    let balance=Number(p.initial_stock)||0;
    const moves=[];
    receipts.filter(x=>x.product_id===p.id).forEach(x=>moves.push({date:x.date,type:0,q:x.quantity}));
    consumptions.filter(x=>x.product_id===p.id).forEach(x=>moves.push({date:x.date,type:1,q:x.quantity}));
    moves.sort((a,b)=>a.date.localeCompare(b.date)||a.type-b.type);
    moves.forEach(m=>{balance+=m.type===0?m.q:-m.q;if(balance < -0.0005)throw new Error('Stock insuffisant pour '+p.name+' à la date '+m.date+'. Le solde deviendrait négatif.');});
  });
}
function ciAudit_(ss,action,recordId,productId,quantity,date,details){ss.getSheetByName(CI_SHEETS.audit).appendRow([new Date(),action,recordId,productId,quantity,date,details||'']);}
function ciBootstrap_(ss){const t=ciTransactions_(ss);return {products:ciProducts_(ss),receipts:t.receipts,consumptions:t.consumptions};}
function ciSaveReceiptBatch_(ss,payload){
  const date=ciValidateDate_(String(payload.date||''));const month=date.slice(0,7);
  const t=ciTransactions_(ss);if(t.receipts.some(r=>r.month===month))throw new Error('Une réception est déjà enregistrée pour '+month+'. La règle prévoit une seule réception mensuelle.');
  const products=ciProductMap_(ss);const items=Array.isArray(payload.items)?payload.items:[];if(!items.length)throw new Error('Aucune quantité à enregistrer.');
  const seen={};const rows=[];const now=new Date().toISOString();
  items.forEach(item=>{const id=String(item.product_id||'');if(!products[id])throw new Error('Produit inconnu : '+id);if(seen[id])throw new Error('Produit répété dans la réception.');seen[id]=true;const q=ciNumber_(item.quantity,'Quantité',false);rows.push([Utilities.getUuid(),date,month,id,q,String(payload.supplier||''),String(payload.reference||''),String(payload.note||''),now]);});
  const sh=ss.getSheetByName(CI_SHEETS.receipts);sh.getRange(sh.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows);
  rows.forEach(r=>ciAudit_(ss,'RECEPTION',r[0],r[3],r[4],r[1],'Réception mensuelle '+month));
  return {saved:rows.length,month:month};
}
function ciSaveConsumption_(ss,payload){
  const date=ciValidateDate_(String(payload.date||''));const products=ciProductMap_(ss);const id=String(payload.product_id||'');if(!products[id])throw new Error('Produit inconnu.');const q=ciNumber_(payload.quantity,'Quantité',false);
  const t=ciTransactions_(ss);const candidate={id:'candidate',date:date,product_id:id,quantity:q};
  ciValidateLedger_(ciProducts_(ss),t.receipts,t.consumptions.concat([candidate]));
  const row=[Utilities.getUuid(),date,date.slice(0,7),id,q,String(payload.department||''),String(payload.reason||''),String(payload.reference||''),String(payload.note||''),new Date().toISOString()];
  const sh=ss.getSheetByName(CI_SHEETS.consumption);sh.appendRow(row);ciAudit_(ss,'CONSOMMATION',row[0],id,q,date,String(payload.reason||payload.department||''));
  return {id:row[0],date:date,product_id:id,quantity:q};
}
function ciUpdateInitialStock_(ss,payload){
  const stocks=Array.isArray(payload.stocks)?payload.stocks:[];if(!stocks.length)throw new Error('Aucun stock initial fourni.');
  const sh=ss.getSheetByName(CI_SHEETS.products);const products=ciProducts_(ss);const map={};products.forEach(p=>map[p.id]=p);
  stocks.forEach(s=>{const id=String(s.product_id||'');if(!map[id])throw new Error('Produit inconnu.');map[id].initial_stock=ciNumber_(s.quantity,'Stock initial',true);});
  const t=ciTransactions_(ss);ciValidateLedger_(Object.keys(map).map(id=>map[id]),t.receipts,t.consumptions);
  const all=ciRows_(sh);const headers=CI_HEADERS.Products;const idCol=headers.indexOf('id')+1;const stockCol=headers.indexOf('initial_stock')+1;
  Object.keys(map).forEach(id=>{const row=all.findIndex(p=>String(p.id)===id);if(row>=0)sh.getRange(row+2,stockCol).setValue(map[id].initial_stock);});
  ciAudit_(ss,'STOCK_INITIAL','', '', '', '', 'Mise à jour des stocks initiaux');
  return {updated:stocks.length};
}
function ciUpdateRecord_(ss,payload){
  const type=String(payload.type||'');
  const id=String(payload.record_id||'');
  if(!id)throw new Error('معرف السجل مطلوب.');
  const sheetName=type==='receipt'?CI_SHEETS.receipts:type==='consumption'?CI_SHEETS.consumption:null;
  if(!sheetName)throw new Error('نوع السجل غير صحيح.');
  const sh=ss.getSheetByName(sheetName);
  const rows=ciRows_(sh);
  const rowIndex=rows.findIndex(r=>String(r.id)===id);
  if(rowIndex===-1)throw new Error('السجل غير موجود.');
  const actualRow=rowIndex+2;
  const headerKey=sheetName===CI_SHEETS.receipts?'Receipts':'Consumption';
  const headers=CI_HEADERS[headerKey];
  const updates={};
  if(payload.quantity!==undefined)updates.quantity=ciNumber_(payload.quantity,'الكمية',false);
  if(payload.date!==undefined){
    const d=ciValidateDate_(String(payload.date));
    updates.date=d;
    updates.month=d.slice(0,7);
  }
  if(payload.supplier!==undefined)updates.supplier=String(payload.supplier||'');
  if(payload.reference!==undefined)updates.reference=String(payload.reference||'');
  if(payload.note!==undefined)updates.note=String(payload.note||'');
  if(payload.department!==undefined)updates.department=String(payload.department||'');
  if(payload.reason!==undefined)updates.reason=String(payload.reason||'');
  if(Object.keys(updates).length===0)throw new Error('لا توجد بيانات للتعديل.');
  Object.entries(updates).forEach(([key,value])=>{
    const col=headers.indexOf(key)+1;
    if(col>0)sh.getRange(actualRow,col).setValue(value);
  });
  if(type==='consumption'||type==='receipt'){
    const t=ciTransactions_(ss);
    ciValidateLedger_(ciProducts_(ss),t.receipts,t.consumptions);
  }
  ciAudit_(ss,type==='receipt'?'UPDATE_RECEPTION':'UPDATE_CONSUMPTION',id,payload.product_id||'',updates.quantity||0,updates.date||'','تعديل سجل '+type);
  return {updated:true,id:id,changes:updates};
}

