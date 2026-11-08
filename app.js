'use strict';

const state = { products: [], receipts: [], consumptions: [], month: currentMonth(), view: 'dashboard', busy: false, editing: null };
const byId = (id) => document.getElementById(id);
const PRODUCT_FALLBACK = [
  { id: 'hydrosulfite', name: 'Hydrosulfite', unit: 'Kg', initial_stock: 0, active: true },
  { id: 'soude-caustique', name: 'Soude caustique', unit: 'Kg', initial_stock: 0, active: true },
  { id: 'eau-oxygenee', name: 'Eau oxygénée', unit: 'Kg', initial_stock: 0, active: true },
  { id: 'acide-acetique', name: 'Acide acétique', unit: 'Kg', initial_stock: 0, active: true }
];

function currentMonth() { return localDate().slice(0, 7); }
function localDate() { const d = new Date(); const tz = d.getTimezoneOffset(); return new Date(d.getTime() - tz * 60000).toISOString().slice(0, 10); }
function monthStart(month) { return `${month}-01`; }
function nextMonthStart(month) { const [y,m] = month.split('-').map(Number); return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2,'0')}-01`; }
function monthTitle(month) { const [y,m] = month.split('-').map(Number); return new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function fmt(value) { return new Intl.NumberFormat('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:3}).format(num(value)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function setBusy(busy) { state.busy = busy; document.body.classList.toggle('loading', busy); }
function showMessage(message, kind='success') { const el=byId('appMessage'); el.textContent=message; el.className=`app-message ${kind}`; el.classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'}); setTimeout(()=>el.classList.add('hidden'),6500); }
function setFormError(id, message='') { byId(id).textContent=message; }

async function api(action, payload={}) {
  const response = await fetch('/api/inventory', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify({action,payload}) });
  let result;
  try { result = await response.json(); } catch (_) { throw new Error(`Réponse serveur illisible (HTTP ${response.status}).`); }
  if (!response.ok || !result.ok) throw new Error(result.error || `Erreur serveur (HTTP ${response.status}).`);
  return result.data;
}

async function login(pin) {
  const data = await api('login',{pin});
  if (!data.authenticated) throw new Error('Code d’accès refusé.');
  byId('loginScreen').classList.add('hidden'); byId('appShell').classList.remove('hidden');
  await loadData();
}
async function loadData() {
  setBusy(true);
  try {
    const data = await api('bootstrap');
    state.products = Array.isArray(data.products) && data.products.length ? data.products : PRODUCT_FALLBACK;
    state.receipts = data.receipts || []; state.consumptions = data.consumptions || [];
    renderAll();
  } catch (error) {
    if (/session|authentification|401/i.test(error.message)) { byId('appShell').classList.add('hidden'); byId('loginScreen').classList.remove('hidden'); }
    showMessage(error.message,'error');
  } finally { setBusy(false); }
}
function productName(id) { return state.products.find(p=>p.id===id)?.name || id; }
function movementsFor(productId) {
  const rows=[];
  state.receipts.filter(r=>r.product_id===productId).forEach(r=>rows.push({...r,type:'entry'}));
  state.consumptions.filter(r=>r.product_id===productId).forEach(r=>rows.push({...r,type:'exit'}));
  return rows;
}
function openEditRecord(record){
  state.editing=record;
  const modal=byId('editModal');
  byId('editRecordType').value=record.type==='entry'?'receipt':'consumption';
  byId('editRecordId').value=record.id;
  byId('editDate').value=record.date||'';
  byId('editQuantity').value=num(record.quantity);
  const product=state.products.find(p=>p.id===record.product_id);
  byId('editProduct').value=product?product.name:record.product_id;
  byId('editProduct').disabled=true;
  if(record.type==='entry'){
    byId('editTypeLabel').textContent='تعديل استقبال';
    byId('editExtraLabel').textContent='المورد / المرجع';
    byId('editExtraValue').value=record.supplier||record.reference||'';
    byId('editExtraGroup').classList.remove('hidden');
    byId('editReasonGroup').classList.add('hidden');
    byId('editDepartmentGroup').classList.add('hidden');
  }else{
    byId('editTypeLabel').textContent='تعديل استهلاك';
    byId('editExtraLabel').textContent='السبب / الوجهة';
    byId('editExtraValue').value=record.reason||record.department||'';
    byId('editExtraGroup').classList.remove('hidden');
    byId('editReasonGroup').classList.add('hidden');
    byId('editDepartmentGroup').classList.add('hidden');
  }
  modal.classList.remove('hidden');
}
function closeEditRecord(){
  state.editing=null;
  byId('editModal').classList.add('hidden');
  byId('editError').textContent='';
}
async function saveEditRecord(){
  if(!state.editing)return;
  const type=byId('editRecordType').value;
  const id=byId('editRecordId').value;
  const date=byId('editDate').value;
  const quantity=num(byId('editQuantity').value);
  const extra=byId('editExtraValue').value.trim();
  if(!date||quantity<=0){byId('editError').textContent='تأكد من التاريخ والكمية.';return;}
  const payload={type,record_id:id,date,quantity};
  if(type==='receipt'){payload.supplier=extra;}
  else{payload.reason=extra;payload.department=byId('editDepartmentValue')?byId('editDepartmentValue').value:'';}
  try{
    setBusy(true);
    await api('update_record',payload);
    closeEditRecord();
    await loadData();
    showMessage('تم تعديل السجل بنجاح.','success');
  }catch(err){
    byId('editError').textContent=err.message;
  }finally{
    setBusy(false);
  }
}
function calculateProduct(product, month) {
  const start=monthStart(month), end=nextMonthStart(month);
  const movements=movementsFor(product.id);
  const before=movements.filter(m=>m.date<start);
  const during=movements.filter(m=>m.date>=start && m.date<end);
  const opening=num(product.initial_stock)+before.reduce((s,m)=>s+(m.type==='entry'?num(m.quantity):-num(m.quantity)),0);
  const entries=during.filter(m=>m.type==='entry').reduce((s,m)=>s+num(m.quantity),0);
  const exits=during.filter(m=>m.type==='exit').reduce((s,m)=>s+num(m.quantity),0);
  return {opening,entries,exits,closing:opening+entries-exits};
}
function allCurrentRows() { return state.products.filter(p=>p.active!==false).map(p=>({product:p,...calculateProduct(p,state.month)})); }
function renderDashboard() {
  const rows=allCurrentRows();
  byId('monthLabel').textContent=monthTitle(state.month);
  byId('statProducts').textContent=rows.length;
  byId('statEntries').textContent=rows.filter(r=>r.entries>0).length;
  byId('statUsed').textContent=rows.filter(r=>r.exits>0).length;
  byId('statBalance').textContent=`${rows.filter(r=>r.closing>0).length} / ${rows.length}`;
  byId('stockTableBody').innerHTML=rows.map(r=>`<tr><td class="product-name">${escapeHtml(r.product.name)}</td><td>${escapeHtml(r.product.unit)}</td><td class="quantity">${fmt(r.opening)}</td><td class="quantity">${fmt(r.entries)}</td><td class="quantity">${fmt(r.exits)}</td><td class="quantity">${fmt(r.closing)}</td><td><span class="balance-pill ${r.closing<=0?'low':''}">${r.closing<=0?'Stock nul':'Disponible'}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">Aucun produit actif.</td></tr>';
  const recent=[...state.receipts.map(r=>({...r,type:'entry'})),...state.consumptions.map(r=>({...r,type:'exit'}))].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.created_at||'').localeCompare(a.created_at||'')).slice(0,8);
  byId('recentTableBody').innerHTML=recent.map(m=>`<tr><td>${escapeHtml(m.date)}</td><td><span class="movement-tag ${m.type}">${m.type==='entry'?'Entrée':'Sortie'}</span></td><td>${escapeHtml(productName(m.product_id))}</td><td class="quantity">${fmt(m.quantity)} kg</td><td>${escapeHtml(m.reference||m.reason||m.supplier||m.department||'—')}</td><td class="actions"><button class="btn-edit" data-id="${escapeHtml(m.id)}" data-type="${escapeHtml(m.type)}">تعديل</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Aucun mouvement enregistré pour le moment.</td></tr>';
}
function renderProductSelectors() {
  const active=state.products.filter(p=>p.active!==false);
  byId('consumptionProduct').innerHTML=active.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  byId('receiptProducts').innerHTML=active.map(p=>`<div class="quantity-item"><label for="receipt-${escapeHtml(p.id)}">${escapeHtml(p.name)} (Kg)</label><input id="receipt-${escapeHtml(p.id)}" data-product-id="${escapeHtml(p.id)}" type="number" min="0" step="0.001" value="0"><small>Quantité livrée ce mois</small></div>`).join('');
  byId('initialStockFields').innerHTML=active.map(p=>`<div class="quantity-item"><label for="initial-${escapeHtml(p.id)}">${escapeHtml(p.name)} — Stock de départ (Kg)</label><input id="initial-${escapeHtml(p.id)}" data-product-id="${escapeHtml(p.id)}" type="number" min="0" step="0.001" value="${num(p.initial_stock)}"><small>Valeur de départ enregistrée : ${fmt(p.initial_stock)} Kg</small></div>`).join('');
}
function renderReceiptState() {
  const hasReceipt=state.receipts.some(r=>(r.month||r.date?.slice(0,7))===state.month);
  byId('receiptAlreadyExists').classList.toggle('hidden',!hasReceipt);
  byId('receiptForm').classList.toggle('hidden',hasReceipt);
  byId('receiptDate').value=localDate().slice(0,7)===state.month?localDate():`${state.month}-01`;
}
function renderReport() {
  const rows=allCurrentRows();
  byId('reportMonth').textContent=monthTitle(state.month);
  byId('reportGenerated').textContent=localDate();
  byId('reportTableBody').innerHTML=rows.map(r=>`<tr><td>${escapeHtml(r.product.name)}</td><td>${escapeHtml(r.product.unit)}</td><td>${fmt(r.opening)}</td><td>${fmt(r.entries)}</td><td>${fmt(r.exits)}</td><td><strong>${fmt(r.closing)}</strong></td></tr>`).join('');
}
function renderAll() { byId('monthPicker').value=state.month; renderProductSelectors(); renderDashboard(); renderReceiptState(); renderReport(); }
function navigate(view) {
  state.view=view;
  document.querySelectorAll('.view-section').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const titles={dashboard:'Vue d’ensemble',receipts:'Réception mensuelle',consumption:'Consommation',reports:'Rapports',settings:'Stock initial'};
  byId('pageTitle').textContent=titles[view]||'Stock sensible';
  if(view==='receipts') renderReceiptState(); if(view==='reports') renderReport();
}

byId('loginForm').addEventListener('submit',async e=>{e.preventDefault();byId('loginError').textContent='';const pin=byId('accessPin').value;try{setBusy(true);await login(pin);byId('accessPin').value='';}catch(err){byId('loginError').textContent=err.message;}finally{setBusy(false);}});
document.querySelectorAll('.nav-link').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.view)));
document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
byId('monthPicker').addEventListener('change',e=>{if(e.target.value){state.month=e.target.value;renderAll();}});
byId('refreshBtn').addEventListener('click',loadData);
byId('logoutBtn').addEventListener('click',async()=>{try{await api('logout');}catch(_){}byId('appShell').classList.add('hidden');byId('loginScreen').classList.remove('hidden');});

byId('receiptForm').addEventListener('submit',async e=>{
  e.preventDefault();setFormError('receiptError');
  const date=byId('receiptDate').value;
  if(!date||date.slice(0,7)!==state.month){setFormError('receiptError','La date doit appartenir au mois sélectionné.');return;}
  const items=[...document.querySelectorAll('#receiptProducts input')].map(input=>({product_id:input.dataset.productId,quantity:num(input.value)})).filter(x=>x.quantity>0);
  if(!items.length){setFormError('receiptError','Saisissez au moins une quantité positive.');return;}
  try{setBusy(true);await api('save_receipt_batch',{date,items,supplier:byId('receiptSupplier').value.trim(),reference:byId('receiptReference').value.trim(),note:byId('receiptNote').value.trim()});await loadData();navigate('dashboard');showMessage('Réception mensuelle enregistrée avec succès.');byId('receiptForm').reset();}catch(err){setFormError('receiptError',err.message);}finally{setBusy(false);}
});
byId('consumptionForm').addEventListener('submit',async e=>{
  e.preventDefault();setFormError('consumptionError');
  const payload={date:byId('consumptionDate').value,product_id:byId('consumptionProduct').value,quantity:num(byId('consumptionQuantity').value),department:byId('consumptionDepartment').value.trim(),reason:byId('consumptionReason').value.trim(),reference:byId('consumptionReference').value.trim(),note:byId('consumptionNote').value.trim()};
  if(!payload.date||!payload.product_id||payload.quantity<=0){setFormError('consumptionError','Vérifiez la date, le produit et la quantité.');return;}
  try{setBusy(true);await api('save_consumption',payload);byId('consumptionForm').reset();byId('consumptionDate').value=localDate();await loadData();navigate('dashboard');showMessage('Sortie enregistrée. Le stock a été recalculé.');}catch(err){setFormError('consumptionError',err.message);}finally{setBusy(false);}
});
byId('initialStockForm').addEventListener('submit',async e=>{
  e.preventDefault();setFormError('initialError');
  const stocks=[...document.querySelectorAll('#initialStockFields input')].map(input=>({product_id:input.dataset.productId,quantity:num(input.value)}));
  try{setBusy(true);await api('update_initial_stock',{stocks});await loadData();showMessage('Stocks initiaux mis à jour.');}catch(err){setFormError('initialError',err.message);}finally{setBusy(false);}
});
byId('printBtn').addEventListener('click',()=>{renderReport();window.print();});
byId('csvBtn').addEventListener('click',()=>{
  const rows=allCurrentRows();const data=[['Produit','Unité','Stock initial','Entrée','Sortie','Stock final'],...rows.map(r=>[r.product.name,r.product.unit,r.opening,r.entries,r.exits,r.closing])];
  const csv='\uFEFF'+data.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`rapport-stock-sensible-${state.month}.csv`;a.click();URL.revokeObjectURL(url);
});

byId('monthPicker').value=state.month;byId('receiptDate').value=localDate();byId('consumptionDate').value=localDate();

byId('editForm').addEventListener('submit',async e=>{e.preventDefault();await saveEditRecord();});
byId('editCancelBtn').addEventListener('click',closeEditRecord);
byId('editCloseBtn').addEventListener('click',closeEditRecord);
byId('editModal').addEventListener('click',e=>{if(e.target===byId('editModal'))closeEditRecord();});
document.addEventListener('click',e=>{
  const btn=e.target.closest('.btn-edit');
  if(btn){
    const record=[...state.receipts,...state.consumptions].find(r=>r.id===btn.dataset.id);
    if(record){record.type=btn.dataset.type==='entry'?'entry':'exit';openEditRecord(record);}
  }
});
