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
  Products: ['id','name','unit','active'],
  Receipts: ['id','date','month','product_id','quantity','supplier','reference','note','created_at'],
  Consumption: ['id','date','month','product_id','quantity','department','reason','reference','note','created_at'],
  Audit: ['timestamp','action','record_id','product_id','quantity','date','details']
};
const CI_DEFAULT_PRODUCTS = [
  ['hydrosulfite','Hydrosulfite','Kg',true],
  ['soude-caustique','Soude caustique','Kg',true],
  ['eau-oxygenee','Eau oxygénée','Kg',true],
  ['acide-acetique','Acide acétique','Kg',true],
  ['alpaflame-sco','ALPAFLAME SCO','Kg',true],
  ['alpaguard-fx6','ALPAGUARD FX6','Kg',true],
  ['alpret-vam','ALPRET VAM','Kg',true],
  ['alpadet-lf','ALPADET LF','Kg',true],
  ['alpagal-ipn','ALPAGAL IPN','Kg',true],
  ['sel-adoucisseur','SEL ADOUCISSEUR','Kg',true],
  ['alpawet-fn','ALPAWET FN','Kg',true],
  ['carbonate-de-soude','CARBONATE DE SOUDE','Kg',true],
  ['sel-marine','SEL MARINE','Kg',true],
  ['alpasperse-nbo','ALPASPERSÉ NBO','Kg',true]
];

// Spreadsheet ID: Property SPREADSHEET_ID in Script Properties takes precedence.
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
      case 'update_record': data=ciUpdateRecord_(ss,payload);break;
      case 'delete_record': data=ciDeleteRecord_(ss,payload);break;
      case 'history': data=ciHistory_(ss,payload);break;
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
  const id=propertyId || CI_CONFIGURED_SPREADSHEET_ID;
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
  if(p.getLastRow()===1)p.getRange(2,1,CI_DEFAULT_PRODUCTS.length,CI_HEADERS.Products.length).setValues(CI_DEFAULT_PRODUCTS);
  else if(p.getLastRow()>1){
    const existing=ciRows_(p).map(row=>String(row.id));
    const missing=CI_DEFAULT_PRODUCTS.filter(row=>existing.indexOf(row[0])===-1);
    if(missing.length)p.getRange(p.getLastRow()+1,1,missing.length,CI_HEADERS.Products.length).setValues(missing);
  }
}
function ciRows_(sh){
  const values=sh.getDataRange().getValues();if(values.length<2)return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(v=>v!==''&&v!==null)).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i]);return o;});
}
function ciProducts_(ss){return ciRows_(ss.getSheetByName(CI_SHEETS.products)).map(p=>({id:String(p.id),name:String(p.name),unit:String(p.unit||'Kg'),active:String(p.active).toLowerCase()!=='false'}));}
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
    let balance=0;
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
  const products=ciProductMap_(ss);const items=Array.isArray(payload.items)?payload.items:[];if(!items.length)throw new Error('Aucune quantité à enregistrer.');
  const seen={};const rows=[];const now=new Date().toISOString();
  items.forEach(item=>{
    const id=String(item.product_id||'');
    if(!products[id])throw new Error('Produit inconnu : '+id);
    if(seen[id])throw new Error('Produit répété dans la réception.');
    seen[id]=true;
    const q=ciNumber_(item.quantity,'Quantité',false);
    rows.push([Utilities.getUuid(),date,month,id,q,String(payload.supplier||''),String(payload.reference||''),String(payload.note||''),now]);
  });
  const sh=ss.getSheetByName(CI_SHEETS.receipts);sh.getRange(sh.getLastRow()+1,1,rows.length,rows[0].length).setValues(rows);
  rows.forEach(r=>ciAudit_(ss,'RECEPTION',r[0],r[3],r[4],r[1],'Réception stock '+date));
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
function ciUpdateRecord_(ss,payload){
  const type=String(payload.type||'');
  const id=String(payload.record_id||'');
  if(!id)throw new Error('Identifiant du mouvement requis.');
  const sheetName=type==='receipt'?CI_SHEETS.receipts:type==='consumption'?CI_SHEETS.consumption:null;
  if(!sheetName)throw new Error('Type de mouvement invalide.');
  const sh=ss.getSheetByName(sheetName);
  const lastRow=sh.getLastRow();
  const ids=lastRow>1?sh.getRange(2,1,lastRow-1,1).getDisplayValues().map(row=>String(row[0]).trim()):[];
  const rowIndex=ids.findIndex(rowId=>rowId===id.trim());
  if(rowIndex===-1)throw new Error('Enregistrement introuvable.');
  const actualRow=rowIndex+2;
  const headerKey=sheetName===CI_SHEETS.receipts?'Receipts':'Consumption';
  const headers=CI_HEADERS[headerKey];
  const updates={};
  if(payload.quantity!==undefined)updates.quantity=ciNumber_(payload.quantity,'Quantité',false);
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
  if(Object.keys(updates).length===0)throw new Error('Aucune donnée à modifier.');
  const t=ciTransactions_(ss);
  const ledger=type==='receipt'?t.receipts:t.consumptions;
  const ledgerIndex=ledger.findIndex(r=>String(r.id).trim()===id.trim());
  if(ledgerIndex===-1)throw new Error('Enregistrement introuvable dans le journal de stock.');
  const currentRecord={...ledger[ledgerIndex]};
  const productId=currentRecord.product_id;
  const candidate={...currentRecord,...updates};
  if(updates.date!==undefined)candidate.month=updates.date.slice(0,7);
  const receipts=type==='receipt'?t.receipts.map((r,i)=>i===ledgerIndex?candidate:r):t.receipts;
  const consumptions=type==='consumption'?t.consumptions.map((r,i)=>i===ledgerIndex?candidate:r):t.consumptions;
  ciValidateLedger_(ciProducts_(ss),receipts,consumptions);
  Object.entries(updates).forEach(([key,value])=>{
    const col=headers.indexOf(key)+1;
    if(col<=0)throw new Error('Colonne introuvable pour le champ : '+key);
    sh.getRange(actualRow,col).setValue(value);
  });
  ciAudit_(ss,type==='receipt'?'UPDATE_RECEPTION':'UPDATE_CONSUMPTION',id,productId,updates.quantity!==undefined?updates.quantity:currentRecord.quantity,updates.date||currentRecord.date,'Modification mouvement '+type);
  return {updated:true,id:id,changes:updates};
}
function ciDeleteRecord_(ss,payload){
  const type=String(payload.type||'');
  const id=String(payload.record_id||'');
  if(!id)throw new Error('Identifiant du mouvement requis.');
  const sheetName=type==='receipt'?CI_SHEETS.receipts:type==='consumption'?CI_SHEETS.consumption:null;
  if(!sheetName)throw new Error('Type de mouvement invalide.');
  const sh=ss.getSheetByName(sheetName);
  const lastRow=sh.getLastRow();
  const ids=lastRow>1?sh.getRange(2,1,lastRow-1,1).getDisplayValues().map(row=>String(row[0]).trim()):[];
  const rowIndex=ids.findIndex(rowId=>rowId===id.trim());
  if(rowIndex===-1)throw new Error('Enregistrement introuvable dans la feuille.');
  const actualRow=rowIndex+2;
  const t=ciTransactions_(ss);
  const ledger=type==='receipt'?t.receipts:t.consumptions;
  const ledgerIndex=ledger.findIndex(r=>String(r.id).trim()===id.trim());
  if(ledgerIndex===-1)throw new Error('Enregistrement introuvable dans le journal.');
  const currentRecord=ledger[ledgerIndex];
  const receipts=type==='receipt'?t.receipts.filter((_,i)=>i!==ledgerIndex):t.receipts;
  const consumptions=type==='consumption'?t.consumptions.filter((_,i)=>i!==ledgerIndex):t.consumptions;
  ciValidateLedger_(ciProducts_(ss),receipts,consumptions);
  sh.deleteRow(actualRow);
  ciAudit_(ss,type==='receipt'?'DELETE_RECEPTION':'DELETE_CONSUMPTION',id,currentRecord.product_id,currentRecord.quantity,currentRecord.date,'Suppression mouvement '+type);
  return {deleted:true,id:id};
}
function ciHistory_(ss,payload){
  const t=ciTransactions_(ss);
  const products=ciProductMap_(ss);
  const movements=[];
  t.receipts.forEach(r=>{
    movements.push({
      id:r.id,
      date:r.date,
      month:r.month,
      type:'entry',
      product_id:r.product_id,
      product_name:products[r.product_id]?products[r.product_id].name:r.product_id,
      quantity:Number(r.quantity)||0,
      supplier:String(r.supplier||''),
      reference:String(r.reference||''),
      note:String(r.note||''),
      created_at:String(r.created_at||'')
    });
  });
  t.consumptions.forEach(r=>{
    movements.push({
      id:r.id,
      date:r.date,
      month:r.month,
      type:'exit',
      product_id:r.product_id,
      product_name:products[r.product_id]?products[r.product_id].name:r.product_id,
      quantity:Number(r.quantity)||0,
      department:String(r.department||''),
      reason:String(r.reason||''),
      reference:String(r.reference||''),
      note:String(r.note||''),
      created_at:String(r.created_at||'')
    });
  });
  movements.sort((a,b)=>(b.created_at||b.date||'').localeCompare(a.created_at||a.date||''));
  return {movements:movements,products:ciProducts_(ss)};
}
