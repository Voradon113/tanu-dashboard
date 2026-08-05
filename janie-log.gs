/* ============================================================
   JANIE /log — สมุดบันทึกเทรดที่จดผ่าน Telegram
   ------------------------------------------------------------
   ออกแบบมาแก้ข้อเดียว: "ขี้เกียจจด"
   ทุกอย่างเลยเหลือ 1 บรรทัด แล้วที่เหลือ JANIE เติมให้เอง

       /log ขาย 4130 sl 4165 tp 4090
       /close 4102
       /stats

   anchor · sd1 · ระยะเป็น SD · contract · DTE · เวลา — ไม่ต้องพิมพ์
   เพราะมันอยู่ในชีต input อยู่แล้ว ดึงมาใส่ให้ตอนบันทึก

   วิธีติดตั้ง: ดูท้ายไฟล์ (INSTALL)
   ============================================================ */

const LOG = {
  SHEET       : 'journal',
  MAX_LOSS_DAY: 2,        // แดง 2 ไม้ = จบวัน · ไม้ที่ 3 ยังจดได้ แต่ติดธง "ฝืนกฎ"
  TZ          : 'Asia/Bangkok',
};

const LOG_COLS = [
  'id','วันที่','เวลาเข้า','ฝั่ง','entry','sl','tp','lot',
  'R_แผน','anchor','sd1','ระยะ_SD','contract','เหตุผล',
  'ผล','exit','R_จริง','เวลาปิด','ฝืนกฎ',
];

/* ============================================================
   1) ตัวแยกคำ — ยอมรับทุกแบบที่คนพิมพ์จริงตอนรีบ
   ============================================================ */

/**
 * รับข้อความดิบ คืนอ็อบเจกต์ไม้เทรด
 * รองรับ:  "ขาย 4130 sl 4165 tp 4090 0.1 ชน 2SD"
 *          "sell 4130 4165 4090"          (ไม่มี label = เรียง entry/sl/tp)
 *          "short 4130"                   (ใส่ SL ทีหลังได้)
 */
function parseTrade_(text){
  const raw = String(text || '').trim();
  if (!raw) return null;

  const low = raw.toLowerCase();

  // ฝั่ง — ไทย/อังกฤษ/คำที่พี่พิมพ์จริง
  var side = null;
  if (/ขาย|เซล|ชอร์ต|sell|short/.test(low))      side = 'SELL';
  else if (/ซื้อ|บาย|ลอง|buy|long/.test(low))     side = 'BUY';
  if (!side) return null;                        // ไม่รู้ฝั่ง = ไม่ใช่ไม้เทรด

  // ตัวเลขทั้งหมดพร้อมตำแหน่ง เอาไว้เช็คว่ามี label นำหน้าไหม
  const nums = [];
  const re = /(\d[\d,]*\.?\d*)/g;
  var m;
  while ((m = re.exec(raw)) !== null){
    nums.push({ v: Number(m[1].replace(/,/g,'')), at: m.index });
  }
  if (!nums.length) return null;

  // ราคาทองอยู่หลักพัน · lot อยู่หลักหน่วย — แยกด้วยขนาด ไม่ต้องให้พี่ระบุ
  const prices = nums.filter(function(n){ return n.v >= 500; });
  const smalls = nums.filter(function(n){ return n.v <  500; });
  if (!prices.length) return null;

  function labelled(words){
    for (var i=0; i<prices.length; i++){
      const before = low.slice(Math.max(0, prices[i].at - 14), prices[i].at);
      if (words.test(before)) return prices[i].v;
    }
    return null;
  }

  var sl = labelled(/sl|เอสแอล|ตัด|หยุด|คัท/);
  var tp = labelled(/tp|ทีพี|เป้า|ปิด|ออก/);

  // ไม่มี label เลย → ถือว่าเรียง entry, sl, tp ตามลำดับ
  const entry = prices[0].v;
  if (sl === null && tp === null){
    sl = prices.length > 1 ? prices[1].v : null;
    tp = prices.length > 2 ? prices[2].v : null;
  }

  // เหตุผล = ตัวหนังสือที่เหลือหลังลอกตัวเลขกับคำสั่งออก
  const reason = raw
    .replace(/\/log/gi, '')
    .replace(/(\d[\d,]*\.?\d*)/g, ' ')
    .replace(/\b(sl|tp|buy|sell|long|short|lot)\b/gi, ' ')
    .replace(/ขาย|ซื้อ|เซล|บาย|ชอร์ต|ลอง|เอสแอล|ทีพี|ตัด|หยุด|คัท|เป้า|ปิด|ออก/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    side  : side,
    entry : entry,
    sl    : sl,
    tp    : tp,
    lot   : smalls.length ? smalls[0].v : null,
    reason: reason,
  };
}

/* ============================================================
   2) /log — บันทึกไม้เข้า
   ============================================================ */

function cmdLog_(text){
  const t = parseTrade_(text);
  if (!t){
    return [
      '📓 พิมพ์แบบนี้',
      '`/log ขาย 4130 sl 4165 tp 4090`',
      '',
      'ไม่ต้องครบก็ได้ — `/log ขาย 4130` ก็บันทึกแล้ว',
      'เวลา · anchor · SD · สัญญา ผมเติมให้เอง',
    ].join('\n');
  }

  const sh    = logSheet_();
  const today = todayStr_();
  const stat  = dayStats_(sh, today);

  // ไม้ที่ 3 หลังแดง 2 — ยังจดให้ แต่ติดธงไว้ ให้ /stats มันฟ้องเองตอนสิ้นสัปดาห์
  const broke = stat.losses >= LOG.MAX_LOSS_DAY;

  const anchor = num_(getKey_('anchor'));
  const sd1    = num_(getKey_('sd1'));
  const dist   = (anchor && sd1) ? Math.round((t.entry - anchor)/sd1 * 100)/100 : null;

  const rPlan = (t.sl && t.tp)
    ? Math.round(Math.abs(t.tp - t.entry) / Math.abs(t.entry - t.sl) * 100)/100
    : null;

  const id = 'T' + Utilities.formatDate(new Date(), LOG.TZ, 'yyMMdd-HHmm');

  sh.appendRow([
    id, today, nowStr_(), t.side, t.entry, t.sl || '', t.tp || '', t.lot || '',
    rPlan === null ? '' : rPlan,
    anchor || '', sd1 || '', dist === null ? '' : dist,
    getKey_('contract') || '', t.reason || '',
    'เปิด', '', '', '', broke ? 'ใช่' : '',
  ]);

  const L = [];
  L.push('📓 บันทึกแล้ว · ' + id);
  L.push('');
  L.push((t.side === 'SELL' ? '🔴 ขาย ' : '🟢 ซื้อ ') + fmt_(t.entry)
       + (t.lot ? '  ×' + t.lot : ''));
  if (t.sl) L.push('　 SL ' + fmt_(t.sl) + ' (เสี่ยง ' + Math.round(Math.abs(t.entry - t.sl)) + ' จุด)');
  if (t.tp) L.push('　 TP ' + fmt_(t.tp) + (rPlan ? '  ·  R:R  1 : ' + rPlan : ''));
  if (dist !== null) L.push('　 ยืนที่ ' + signed_(dist) + ' SD จาก anchor ' + fmt_(anchor));
  L.push('');

  if (broke){
    L.push('⚠️ *วันนี้แดงครบ ' + stat.losses + ' ไม้แล้ว*');
    L.push('ไม้นี้ติดธง “ฝืนกฎ” ไว้ — สิ้นสัปดาห์จะเห็นว่ามันได้หรือเสีย');
  } else if (stat.open > 0){
    L.push('มีไม้ค้างอยู่ ' + stat.open + ' ไม้ · วันนี้แดง ' + stat.losses + '/' + LOG.MAX_LOSS_DAY);
  } else {
    L.push('วันนี้แดง ' + stat.losses + '/' + LOG.MAX_LOSS_DAY);
  }
  L.push('ปิดแล้วพิมพ์ `/close <ราคา>`');

  return L.join('\n');
}

/* ============================================================
   3) /close — ปิดไม้ล่าสุดที่ยังเปิดอยู่ แล้วคิด R ให้
   ============================================================ */

function cmdClose_(text){
  const sh   = logSheet_();
  const rows = sh.getDataRange().getValues();
  const H    = headerMap_(rows[0]);

  // ไม้ที่ยังเปิด อันล่างสุด = อันล่าสุด
  var r = -1;
  for (var i = rows.length - 1; i >= 1; i--){
    if (String(rows[i][H['ผล']]) === 'เปิด'){ r = i; break; }
  }
  if (r < 0) return '📓 ไม่มีไม้ที่เปิดค้างอยู่';

  const mm = String(text).match(/(\d[\d,]*\.?\d*)/);
  if (!mm) return '📓 ใส่ราคาที่ปิดด้วย — `/close 4102`';
  const exit = Number(mm[1].replace(/,/g,''));

  const entry = Number(rows[r][H['entry']]);
  const sl    = Number(rows[r][H['sl']]);
  const isBuy = String(rows[r][H['ฝั่ง']]) === 'BUY';
  const pts   = (exit - entry) * (isBuy ? 1 : -1);

  // ไม่มี SL = วัด R ไม่ได้ ปล่อยว่างดีกว่าเดาความเสี่ยงย้อนหลัง
  const risk  = sl ? Math.abs(entry - sl) : 0;
  const R     = risk ? Math.round(pts / risk * 100)/100 : null;

  const result = pts > 1 ? 'ได้' : pts < -1 ? 'เสีย' : 'เท่าทุน';

  sh.getRange(r+1, H['ผล']+1).setValue(result);
  sh.getRange(r+1, H['exit']+1).setValue(exit);
  sh.getRange(r+1, H['R_จริง']+1).setValue(R === null ? '' : R);
  sh.getRange(r+1, H['เวลาปิด']+1).setValue(nowStr_());

  const stat = dayStats_(sh, todayStr_());
  const icon = result === 'ได้' ? '✅' : result === 'เสีย' ? '❌' : '⚪️';

  const L = [];
  L.push(icon + ' ปิด ' + rows[r][H['id']] + ' ที่ ' + fmt_(exit));
  L.push('　 ' + signed_(Math.round(pts)) + ' จุด' + (R === null ? '' : '  ·  ' + signed_(R) + ' R'));
  L.push('');
  L.push('วันนี้ ' + stat.win + ' เขียว / ' + stat.losses + ' แดง · รวม ' + signed_(round2_(stat.R)) + ' R');

  if (stat.losses >= LOG.MAX_LOSS_DAY){
    L.push('');
    L.push('🛑 *แดงครบ ' + LOG.MAX_LOSS_DAY + ' ไม้ — จบวันตรงนี้*');
    L.push('ไม่ใช่เพราะดวงไม่ดี แต่เพราะไม้ที่ 3 ในวันแดงคือไม้ที่เอาคืน ไม่ใช่ไม้ที่มีเซ็ตอัป');
  }
  return L.join('\n');
}

/* ============================================================
   4) /stats — วัด "กระบวนการ" ไม่ใช่ยอดเงิน
   ------------------------------------------------------------
   เป้าหมายเป็นตัวเงิน (อีก 1 ล้านจะถึง) บังคับให้ไซซ์โตตอนใกล้เส้นชัย
   ซึ่งกลับหัวกับการวางไซซ์ที่ถูก — สถิติชุดนี้เลยไม่มีคำว่าบาทเลยสักตัว
   ============================================================ */

function cmdStats_(text){
  const days = (String(text).match(/(\d+)/) || [])[1];
  const back = days ? Number(days) : 7;

  const sh   = logSheet_();
  const rows = sh.getDataRange().getValues();
  const H    = headerMap_(rows[0]);
  const cut  = new Date(Date.now() - back*86400000);

  var n=0, closed=0, win=0, R=0, noSL=0, brokeN=0, brokeR=0;
  const dayset = {}, cleanday = {};

  for (var i=1; i<rows.length; i++){
    const d = new Date(String(rows[i][H['วันที่']]) + 'T00:00:00');
    if (isNaN(d) || d < cut) continue;

    n++;
    const day = String(rows[i][H['วันที่']]);
    dayset[day] = true;
    if (!rows[i][H['sl']]) noSL++;
    if (String(rows[i][H['ฝืนกฎ']]) === 'ใช่'){
      brokeN++;
      brokeR += num_(rows[i][H['R_จริง']]) || 0;
      cleanday[day] = false;
    } else if (cleanday[day] === undefined){
      cleanday[day] = true;
    }

    const res = String(rows[i][H['ผล']]);
    if (res !== 'เปิด' && res !== ''){
      closed++;
      if (res === 'ได้') win++;
      R += num_(rows[i][H['R_จริง']]) || 0;
    }
  }

  if (!n) return '📊 ' + back + ' วันที่ผ่านมา ยังไม่มีบันทึกเลย';

  const nday  = Object.keys(dayset).length;
  const clean = Object.keys(cleanday).filter(function(k){ return cleanday[k]; }).length;

  const L = [];
  L.push('📊 *' + back + ' วันล่าสุด*');
  L.push('');
  L.push('จด ' + n + ' ไม้ · ' + nday + ' วัน · เฉลี่ย ' + round2_(n/nday) + ' ไม้/วัน');
  if (closed){
    L.push('ปิดแล้ว ' + closed + ' ไม้ · ชนะ ' + Math.round(win/closed*100) + '%');
    L.push('รวม ' + signed_(round2_(R)) + ' R · เฉลี่ย ' + signed_(round2_(R/closed)) + ' R/ไม้');
  }
  L.push('');
  L.push('*ตัววัดที่คุมได้จริง*');
  L.push('✅ วันที่ไม่ฝืนกฎ  ' + clean + '/' + nday);
  L.push((noSL ? '⚠️' : '✅') + ' ไม้ที่มี SL   ' + (n-noSL) + '/' + n);

  if (brokeN){
    L.push('');
    L.push('❗️ ไม้ที่เข้าหลังแดงครบโควตา: ' + brokeN + ' ไม้ · รวม ' + signed_(round2_(brokeR)) + ' R');
    L.push(brokeR < 0
      ? 'นี่คือราคาของการเอาคืน — ไม่ต้องเถียง ตัวเลขมันฟ้องเอง'
      : 'รอบนี้รอด แต่ 1 รอบยังไม่ใช่สถิติ ดูยาวๆ');
  }

  L.push('');
  L.push('_เป้าไม่ใช่ยอดเงิน เป้าคือ 4 สัปดาห์ติดที่ “วันไม่ฝืนกฎ” เต็มทุกวัน_ 🥷');
  return L.join('\n');
}

/* ============================================================
   5) /note — บันทึกอย่างอื่นที่ไม่ใช่ไม้เทรด
   ============================================================ */

function cmdNote_(text){
  const sh = logSheet_();
  const s  = String(text).trim();
  if (!s) return '📓 `/note ...` พิมพ์อะไรก็ได้ที่อยากจำ';
  sh.appendRow([
    'N' + Utilities.formatDate(new Date(), LOG.TZ, 'yyMMdd-HHmm'),
    todayStr_(), nowStr_(), 'NOTE', '', '', '', '', '', '', '', '', '',
    s, 'โน้ต', '', '', '', '',
  ]);
  return '📓 จดแล้ว';
}

/* ============================================================
   6) เตือนตอนดึก — กันลืมปิดไม้ / กันวันที่เทรดแล้วไม่จด
   ตั้ง trigger 23:30 น.
   ============================================================ */

function nightlyJournalCheck(){
  const sh   = logSheet_();
  const day  = todayStr_();
  const stat = dayStats_(sh, day);

  if (stat.open > 0){
    sendTelegram_('🌙 ยังมีไม้ค้าง ' + stat.open + ' ไม้ ยังไม่ได้ปิดในสมุด\n`/close <ราคา>` ก่อนนอน');
    return;
  }
  if (stat.total === 0){
    sendTelegram_('🌙 วันนี้ยังไม่มีบันทึกเลย\nถ้าไม่ได้เทรด พิมพ์ `/note ไม่เทรด` — วันที่ไม่เทรดก็คือข้อมูล');
    return;
  }
  sendTelegram_('🌙 วันนี้จด ' + stat.total + ' ไม้ ครบแล้ว · ' + signed_(round2_(stat.R)) + ' R\nจบวัน 🥷');
}

/* ============================================================
   7) ต่อสายกับ doPost เดิม
   ============================================================ */

/**
 * เรียกจาก doPost ที่มีอยู่แล้ว — คืน null ถ้าไม่ใช่คำสั่งของสมุด
 * แล้วปล่อยให้โค้ดเดิมทำงานต่อตามปกติ
 */
function handleJournalCommand_(text){
  const s = String(text || '').trim();
  const m = s.match(/^\/(log|close|stats|note)\b\s*([\s\S]*)$/i);
  if (!m) return null;

  const cmd = m[1].toLowerCase(), rest = m[2] || '';
  if (cmd === 'log')   return cmdLog_(rest);
  if (cmd === 'close') return cmdClose_(rest);
  if (cmd === 'stats') return cmdStats_(rest);
  if (cmd === 'note')  return cmdNote_(rest);
  return null;
}

/* ============================================================
   8) ตัวติดตั้ง — กดรันครั้งเดียว ไม่ต้องตั้งค่าอะไรเองเลย
   ------------------------------------------------------------
   สร้างชีต · สร้าง trigger · ยิงข้อความทดสอบ · บอกว่ายังขาดอะไร
   รันซ้ำได้ ไม่พัง (ลบ trigger เก่าก่อนสร้างใหม่เสมอ)
   ============================================================ */

function installJournal(){
  const done = [];

  // ชีต
  const sh = logSheet_();
  done.push('✅ ชีต "' + LOG.SHEET + '" พร้อม (' + Math.max(0, sh.getLastRow()-1) + ' แถว)');

  // trigger กลางคืน — ลบของเดิมก่อน กันซ้ำเวลารันหลายรอบ
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'nightlyJournalCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyJournalCheck').timeBased().atHour(23).everyDays(1).create();
  done.push('✅ ตั้งเตือน 23:00–24:00 แล้ว');

  // เช็คว่ามีฟังก์ชันส่ง Telegram ให้ใช้ไหม
  var canSend = false;
  try { canSend = (typeof sendTelegram_ === 'function'); } catch(e){}
  done.push(canSend ? '✅ ต่อกับ Telegram ได้' : '⚠️ ไม่เจอ sendTelegram_ — แก้ชื่อให้ตรงกับฟังก์ชันส่งข้อความเดิม');

  done.push('⬜️ เหลือขั้นเดียว: เติม 2 บรรทัดใน doPost (ดู INSTALL ท้ายไฟล์) แล้ว Deploy → New version');

  const msg = '🛠 ติดตั้งสมุดบันทึก\n\n' + done.join('\n');
  Logger.log(msg);
  if (canSend){
    try { sendTelegram_(msg + '\n\nลองพิมพ์ `/log ขาย 4130 sl 4165 tp 4090` ดูได้เลย'); } catch(e){}
  }
  return msg;
}

/* ---------- helper ---------- */

function logSheet_(){
  const ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(LOG.SHEET);
  if (!sh){
    sh = ss.insertSheet(LOG.SHEET);
    sh.appendRow(LOG_COLS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function headerMap_(row){
  const H = {};
  for (var i=0; i<row.length; i++) H[String(row[i]).trim()] = i;
  return H;
}

/** สรุปของวันนั้นวันเดียว — ใช้ทั้งตอนเตือนและตอนคุมโควตาแดง */
function dayStats_(sh, day){
  const rows = sh.getDataRange().getValues();
  const H    = headerMap_(rows[0]);
  var total=0, open=0, win=0, losses=0, R=0;
  for (var i=1; i<rows.length; i++){
    if (String(rows[i][H['วันที่']]) !== day) continue;
    const res = String(rows[i][H['ผล']]);
    if (res === 'โน้ต') continue;
    total++;
    if (res === 'เปิด')      open++;
    else if (res === 'ได้')  win++;
    else if (res === 'เสีย') losses++;
    R += num_(rows[i][H['R_จริง']]) || 0;
  }
  return {total:total, open:open, win:win, losses:losses, R:R};
}

function todayStr_(){ return Utilities.formatDate(new Date(), LOG.TZ, 'yyyy-MM-dd'); }
function nowStr_(){   return Utilities.formatDate(new Date(), LOG.TZ, 'HH:mm'); }
function num_(v){     const n = Number(v); return isNaN(n) ? null : n; }
function round2_(n){  return Math.round(Number(n)*100)/100; }

/* ============================================================
   INSTALL

   1. script.google.com → โปรเจกต์ JANIE
      ไฟล์ใหม่ชื่อ janie-log.gs → วางไฟล์นี้ทั้งไฟล์
      (ใช้ getKey_ / sendTelegram_ / fmt_ / signed_ ร่วมกับ janie-fix.gs
       ถ้ายังไม่มี sendTelegram_ ให้ชี้ไปที่ฟังก์ชันส่งข้อความเดิมของพี่)

   2. ใน doPost เดิม เติม 2 บรรทัดนี้ "ก่อน" โค้ดเดิมทั้งหมด:

        const j = handleJournalCommand_(text);
        if (j){ sendTelegram_(j); return ContentService.createTextOutput('ok'); }

   3. ตั้ง trigger: nightlyJournalCheck · Day timer · 11pm to midnight

   4. Deploy → Manage deployments → ✏️ → New version → Deploy

   ไม่ต้องสร้างชีต journal เอง — พิมพ์ /log ครั้งแรกมันสร้างให้พร้อมหัวตาราง
   ============================================================ */
