/* ============================================================
   JANIE BIAS — เลข % แทนป้าย "เอนขึ้น/เอนลง"
   ------------------------------------------------------------
   ปัญหาของป้ายเดิม: มันคิดจากยอดสะสมทั้งวัน
   วอลุ่มช่วงเช้าเลยทับทุกอย่างที่มาทีหลัง พอบ่ายป้ายจะขยับแทบไม่ได้
   ผลคือ 5 ส.ค. เขียนว่า "เอนขึ้น" ทั้ง 5 ช็อต ทั้งที่ช็อตท้ายๆ พุทแซงคอลไปแล้ว

   ที่ถูก: คิดจาก "ส่วนที่เพิ่มระหว่างช็อต" — ของใหม่เท่านั้น
   ============================================================ */

const BIAS = {
  SHEET  : 'bias',
  FLIP_AT: 25,    // สลับข้างเกินค่านี้ = ทิศไม่นิ่ง ห้ามถือไม้ยาว
  TZ     : 'Asia/Bangkok',
};

/* ---------- 1) เก็บช็อต ---------- */

/** เรียกทุกครั้งที่ JANIE อ่าน QuikStrike ได้ ก่อนส่งข้อความ */
function pushSnapshot_(price, callTotal, putTotal){
  const sh = biasSheet_();
  const b  = marginalBias_(callTotal, putTotal);
  sh.appendRow([
    todayStr_(), nowStr_(), Number(price), Number(callTotal), Number(putTotal),
    b === null ? '' : b,
  ]);
  return b;
}

/**
 * Bias = (ΔCall − ΔPut) / (ΔCall + ΔPut) × 100     ช่วง −100 … +100
 *
 * ใช้ผลต่างจากช็อตก่อน ไม่ใช่ยอดสะสม — ยอดสะสมจะถูกวอลุ่มเช้ากลบจนขยับไม่ได้
 * คืน null ถ้าเป็นช็อตแรกของวัน หรือไม่มีของใหม่เข้ามาเลย
 */
function marginalBias_(callTotal, putTotal){
  const prev = lastRow_();
  if (!prev) return null;
  const dc = Number(callTotal) - Number(prev[3]);
  const dp = Number(putTotal)  - Number(prev[4]);
  if (dc < 0 || dp < 0) return null;          // ยอดสะสมลดลง = ข้อมูลรีเซ็ต ไม่ใช่ของใหม่
  const tot = dc + dp;
  if (tot < 30) return null;                   // ของใหม่น้อยเกินไป เป็น noise
  return Math.round((dc - dp) / tot * 100);
}

/* ---------- 2) แปลงเป็นภาพ ---------- */

const SPARK = ['▁','▂','▃','▄','▅','▆','▇','█'];

/** กราฟแท่งในบรรทัดเดียว — ส่งใน Telegram ได้ ไม่ต้องแนบรูป */
function sparkline_(vals){
  if (!vals.length) return '';
  return vals.map(function(v){
    const i = Math.min(7, Math.max(0, Math.round((Number(v) + 100) / 200 * 7)));
    return SPARK[i];
  }).join('');
}

function biasWord_(b){
  if (b === null) return 'ยังวัดไม่ได้';
  if (b >=  50) return 'คอลไหลแรง';
  if (b >=  20) return 'เอนคอล';
  if (b >  -20) return 'ก้ำกึ่ง';
  if (b > -50)  return 'เอนพุท';
  return 'พุทไหลแรง';
}

/* ---------- 3) บรรทัดที่เอาไปต่อท้ายข้อความเดิม ---------- */

function buildBiasLine_(){
  const rows = todayRows_();
  const vals = rows.map(function(r){ return r[5]; })
                   .filter(function(v){ return v !== '' && v !== null; });
  if (!vals.length) return '';

  const now  = vals[vals.length-1];
  const L = [];

  L.push('📊 Bias ' + signed_(now) + ' · ' + biasWord_(now));
  if (vals.length >= 2){
    L.push('　 ' + sparkline_(vals) + '  (' + vals.length + ' ช็อต)');
  }

  // ราคาไปทางหนึ่ง แต่ของใหม่ไหลอีกทาง = แรงกำลังจาง
  const p0 = Number(rows[0][2]), p1 = Number(rows[rows.length-1][2]);
  if (p1 > p0 && now < -20) L.push('⚠️ ราคาขึ้นแต่ของใหม่เป็นพุท — แรงขาขึ้นเริ่มจาง');
  if (p1 < p0 && now >  20) L.push('⚠️ ราคาลงแต่ของใหม่เป็นคอล — แรงขาลงเริ่มจาง');

  // นับการสลับข้าง ถ้าสวิงบ่อย แปลว่าไม่มีใครคุมทิศ
  var flips = 0;
  for (var i=1; i<vals.length; i++){
    const a = Number(vals[i-1]), b = Number(vals[i]);
    if (Math.abs(a - b) >= BIAS.FLIP_AT && (a>0) !== (b>0)) flips++;
  }
  if (flips >= 2){
    L.push('🔀 สลับข้าง ' + flips + ' รอบวันนี้ — ทิศไม่นิ่ง ไม้สั้นเท่านั้น');
  }

  return L.join('\n');
}

/* ---------- 4) สรุปปิดวัน ---------- */

function biasDaySummary_(day){
  const all = biasSheet_().getDataRange().getValues().slice(1);
  if (!all.length){
    return '📊 ชีต bias ยังว่าง — ต้องต่อ pushSnapshot_() เข้ากับตอนที่ JANIE อ่าน QuikStrike ก่อน';
  }
  // เว้นว่าง = วันล่าสุดที่มีข้อมูล ไม่ใช่ "วันนี้" — เรียกเช้าวันใหม่ก็ยังได้สรุปเมื่อวาน
  const target = day || dayStr_(all[all.length-1][0]);
  const rows   = all.filter(function(r){ return dayStr_(r[0]) === target; });
  if (rows.length < 2){
    return '📊 ' + target + ' มีแค่ ' + rows.length + ' ช็อต — ต้องมีอย่างน้อย 2 ถึงจะเทียบได้';
  }
  const vals = rows.map(function(r){ return Number(r[5]); })
                   .filter(function(v){ return !isNaN(v); });
  const avg  = vals.reduce(function(a,b){ return a+b; }, 0) / vals.length;
  const p0   = Number(rows[0][2]), p1 = Number(rows[rows.length-1][2]);

  const L = [];
  L.push('📊 *สรุป Bias · ' + target + '*');
  L.push('');
  L.push('ราคา ' + fmt_(p0) + ' → ' + fmt_(p1) + '　' + signed_(Math.round(p1-p0)) + ' จุด');
  L.push('Bias เฉลี่ย ' + signed_(Math.round(avg)) + ' · ' + biasWord_(Math.round(avg)));
  L.push('　 ' + sparkline_(vals));
  L.push('');
  L.push('_วอลุ่มบอกว่าของไปกองตรงไหน ไม่ได้บอกว่าใครซื้อใครขาย_');
  L.push('_คอลวิ่งแรงอาจเป็นคนขายคอลก็ได้ — ใช้เป็นตัวกรอง ไม่ใช่สัญญาณเข้า_ 🥷');
  return L.join('\n');
}

/* ---------- helper ---------- */

function biasSheet_(){
  const ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(BIAS.SHEET);
  if (!sh){
    sh = ss.insertSheet(BIAS.SHEET);
    sh.appendRow(['วันที่','เวลา','ราคา','Call สะสม','Put สะสม','Bias ช่วง']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function todayRows_(){ return rowsOfDay_(todayStr_()); }

function rowsOfDay_(day){
  return biasSheet_().getDataRange().getValues().slice(1)
    .filter(function(r){ return dayStr_(r[0]) === day; });
}

function lastRow_(){
  const rows = todayRows_();
  return rows.length ? rows[rows.length-1] : null;
}

/* ============================================================
   INSTALL

   1. วางไฟล์นี้ในโปรเจกต์ JANIE (ใช้ helper ร่วมกับ janie-log.gs)

   2. ตรงที่ JANIE อ่านยอด Call/Put ได้แล้ว ก่อนส่งข้อความ ใส่ 2 บรรทัด:

        pushSnapshot_(price, callTotal, putTotal);
        const biasLine = buildBiasLine_();

      แล้วเอา biasLine ต่อท้ายข้อความเดิม แทนบรรทัด "→ เอนขึ้น"

   3. อยากได้สรุปปิดวัน ตั้ง trigger เรียก biasDaySummary_() ตอน 23:00

   ⚠️ ตัวเลขนี้เป็น "ตัวกรอง" ไม่ใช่ "สัญญาณเข้า"
      วอลุ่มไม่บอกฝั่ง — คอล +763 อาจเป็นคนซื้อคอล หรือคนขายคอลก็ได้
      ใช้ตอบคำถามเดียว: วันนี้ห้ามถือไม้ยาวสวนทางไหน
   ============================================================ */
