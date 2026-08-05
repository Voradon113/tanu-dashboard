/* ============================================================
   JANIE /flow — แปลงอเลิร์ต ATAS ให้ใช้งานได้จริง
   ------------------------------------------------------------
   ปัญหาของอเลิร์ตดิบ 3 ข้อ:
     1. ราคาเป็น GCZ6 ไม่ใช่ CFD  → ห่างกัน ~93 จุด อ่านตรงๆ ไม่ได้
     2. ดีลเดี่ยวคือ noise         → ต้องกระจุกถึงจะเป็นระดับ
     3. ยิงรัวจนชินชา              → เตือนเฉพาะตอนกระจุกพอ

   ทำ 3 อย่าง: แปลงเป็น CFD · จับกระจุก · เทียบกับกำแพง OI ที่มีอยู่แล้ว

   ⚠️ ติดตั้งหลังจาก janie-log.gs ทำงานแล้วเท่านั้น
   ============================================================ */

const FLOW = {
  SHEET     : 'flow',
  CLUSTER_PT: 2.0,   // ดีลที่ห่างกันไม่เกินนี้ นับเป็นระดับเดียวกัน
  CLUSTER_N : 4,     // กี่ดีลถึงเรียกว่ากระจุก
  WINDOW_MIN: 45,    // ในกรอบกี่นาที
  WALL_NEAR : 4.0,   // ใกล้กำแพง OI แค่ไหนถึงนับว่าทับกัน
  BASIS_KEY : 'basisZ',   // basis ของ GCZ6 — คนละตัวกับ GCV6 ห้ามใช้ปน
  TZ        : 'Asia/Bangkok',
};

/* ---------- 1) แกะอเลิร์ต ---------- */

/**
 * "[05.08.2026 13:42:59] [GCZ6]: New BigTrade at 4247.2 (buy) is more than 100 lots"
 * รับทีละบรรทัดหรือทั้งก้อนก็ได้ · ตัดบรรทัดซ้ำวินาที+ราคาเดียวกันทิ้ง
 */
function parseAtas_(text){
  const out = [], seen = {};
  const re = /\[(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\]\s*\[([A-Z0-9]+)\]:.*?at\s+([\d.]+)\s*\((buy|sell)\).*?more than\s+(\d+)/gi;
  var m;
  while ((m = re.exec(String(text))) !== null){
    const rec = {
      time : m[4]+':'+m[5]+':'+m[6],
      date : m[3]+'-'+m[2]+'-'+m[1],
      sym  : m[7],
      px   : Number(m[8]),
      side : m[9].toLowerCase(),
      lots : Number(m[10]),
    };
    // อเลิร์ตชุดเดียวมาซ้ำ 3 รอบเป็นปกติ — ถ้าไม่ตัด จะนับขนาดเกินจริง 3 เท่า
    const k = rec.date+rec.time+rec.px+rec.side;
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(rec);
  }
  return out;
}

/* ---------- 2) แปลงเป็นราคาที่พี่เทรดจริง ---------- */

function toCfd_(px){
  const b = Number(getKey_(FLOW.BASIS_KEY));
  if (!b) return null;                 // ไม่รู้ basis = ไม่เดา ปล่อยว่างดีกว่าให้เลขผิด
  return Math.round((px - b) * 10) / 10;
}

/* ---------- 3) จับกระจุก ---------- */

/**
 * ดีลเดี่ยว 100 lot ไม่ได้แปลว่าอะไร — อาจเป็นขาสเปรด เฮดจ์ ปิดชอร์ต
 * แต่ 4 ดีลใน 2 จุด ภายใน 45 นาที = มีคนสนใจราคานั้นจริง
 */
function clusters_(recs){
  if (!recs.length) return [];
  const sorted = recs.slice().sort(function(a,b){ return a.px - b.px; });
  const groups = [];
  var cur = [sorted[0]];

  for (var i=1; i<sorted.length; i++){
    if (sorted[i].px - cur[0].px <= FLOW.CLUSTER_PT) cur.push(sorted[i]);
    else { groups.push(cur); cur = [sorted[i]]; }
  }
  groups.push(cur);

  return groups.filter(function(g){
    if (g.length < FLOW.CLUSTER_N) return false;
    const t = g.map(function(r){ return toMin_(r.time); }).sort(function(a,b){ return a-b; });
    return (t[t.length-1] - t[0]) <= FLOW.WINDOW_MIN;
  }).map(function(g){
    var buy=0, sell=0, lots=0, sum=0;
    g.forEach(function(r){
      if (r.side === 'buy') buy++; else sell++;
      lots += r.lots; sum += r.px;
    });
    const px = Math.round(sum/g.length * 10)/10;
    return {
      px    : px,
      cfd   : toCfd_(px),
      n     : g.length,
      buy   : buy,
      sell  : sell,
      lots  : lots,
      // ฝั่งที่รุกมากกว่า — ไม่ใช่ "ทิศทาง" แค่บอกว่าใครใจร้อนกว่า
      lean  : buy > sell*1.5 ? 'ซื้อรุก' : sell > buy*1.5 ? 'ขายรุก' : 'ก้ำกึ่ง',
    };
  }).sort(function(a,b){ return b.lots - a.lots; });
}

/* ---------- 4) เทียบกับกำแพง OI ที่ JANIE มีอยู่แล้ว ---------- */

/**
 * นี่คือจุดที่ ATAS คุ้มค่าตัวจริง:
 * กำแพง OI บอกว่าเงินจอดตรงไหน · ดีลใหญ่บอกว่าตรงนั้นมีคนสู้จริงไหม
 *
 * ⚠️ กำแพงเป็นสไตรก์ของ GCV6 ส่วนดีลเป็นราคา GCZ6 — คนละสัญญา เทียบตรงๆ ไม่ได้
 *    ต้องดึงกลับมาเป็น CFD ทั้งคู่ก่อน แล้วค่อยวัดระยะ
 */
function matchWalls_(cls){
  const bV = Number(getKey_('basis'));         // basis ของ GCV6 (สัญญาออปชั่น)
  if (!bV) return cls;                          // ไม่รู้ basis ฝั่งกำแพง = ไม่เทียบ ดีกว่าเทียบผิด
  const raw   = getKey_('callWalls') + ',' + getKey_('putWalls');
  const walls = (String(raw).match(/\d{4}(\.\d)?/g) || [])
                  .map(function(w){ return {strike:Number(w), cfd:Number(w) - bV}; });

  cls.forEach(function(c){
    if (c.cfd === null) return;
    var best = null, gap = 1e9;
    walls.forEach(function(w){
      const d = Math.abs(w.cfd - c.cfd);
      if (d < gap){ gap = d; best = w; }
    });
    if (best && gap <= FLOW.WALL_NEAR){
      c.wall    = best.strike;
      c.wallCfd = Math.round(best.cfd*10)/10;
      c.wallGap = Math.round(gap*10)/10;
    }
  });
  return cls;
}

/* ---------- 5) คำสั่ง ---------- */

/** /flow <วางอเลิร์ตทั้งก้อน>  — เก็บลงชีตแล้วสรุป */
function cmdFlow_(text){
  const recs = parseAtas_(text);
  if (!recs.length){
    return '📡 วางอเลิร์ต ATAS ต่อท้าย `/flow` ได้เลย วางทีเดียวหลายบรรทัดก็ได้';
  }

  const sh = flowSheet_();
  recs.forEach(function(r){
    sh.appendRow([r.date, r.time, r.sym, r.px, toCfd_(r.px), r.side, r.lots]);
  });

  const cls = matchWalls_(clusters_(recs));
  const b   = getKey_(FLOW.BASIS_KEY);

  const L = [];
  L.push('📡 อ่าน ' + recs.length + ' ดีล · ' + recs[0].sym);
  if (!b){
    L.push('⚠️ ยังไม่ได้ตั้ง `' + FLOW.BASIS_KEY + '` — แปลงเป็น CFD ไม่ได้');
    L.push('วัด GCZ6 กับ CFD พร้อมกันตอนตลาดเปิด แล้วใส่ผลต่างลงชีต');
  }
  L.push('');

  if (!cls.length){
    L.push('ไม่มีกระจุก — ดีลกระจายทั่ว ยังไม่เป็นระดับ');
    L.push('_ดีลเดี่ยวใหญ่ๆ ส่วนมากคือขาสเปรดหรือเฮดจ์ ไม่ใช่ทิศทาง_');
    return L.join('\n');
  }

  L.push('*ระดับที่เงินก้อนใหญ่แลกกันจริง*');
  cls.slice(0,4).forEach(function(c){
    L.push('');
    L.push('▸ CFD ' + (c.cfd === null ? '—' : fmt_(c.cfd)) + '　(' + recs[0].sym + ' ' + fmt_(c.px) + ')');
    L.push('　 ' + c.n + ' ดีล · ' + c.lots + ' lots · ' + c.lean);
    if (c.wall) L.push('　 🧱 ทับกำแพง OI ' + fmt_(c.wall) + ' → CFD ' + fmt_(c.wallCfd) + ' (ห่าง ' + c.wallGap + ')');
  });

  L.push('');
  L.push('_ดีลใหญ่บอกว่า “มีคนสู้ตรงนี้” ไม่ได้บอกทิศ — ใช้เป็นของทับในกฎ ไม่ใช่สัญญาณเข้า_ 🥷');
  return L.join('\n');
}

/** ATAS ยิง webhook ตรงมาที่ /exec ได้ ถ้าเวอร์ชันรองรับ */
function handleFlowWebhook_(body){
  const recs = parseAtas_(body);
  if (!recs.length) return false;
  const sh = flowSheet_();
  recs.forEach(function(r){
    sh.appendRow([r.date, r.time, r.sym, r.px, toCfd_(r.px), r.side, r.lots]);
  });
  // เตือนเฉพาะตอนกระจุกพอ ไม่งั้นจะกลายเป็นอีกช่องที่ต้องมานั่งเฝ้า
  const cls = matchWalls_(clusters_(recentRows_()));
  cls.filter(function(c){ return c.wall; }).forEach(function(c){
    sendTelegram_('📡 ดีลใหญ่กระจุกที่ CFD ' + fmt_(c.cfd)
      + ' · ' + c.n + ' ดีล ' + c.lean
      + '\n🧱 ทับกำแพง OI ' + fmt_(c.wall)
      + '\n\nเก็บไว้เป็น “ของทับ” ในกฎ ไม่ใช่สัญญาณเข้า');
  });
  return true;
}

function handleFlowCommand_(text){
  const m = String(text || '').trim().match(/^\/flow\b\s*([\s\S]*)$/i);
  return m ? cmdFlow_(m[1] || '') : null;
}

/* ---------- helper ---------- */

function flowSheet_(){
  const ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(FLOW.SHEET);
  if (!sh){
    sh = ss.insertSheet(FLOW.SHEET);
    sh.appendRow(['วันที่','เวลา','สัญญา','ราคาฟิวเจอร์ส','ราคา CFD','ฝั่งรุก','lots']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ดีลในกรอบเวลาล่าสุด ใช้ตอน webhook เข้ามาทีละดีล */
function recentRows_(){
  const rows = flowSheet_().getDataRange().getValues().slice(1);
  const cut  = toMin_(Utilities.formatDate(new Date(), FLOW.TZ, 'HH:mm:ss')) - FLOW.WINDOW_MIN;
  return rows.filter(function(r){ return toMin_(String(r[1])) >= cut; })
             .map(function(r){
               return {time:String(r[1]), px:Number(r[3]), side:String(r[5]), lots:Number(r[6])};
             });
}

function toMin_(hhmmss){
  const p = String(hhmmss).split(':');
  return Number(p[0])*60 + Number(p[1]) + (Number(p[2]||0)/60);
}

/* ============================================================
   INSTALL

   1. วัด basis ของ GCZ6 ก่อน — อ่าน GCZ6 กับ CFD "พร้อมกัน" ตอนตลาดเปิด
      เอาผลต่างใส่ชีต input:   basisZ | 93
      ⚠️ ห้ามวัดตอนเสาร์อาทิตย์ · ห้ามใช้ค่าของ GCV6

   2. ต่อสายใน doPost — วางต่อจากบรรทัดของ janie-log.gs:

        const f = handleFlowCommand_(text);
        if (f){ sendTelegram_(f); return ContentService.createTextOutput('ok'); }

   3. ส่งอเลิร์ตเข้ามา เลือกทางใดทางหนึ่ง
      ก) ง่ายสุด — ก๊อปจากแชท ATAS มาวางท้าย /flow
      ข) อัตโนมัติ — ถ้า ATAS ตั้ง webhook ได้ ชี้มาที่ URL /exec
         แล้วใน doPost เรียก handleFlowWebhook_(e.postData.contents)
         (บอท Telegram อ่านข้อความของบอทตัวอื่นไม่ได้ ต่อตรงบอทกับบอทไม่ได้)
   ============================================================ */
