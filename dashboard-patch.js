/* ============================================================
   DASHBOARD PATCH — วางใน index.html ของ Gold-floor888
   ------------------------------------------------------------
   แก้ปัญหา "จอไม่อัพแล้วไม่รู้ว่าทำไม"
   ของเดิมพังแล้วขึ้นแค่ "● MOCK" เฉยๆ ต้องมานั่งไล่เดาทีละข้อ
   ============================================================ */

/* ---------- 1) ให้มันฟ้องว่าพังเพราะอะไร ---------- */

async function loadLive(){
  const dot = document.getElementById('livedot');
  try{
    const res  = await fetch(ENDPOINT, {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);

    const text = await res.text();

    // Apps Script ที่ตั้งสิทธิ์ผิดจะคืนหน้า HTML ล็อกอิน ไม่ใช่ JSON
    // ของเดิม JSON.parse พังแล้วตกไป mock เงียบๆ — เลยไม่มีทางรู้ว่าเป็นเพราะสิทธิ์
    if(text.trim().charAt(0) === '<'){
      throw new Error('ได้ HTML ไม่ใช่ JSON → ตั้ง Who has access = Anyone');
    }

    const p = JSON.parse(text);
    mergeLive(p);
    renderAll();
    setStatus(true, p.updated);

    // เตือนถ้าข้อมูลค้าง — บอทยิง Telegram อยู่ แต่ /exec อาจเสิร์ฟเวอร์ชันเก่า
    const age = dataAgeMin(p.updated);
    if(age !== null && age > 90){
      dot.textContent = '● ค้าง ' + Math.round(age/60) + ' ชม.';
      dot.style.color = 'var(--gold)';
      dot.title = 'ดึงได้แต่ข้อมูลเก่า — น่าจะยังไม่ได้ Deploy version ใหม่';
    }
  }catch(err){
    setStatus(false);
    dot.textContent = '● MOCK — ' + err.message;
    dot.style.color = 'var(--down)';
    dot.title = String(err);
    console.error('ดึงข้อมูลไม่ได้:', err);
  }
}

// อายุข้อมูลเป็นนาที (รับรูปแบบ "yyyy-MM-dd HH:mm")
function dataAgeMin(updated){
  if(!updated) return null;
  const t = new Date(String(updated).replace(' ', 'T'));
  if(isNaN(t)) return null;
  return (Date.now() - t.getTime()) / 60000;
}

/* ---------- 2) รับ anchor จาก JANIE ---------- */
/* เพิ่ม 4 บรรทัดนี้เข้าไปในฟังก์ชัน mergeLive() ที่มีอยู่แล้ว */

function mergeLiveAnchor(p, DATA){
  if(p.anchor     != null && p.anchor     !== '') DATA.anchor     = Number(p.anchor);
  if(p.sd1        != null && p.sd1        !== '') DATA.sd1        = Number(p.sd1);
  if(p.anchorTime)                                DATA.anchorTime = String(p.anchorTime);
  if(p.contract)                                  DATA.contract   = String(p.contract);
}

/* ---------- 3) โชว์ anchor บนจอ ---------- */
/* เรียกใน renderAll() — วางป้ายไว้ข้างหัวข้อ Zones · SD */

function renderAnchorBadge(DATA){
  const el = document.getElementById('sdmeta');
  if(!el) return;

  if(DATA.anchor){
    el.textContent = 'anchor ' + Math.round(DATA.anchor).toLocaleString()
                   + ' · ตรึง ' + (DATA.anchorTime || '—')
                   + ' · 1SD ' + DATA.sd1;
    el.style.color = 'var(--up)';
  }else{
    // ไม่มี anchor = เส้น SD ยังเลื่อนตามราคาอยู่ ต้องเห็นชัดๆ ห้ามซ่อน
    el.textContent = '⚠️ ยังไม่ตรึง anchor — เส้น SD ยังเชื่อไม่ได้';
    el.style.color = 'var(--down)';
  }
}

/* ============================================================
   วิธีวาง

   1. เปิด index.html ของ Gold-floor888
   2. หาฟังก์ชัน loadLive() เดิม → ลบทิ้ง → วางตัวใหม่ข้างบนแทน
   3. วาง dataAgeMin / mergeLiveAnchor / renderAnchorBadge เพิ่มเข้าไป
   4. ในฟังก์ชัน mergeLive() เดิม เพิ่มบรรทัดนี้ท้ายสุด:
          mergeLiveAnchor(p, DATA);
   5. ในฟังก์ชัน renderAll() เดิม เพิ่มบรรทัดนี้:
          renderAnchorBadge(DATA);
   6. ให้ buildSD() ใน sd-anchor-patch.js เป็นตัวสร้างเส้น SD แทนของเดิม

   Commit → GitHub Pages ขึ้นเองใน 1-2 นาที
   ============================================================ */
