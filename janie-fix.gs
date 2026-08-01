/* ============================================================
   JANIE FIX — วางใน script.google.com
   ------------------------------------------------------------
   แก้ 3 อย่างที่เจอ:
   1. เส้น SD เลื่อนตามราคา (±52 ตลอด) → ตรึง anchor วันละครั้ง
   2. Call wall โผล่ที่ 5,370 ทั้งที่ทองอยู่ 4,153 → กรองตามระยะ
   3. GC AUG 26 กับ GC2610 ปนกันในบอทตัวเดียว → รวมมาที่ CFG จุดเดียว

   วิธีติดตั้ง: ดูท้ายไฟล์ (INSTALL)
   ============================================================ */

const CFG = {
  CONTRACT   : 'GCZ2026',      // ⚠️ จุดเดียวที่กำหนดสัญญา — ตอนม้วนสัญญาแก้ตรงนี้ที่เดียว
  SHEET      : 'input',        // ชีตที่จอไปอ่าน (key/value)
  WALL_PCT   : 5,              // เอาเฉพาะ strike ในระยะ ±5% ของราคา
  WALL_TOP   : 3,              // โชว์กี่ตัวต่อฝั่ง
  TZ         : 'Asia/Bangkok',
};

/* ---------- 1) ANCHOR — ตรึงวันละครั้ง ---------- */

/**
 * ตั้ง trigger เวลา 05:00 น. ให้ฟังก์ชันนี้
 * เขียน anchor + sd1 ลงชีตครั้งเดียว แล้วห้ามมีใครแตะจนจบวัน
 */
function setDailyAnchor(){
  const anchor = getSettlePrice_();          // ราคา settle เมื่อวานของ CFG.CONTRACT
  const iv     = getLatestIV_();             // IV ล่าสุด (%)
  const days   = getDaysToExpiry_();

  if (!anchor || !iv || !days){
    logLine_('setDailyAnchor: ข้อมูลไม่ครบ ไม่เขียนทับของเดิม');
    return;                                   // ← สำคัญ: ไม่มีข้อมูลก็ไม่เขียน ดีกว่าเขียนค่ามั่ว
  }

  const sd1 = anchor * (iv/100) * Math.sqrt(days/365);

  setKey_('anchor',     round1_(anchor));
  setKey_('sd1',        round1_(sd1));
  setKey_('anchorTime', Utilities.formatDate(new Date(), CFG.TZ, 'HH:mm'));
  setKey_('contract',   CFG.CONTRACT);
  logLine_('anchor ตรึงที่ ' + round1_(anchor) + ' · sd1 ' + round1_(sd1));
}

function getAnchor_(){
  const v = getKey_('anchor');
  return v ? Number(v) : null;
}

function getSd1_(){
  const v = getKey_('sd1');
  return v ? Number(v) : null;
}

/* ---------- 2) เส้น SD — กางจาก anchor ไม่ใช่จากราคา ---------- */

/**
 * ❌ ของเดิมทำแบบนี้ (นี่คือตัวบั๊ก):
 *      const sd1 = 52;
 *      plus1  = ราคาปัจจุบัน + sd1;    // ราคาขยับ เส้นขยับตาม → แตะไม่ได้ตลอดกาล
 *      minus1 = ราคาปัจจุบัน - sd1;
 *
 * ✅ ที่ถูก: กางจาก anchor ที่ตรึงไว้
 */
function buildSDLevels_(){
  const a = getAnchor_(), s = getSd1_();
  if (!a || !s) return [];
  return [
    {label:'+2SD', price: round1_(a + 2*s)},
    {label:'+1SD', price: round1_(a + 1*s)},
    {label:'กลาง', price: round1_(a)},
    {label:'-1SD', price: round1_(a - 1*s)},
    {label:'-2SD', price: round1_(a - 2*s)},
  ];
}

/* ---------- 3) กรอง wall ตามระยะ ---------- */

/**
 * ของเดิมหยิบ OI มากสุดทั้งกระดาน เลยได้ 5,370 มา ทั้งที่ทองอยู่ 4,153
 * strike ที่ห่าง +29% คือคนซื้อหวยหมดอายุปีหน้า ไม่ใช่ฝากั้นราคาวันนี้
 *
 * @param {Array} walls  [[strike, oi, chg], ...]
 * @param {number} price ราคาปัจจุบัน
 * @return {Array} เฉพาะ strike ที่อยู่ในระยะ เรียง OI มากไปน้อย
 */
function filterWalls_(walls, price){
  if (!walls || !walls.length || !price) return [];
  const band = price * CFG.WALL_PCT / 100;
  return walls
    .filter(function(w){ return Math.abs(Number(w[0]) - price) <= band; })
    .sort(function(a,b){ return Number(b[1]) - Number(a[1]); })
    .slice(0, CFG.WALL_TOP);
}

/* ---------- 4) ข้อความ Telegram ---------- */

function buildFlowMessage_(price, callWalls, putWalls){
  const a  = getAnchor_(), s = getSd1_();
  const at = getKey_('anchorTime');
  const L  = [];

  L.push('🥇 ทอง COMEX · ' + CFG.CONTRACT);
  L.push('');

  // แสดง anchor ทุกครั้ง — ถ้ามันขยับระหว่างวันจะจับได้ทันทีจากในแชท
  if (a){
    L.push('⚓️ anchor ' + fmt_(a) + ' · ตรึง ' + (at || '—') + ' · 1SD ' + round1_(s));
  } else {
    L.push('⚠️ ยังไม่ได้ตรึง anchor วันนี้ — เส้น SD ยังเชื่อไม่ได้');
  }
  L.push('');

  const rows = [];
  filterWalls_(callWalls, price).forEach(function(w){
    rows.push({price:Number(w[0]), txt:'🟥 CALL ' + w[1]});
  });
  buildSDLevels_().forEach(function(z){
    if (z.label !== 'กลาง') rows.push({price:z.price, txt:'　 ' + z.label});
  });
  filterWalls_(putWalls, price).forEach(function(w){
    rows.push({price:Number(w[0]), txt:'🟦 PUT  ' + w[1]});
  });
  rows.push({price:price, txt:'● ราคา', now:true});

  rows.sort(function(x,y){ return y.price - x.price; });

  L.push('```');
  rows.forEach(function(r){
    const gap = r.now ? '   —' : signed_(round1_(r.price - price));
    L.push(pad_(r.txt, 14) + pad_(fmt_(r.price), 8) + gap);
  });
  L.push('```');
  L.push('');
  L.push('_OI บอกที่ตั้งของเงิน ไม่บอกทิศ · รอราคายืนยันก่อนเข้า_ 🥷');

  return L.join('\n');
}

/* ---------- 5) ขนาดไม้ตามความผันผวน ---------- */

const RISK = {
  RISK_PCT   : 1.0,    // % ของพอร์ตที่ยอมเสียต่อไม้
  SL_FACTOR  : 0.5,    // SL = 0.5 × 1SD  (ปรับได้ 0.4-0.6)
  DAILY_STOP : 3.0,    // ขาดทุนถึง % นี้ = หยุดวัน
  CFD_PER_PT : 100,    // XAUUSD CFD: 1.00 lot = $100 ต่อจุด
  MGC_PER_PT : 10,     // MGC futures: 1 สัญญา = $10 ต่อจุด
  LOT_MIN    : 0.01,
  LOT_STEP   : 0.01,
  LOT_MAX    : 2.00,
};

/**
 * ล็อกที่ "เงินที่ยอมเสีย" ไม่ใช่ล็อกที่ lot
 * วันเหวี่ยงแรง SL กว้างขึ้น -> lot เล็กลงเอง -> เงินเสี่ยงเท่าเดิมทุกวัน
 *
 * ⚠️ ใช้ sd1 ที่ตรึงไว้ตอนตี 5 ไม่ใช่ค่าสดที่หดลงระหว่างวัน
 *    ถ้าใช้ค่าสด lot จะโตขึ้นเองตอนดึก ซึ่งกลับหัวกับความจริง
 *    (ช่วงท้ายวันเหวี่ยงแรงกว่า ไม่ใช่เบากว่า)
 */
function calcLot_(equity){
  const s = getSd1_();
  if (!s || !equity) return null;

  const sl   = round1_(s * RISK.SL_FACTOR);
  const risk = equity * RISK.RISK_PCT / 100;

  // ปัดลงเสมอ — เสี่ยงน้อยกว่าที่ตั้งใจดีกว่าเกิน
  const raw  = risk / (sl * RISK.CFD_PER_PT);
  let   lot  = Math.floor(raw / RISK.LOT_STEP) * RISK.LOT_STEP;
  let   note = '';

  if (lot > RISK.LOT_MAX){ lot = RISK.LOT_MAX; note = 'ชนเพดาน'; }
  if (lot < RISK.LOT_MIN){
    lot  = RISK.LOT_MIN;
    note = 'ต่ำกว่าไม้ขั้นต่ำ — เสี่ยงจริงเกินที่ตั้งไว้';
  }

  lot = Math.round(lot * 100) / 100;

  // MGC ปัดลงตรงๆ — ถ้าได้ 0 แปลว่าพอร์ตเล็กเกินกว่าจะเทรด MGC ที่ SL นี้
  // อย่าดันขึ้นเป็น 1 สัญญา เพราะนั่นคือการเสี่ยงเกินที่ตั้งใจแบบเงียบๆ
  const mgc = Math.floor(risk / (sl * RISK.MGC_PER_PT));

  return {
    sd1  : s,
    sl   : sl,
    lot  : lot,
    mgc  : mgc,
    risk : Math.round(risk),
    // เสี่ยงจริงหลังปัด — ต่างจากที่ตั้งใจได้ ต้องโชว์ค่านี้ ไม่ใช่ค่าที่ตั้งใจ
    real : Math.round(lot * sl * RISK.CFD_PER_PT),
    note : note,
  };
}

/** เบรกเกอร์รายวัน — เสียถึงเพดานแล้วต้องหยุด ไม่ใช่ไล่คืน */
function dailyStopHit_(equity, plToday){
  if (!equity || plToday == null) return false;
  return (plToday / equity * 100) <= -RISK.DAILY_STOP;
}

function buildRiskLine_(equity, plToday){
  const r = calcLot_(equity);
  if (!r) return '📏 ยังคำนวณไม่ได้ — ไม่มี sd1';

  const L = ['📏 1SD ' + round1_(r.sd1) + ' · SL ' + r.sl + ' จุด'
           + ' · lot ' + r.lot.toFixed(2)
           + (r.mgc > 0 ? ' (MGC ' + r.mgc + ')' : '')
           + ' · เสี่ยง $' + r.real];
  if (r.note)     L.push('   ⚠️ ' + r.note);
  if (!r.mgc)     L.push('   ℹ️ MGC ไม่ไหวที่ SL นี้ — ใช้ CFD แทน');
  if (dailyStopHit_(equity, plToday)){
    L.push('🛑 ถึงเพดานขาดทุนวันนี้ (' + RISK.DAILY_STOP + '%) — ปิดจอ พรุ่งนี้ค่อยว่ากัน');
  }
  return L.join('\n');
}

/* ---------- 6) payload ให้จอ ---------- */

/** จอจะได้ anchor/sd1/contract ครบ ไม่ต้องคำนวณ SD เองอีก */
function buildDashboardPayload_(){
  const equity = Number(getKey_('equity')) || null;
  return {
    updated  : Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'),
    contract : CFG.CONTRACT,
    anchor   : getAnchor_(),
    sd1      : getSd1_(),
    anchorTime: getKey_('anchorTime'),
    risk     : equity ? calcLot_(equity) : null,
  };
}

/* ---------- helper ---------- */

function sheet_(){
  return SpreadsheetApp.getActive().getSheetByName(CFG.SHEET);
}

function getKey_(key){
  const rows = sheet_().getDataRange().getValues();
  for (var i=0; i<rows.length; i++){
    if (String(rows[i][0]).trim() === key) return rows[i][1];
  }
  return null;
}

function setKey_(key, val){
  const sh   = sheet_();
  const rows = sh.getDataRange().getValues();
  for (var i=0; i<rows.length; i++){
    if (String(rows[i][0]).trim() === key){
      sh.getRange(i+1, 2).setValue(val);
      return;
    }
  }
  sh.appendRow([key, val]);
}

function logLine_(msg){
  console.log('[JANIE] ' + msg);
}

function round1_(n){ return Math.round(Number(n)*10)/10; }
function fmt_(n){ return Number(n).toLocaleString('en-US', {minimumFractionDigits:0}); }
function signed_(n){ return (n>=0?'+':'') + n; }
function pad_(s, n){
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/* ============================================================
   INSTALL — ทำ 4 ขั้น

   1. เปิด script.google.com → โปรเจกต์ JANIE
      สร้างไฟล์ใหม่ชื่อ janie-fix.gs → วางไฟล์นี้ทั้งไฟล์

   2. ต่อสายเข้าโค้ดเดิม 3 จุด:
      - หาที่ไหนก็ตามที่คำนวณ +1SD / -1SD จากราคาปัจจุบัน
        → เปลี่ยนไปเรียก buildSDLevels_()
      - หาที่หยิบ call/put wall
        → ครอบด้วย filterWalls_(walls, price)
      - ในฟังก์ชัน doGet ที่ส่ง JSON ให้จอ
        → รวม buildDashboardPayload_() เข้าไปในอ็อบเจกต์ที่ส่งออก

   3. เขียน 3 ฟังก์ชันนี้ให้ต่อกับแหล่งข้อมูลเดิมของพี่
      (มันมีอยู่แล้วในโค้ดเก่า แค่ยังไม่ได้แยกออกมา)
        getSettlePrice_()   → ราคา settle เมื่อวานของ CFG.CONTRACT
        getLatestIV_()      → IV ล่าสุด (%)
        getDaysToExpiry_()  → จำนวนวันถึงหมดอายุ

   4. ตั้ง trigger:
      ⏰ นาฬิกาซ้ายมือ → Add Trigger
         Function : setDailyAnchor
         Event    : Time-driven → Day timer → 5am to 6am

   5. ⚠️ ขั้นที่ห้ามลืม — ไม่งั้นจอไม่อัพเหมือนเดิม:
      Deploy → Manage deployments → ✏️ ดินสอ ที่ตัวเดิม
      → Version: New version → Deploy
      (ห้ามกด "New deployment" เพราะจะได้ URL ใหม่ จอชี้ไม่ถูก)

      Execute as      : Me
      Who has access  : Anyone
   ============================================================ */
