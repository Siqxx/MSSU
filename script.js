/* ============================
   Configuration - already filled
   ============================ */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz9FmJzjWDQb4Klu3ba5rke_3Icv0qqHdi81mBDeAxbYLeX46GFD_9JQkuPJnu4vHLlyQ/exec'; // GET/POST JSON
const DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbx9efC0AU0DjFvHst8PPmRTffUVxc22UIMXbVVHMS2vS31KqnrUzIefasOijrARolxh4g/exec'; // optional
const GOOGLE_CLIENT_ID = '507773507877-t1prpckunc9l2700dgfflhfk6jf2de5c.apps.googleusercontent.com';

/* ============================
   Simple IndexedDB wrapper
   ============================ */
let db;
const DB_NAME='mssu_v1', DB_VER=1;
function openDb(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VER);
    r.onupgradeneeded = e=>{
      db=e.target.result;
      if(!db.objectStoreNames.contains('admin')) db.createObjectStore('admin',{keyPath:'id'});
      if(!db.objectStoreNames.contains('edits')) db.createObjectStore('edits',{keyPath:'id'});
    };
    r.onsuccess=()=>{ db=r.result; res(db); };
    r.onerror=e=>rej(e);
  });
}
function put(store,obj){ return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite').objectStore(store).put(obj); tx.onsuccess=()=>res(); tx.onerror=e=>rej(e); });}
function getAll(store){ return new Promise((res,rej)=>{ const arr=[]; const r=db.transaction(store).objectStore(store).openCursor(); r.onsuccess=e=>{ const c=e.target.result; if(c){ arr.push(c.value); c.continue(); } else res(arr); }; r.onerror=e=>rej(e); });}
function del(store,key){ return new Promise((res,rej)=>{ const r=db.transaction(store,'readwrite').objectStore(store).delete(key); r.onsuccess=()=>res(); r.onerror=e=>rej(e); });}

/* ============================
   Helpers
   ============================ */
function uid(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6); }
function nowISO(){ return new Date().toISOString(); }
function fileToDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });}

/* ============================
   App Init
   ============================ */
openDb().then(()=>{ loadAll(); }).catch(console.error);

/* ============================
   Google Sign-In initialization
   ============================ */
window.currentUser = null;
function handleCredentialResponse(response){
  try{
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    window.currentUser = payload.email;
    document.getElementById('signoutBtn').style.display='inline-block';
    document.getElementById('gsiButton').style.display='none';
    // store id_token for posting to server
    window._id_token = response.credential;
  }catch(e){ console.warn('GSI parse error', e); }
}
function initGoogleSignIn(){
  try{
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
    google.accounts.id.renderButton(document.getElementById('gsiButton'), { theme:'outline', size:'small' });
    google.accounts.id.prompt(); // auto prompt
  }catch(e){ console.warn('GSI init error', e); }
}
window.addEventListener('load', ()=>{ if(window.google) initGoogleSignIn(); else setTimeout(initGoogleSignIn,1000); });

/* Sign out */
document.addEventListener('click', (e)=>{
  if(e.target && e.target.id==='signoutBtn'){
    window._id_token = null; window.currentUser = null;
    document.getElementById('signoutBtn').style.display='none';
    document.getElementById('gsiButton').style.display='inline-block';
  }
});

/* ============================
   Admin: save locally + send to server
   ============================ */
async function saveAdminRecord(form, photoFile, soiFile){
  const rec = Object.assign({}, form);
  rec.id = uid();
  rec.createdAt = nowISO();
  rec.createdBy = window.currentUser || 'local';
  // read files as dataURL (store local)
  if(photoFile) try{ rec.photo = await fileToDataURL(photoFile); } catch(e){ console.warn(e); }
  if(soiFile) try{ rec.soi = { name: soiFile.name, data: await fileToDataURL(soiFile) }; } catch(e){ console.warn(e); }

  // save in IndexedDB
  await put('admin', rec);
  // log edit
  await put('edits', { id: uid(), type:'create', recordId: rec.id, by: rec.createdBy, at: rec.createdAt, device: navigator.userAgent });

  // render immediately
  renderAdminRow(rec);
  updateAdminTally();

  // attempt to send files first to Drive_upload (optional)
  try{
    const files = [];
    if(soiFile) files.push({ field:'soi', name: soiFile.name, data: rec.soi.data });
    if(photoFile) files.push({ field:'photo', name: photoFile.name, data: rec.photo });
    let fileUrls = {};
    if(files.length && DRIVE_UPLOAD_URL){
      // send files in separate request (Apps Script Drive uploader should accept JSON {files:[{name,data,field}]})
      const r = await fetch(DRIVE_UPLOAD_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ files })
      });
      if(r.ok){ fileUrls = await r.json(); /* expect {soi:'url', photo:'url'} */ }
    }

    // send record to main SCRIPT_URL
    const payload = { type:'admin', record: rec, fileUrls, id_token: window._id_token || '' };
    await fetch(SCRIPT_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });

  }catch(err){
    console.warn('sync error (will retry later):', err);
  }
}

/* ============================
   Rendering admin list / tally
   ============================ */
function renderAdminRow(rec){
  // try to find adminList in current document (works in iframe)
  const wrap = document.getElementById('adminList');
  if(!wrap) return;
  const div = document.createElement('div'); div.className='card'; div.dataset.id=rec.id;
  div.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center">
      <div style="width:72px">${rec.photo?`<img src="${rec.photo}" style="width:72px;height:72px;object-fit:cover;border-radius:6px">`:'—'}</div>
      <div style="flex:1">
        <div style="font-weight:600">${rec.name||'—'} <span class="muted">${rec.designation?('('+rec.designation+')'):''}</span></div>
        <div class="muted">${rec.unit||''} ${rec.pscDiv?('• '+rec.pscDiv):''}</div>
        <div class="muted">Assign: ${rec.from||'—'} to ${rec.to||(rec.present?'Present':'—')}</div>
        <div class="muted">Status: ${rec.status||'—'} • Action: ${rec.action||'—'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${rec.soi?`<a class="file-link" href="${rec.soi.data}" download="${rec.soi.name}">📄 SOI</a>`:''}
        <button class="small" onclick="editAdmin('${rec.id}')">Edit</button>
        <button class="small" onclick="deleteAdmin('${rec.id}')">Delete</button>
      </div>
    </div>
  `;
  wrap.prepend(div);
}

async function updateAdminTally(){
  const all = await getAll('admin');
  const total = all.length;
  const counts = {};
  all.forEach(r=> counts[r.status]= (counts[r.status]||0)+1);
  const parts = Object.entries(counts).map(([k,v])=>`${k}: ${v}`);
  const node = document.getElementById('adminTally');
  if(node) node.innerHTML = `<b>Total:</b> ${total} • ${parts.join(' • ')}`;
}

/* Edit / Delete */
async function editAdmin(id){
  const all = await getAll('admin');
  const rec = all.find(r=>r.id===id);
  if(!rec) return alert('Record not found');
  // simple edit: load into form then delete old entry so save creates new
  // attempt to access iframe form fields
  try{
    const doc = document;
    document.getElementById('itemNo').value = rec.item||'';
    document.getElementById('fullName').value = rec.name||'';
    document.getElementById('designation').value = rec.designation||'';
    document.getElementById('fromDate').value = rec.from||'';
    document.getElementById('toDate').value = rec.to||'';
    document.getElementById('presentCheck').checked = !!rec.present;
    document.getElementById('collateral').value = rec.collateral||'';
    document.getElementById('collFrom').value = rec.collFrom||'';
    document.getElementById('collTo').value = rec.collTo||'';
    document.getElementById('status').value = rec.status||'';
    document.getElementById('action').value = rec.action||'';
  }catch(e){
    // if iframe context differences, fallback: show alert
  }
  await del('admin', id);
  document.querySelector(`#adminList [data-id="${id}"]`)?.remove();
  updateAdminTally();
}

async function deleteAdmin(id){
  if(!confirm('Delete this personnel record?')) return;
  await del('admin', id);
  await put('edits', { id: uid(), type:'delete', recordId: id, by: window.currentUser||'local', at: nowISO(), device: navigator.userAgent });
  document.querySelector(`#adminList [data-id="${id}"]`)?.remove();
  updateAdminTally();
}

/* Load all from IndexedDB and render */
async function loadAll(){
  const adm = await getAll('admin');
  // if we're inside admin.html iframe, render
  if(document.getElementById('adminList')) adm.forEach(renderAdminRow);
  if(document.getElementById('adminTally')) updateAdminTally();
}

/* Sync from server (doGet) */
async function syncNow(){
  if(!SCRIPT_URL) return alert('SCRIPT_URL not configured');
  try{
    const r = await fetch(SCRIPT_URL);
    if(!r.ok) throw new Error('Fetch failed ' + r.status);
    const rows = await r.json();
    // expect rows as 2D array with header in row 0
    if(Array.isArray(rows) && rows.length>1){
      // optional: map rows to records; here we append each to local DB
      for(let i=1;i<rows.length;i++){
        const row = rows[i];
        const rec = {
          id: uid(),
          item: row[0]||'',
          photo: row[1]||'',
          name: row[2]||'',
          designation: row[3]||'',
          unit: row[4]||'',
          pscDiv: row[5]||'',
          status: row[6]||'',
          from: row[7]||'',
          to: row[8]||'',
          remarks: row[9]||'',
          action: row[10]||'',
          soi: row[11]?{name:row[11],data:row[11]}:'',
          createdBy: row[12]||'server',
          createdAt: row[13]||nowISO()
        };
        await put('admin', rec);
      }
      // refresh UI
      if(document.getElementById('adminList')){ document.getElementById('adminList').innerHTML=''; (await getAll('admin')).forEach(renderAdminRow); updateAdminTally(); }
    }
    alert('Sync complete.');
  }catch(e){ console.warn('sync error', e); alert('Sync failed: ' + e.message); }
}

/* Expose certain functions to admin.html iframe context */
window.saveAdminRecord = saveAdminRecord;
window.renderAdminList = async ()=>{ if(document.getElementById('adminList')){ document.getElementById('adminList').innerHTML=''; (await getAll('ad
