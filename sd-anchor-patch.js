/* ============================================================
   SD ANCHOR PATCH — แก้ปัญหา "เส้น SD เลื่อนตามราคา จนแตะไม่ได้"
   ------------------------------------------------------------
   ปัญหาเดิม: SD คำนวณจากราคาปัจจุบัน → ราคาขยับ 1 จุด เส้นขยับ 1 จุด
              ระยะห่างคงที่ตลอดกาล = ตั้ง limit รอไม่ได้เลย
   ทางแก้:   ตรึง anchor ไว้วันละครั้ง แล้วกาง SD ออกจาก anchor นั้น
   วิธีใช้:  วางทั้งไฟล์นี้ไว้ใน <script> ก่อนฟังก์ชันที่ render SD
             แล้วเปลี่ยนจุดที่สร้างเส้น SD ให้เรียก buildSD()
   ============================================================ */

/* ---------- 1) ANCHOR ---------- */

// ราคาอ้างอิงที่ตรึงไว้ทั้งวัน — ต้องไม่ขยับจนกว่าจะข้ามวัน
function getAnchor(D){
  // ทางที่ถูก: JANIE เขียน anchor ลง Sheet ตอน settle แล้วส่งมากับ payload
  if (D.anchor != null && D.anchor !== '') return Number(D.anchor);

  // fallback กันเหนียว: ล็อกราคาแรกที่เห็นของวัน (ตามเวลาไทย)
  // ⚠️ ค่านี้รีเซ็ตเมื่อรีเฟรชหน้า — ใช้ชั่วคราวเท่านั้น ของจริงต้องมาจาก Sheet
  const day = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Bangkok'});
  if (window.__aDay !== day){
    window.__aDay = day;
    window.__aPx  = Number(D.priceGC);
  }
  return window.__aPx;
}

// anchor มาจากไหน — เอาไปโชว์บนจอ จะได้จับได้ถ้ามันแอบขยับ
function anchorSource(D){
  return (D.anchor != null && D.anchor !== '')
    ? 'ตรึง ' + (D.anchorTime || '05:00')
    : '⚠️ ยังไม่ตรึง (ใช้ราคาแรกของวัน)';
}

/* ---------- 2) เส้น SD ---------- */

// กาง SD ออกจาก anchor ที่ตรึงไว้ ไม่ใช่จากราคาปัจจุบัน
function buildSD(D){
  const a  = getAnchor(D);
  const s  = Number(D.sd1);
  if (!a || !s) return [];
  const r = n => Math.round((a + n*s) * 10) / 10;
  return [
    {label:'+3 SD', price:r(+3), tone:'g',   note:'สวนแรง'},
    {label:'+2 SD', price:r(+2), tone:'y',   note:'จุดสวน'},
    {label:'+1 SD', price:r(+1), tone:'w',   note:'ขอบกรอบวันนี้'},
    {label:'กลาง',  price:r( 0), tone:'mid', note:'—'},
    {label:'-1 SD', price:r(-1), tone:'w',   note:'ขอบกรอบวันนี้'},
    {label:'-2 SD', price:r(-2), tone:'y',   note:'จุดสวน'},
    {label:'-3 SD', price:r(-3), tone:'g',   note:'สวนแรง'},
  ];
}

/* ---------- 3) SL / TP อิงโครงสร้าง ---------- */
/* ของเดิมยัด SL -6 / TP +12 เท่ากันหมดทุกไม้ ไม่ว่าไม้นั้นจะคืออะไร
   ที่ถูกคือ SL ต้องอยู่ "พ้นโครงสร้างที่ทำให้เส้นนั้นมีความหมาย"
   เช่นไม้ที่กำแพง PUT — SL ต้องต่ำกว่ากำแพงพอที่จะบอกได้ว่ากำแพงแตกจริง */

// รวมทุกเส้นที่ "นิ่ง" มาเป็นโครงสร้างอ้างอิง (ไม่เอาราคาปัจจุบัน)
function structureLevels(D){
  const out = [];
  (D.putWalls  || []).forEach(w => out.push({price:Number(w[0]), kind:'putWall'}));
  (D.callWalls || []).forEach(w => out.push({price:Number(w[0]), kind:'callWall'}));
  if (D.high20 != null) out.push({price:Number(D.high20), kind:'high20'});
  if (D.low20  != null) out.push({price:Number(D.low20),  kind:'low20'});
  buildSD(D).forEach(z => { if (z.tone !== 'mid') out.push({price:z.price, kind:'sd'}); });
  return out.sort((x,y) => x.price - y.price);
}

// SL วางพ้นโครงสร้างของไม้นั้น · TP วางที่โครงสร้างถัดไปในทิศที่เทรด
function buildStops(entry, side, D){
  const s      = Number(D.sd1) || 0;
  const buffer = Math.max(0.25 * s, 2);              // กัน noise ขั้นต่ำ 2 จุด
  const levels = structureLevels(D);
  const isBuy  = side === 'BUY';

  // หาโครงสร้างถัดไปในทิศที่เทรด (เว้นระยะขั้นต่ำ กันเส้นที่ชิดกันเกินไป)
  const ahead = levels
    .filter(l => isBuy ? l.price > entry + buffer : l.price < entry - buffer)
    .sort((a,b) => isBuy ? a.price - b.price : b.price - a.price);

  const sl = isBuy ? entry - buffer : entry + buffer;
  const tp = ahead.length
    ? ahead[0].price
    : (isBuy ? entry + 2*buffer : entry - 2*buffer); // ไม่มีโครงสร้างข้างหน้า → 1:2

  const risk = Math.abs(entry - sl);
  const rr   = risk ? Math.abs(tp - entry) / risk : 0;

  return {
    sl: Math.round(sl*10)/10,
    tp: Math.round(tp*10)/10,
    rr: Math.round(rr*10)/10,
    tpFrom: ahead.length ? ahead[0].kind : 'ไม่มีโครงสร้างข้างหน้า',
  };
}

/* ---------- 4) ฝั่ง JANIE (Apps Script) ----------
   วางใน .gs แล้วตั้ง time-driven trigger 05:00 น. เวลาไทย
   ห้ามมีโค้ดที่ไหนเขียนทับ anchor/sd1 ระหว่างวันเด็ดขาด

function setDailyAnchor(){
  const anchor = getSettlePrice();          // ราคา settle เมื่อวาน
  const iv     = getLatestIV();             // IV ล่าสุด (%)
  const T      = getDaysToExpiry() / 365;
  const sd1    = anchor * (iv/100) * Math.sqrt(T);

  setKey('anchor',     anchor);
  setKey('sd1',        Math.round(sd1*10)/10);
  setKey('anchorTime', Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm'));
}
------------------------------------------------- */
