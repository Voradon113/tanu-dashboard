//+------------------------------------------------------------------+
//|  TanuGuard.mq5 — ยามเฝ้ากฎ                                        |
//|                                                                  |
//|  EA ตัวนี้ "ไม่เปิดไม้เอง" เด็ดขาด ไม่มีโค้ดส่วนไหนเปิดออเดอร์ใหม่เลย     |
//|  มันทำแค่ 2 อย่าง:                                                 |
//|    1. ไม่ยอมให้ไม้ที่ผิดกฎอยู่ในพอร์ต                                  |
//|    2. จัดการไม้ที่ถูกกฎแล้วให้อัตโนมัติ (ปิดครึ่ง +1R → เลื่อน SL มาทุน)   |
//|                                                                  |
//|  ⚠️ MT5 ไม่มีทางให้ EA "ห้าม" ออเดอร์มือก่อนมันเข้าตลาด             |
//|     ตัวนี้เลยทำงานแบบ "เข้าแล้วปิดทันที" ภายในไม่กี่มิลลิวินาที         |
//|     ต้นทุนคือค่าสเปรด — ถูกกว่าไม้ที่ปล่อยให้อยู่ต่อมาก                 |
//+------------------------------------------------------------------+
#property copyright "TANU"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

//------------------------------------------------------------------ ตั้งค่า
enum ENUM_MODE { MODE_WARN = 0, MODE_CLOSE = 1 };

input group           "โหมด"
input ENUM_MODE  Mode              = MODE_CLOSE;  // เตือนเฉยๆ หรือปิดไม้ที่ผิดกฎ
input bool       OnlyThisChart     = true;        // ดูเฉพาะสัญลักษณ์บนชาร์ตนี้

input group           "กฎรายวัน"
input int        MaxLossesPerDay   = 2;           // แดงกี่ไม้แล้วห้ามเข้าอีก
input bool       BlockOutsideHours = true;        // บังคับหน้าต่างเวลา
input int        LiveDayEndHour    = 8;           // จ·พ·ศ เล่นได้ถึงกี่โมง (เวลาไทย)
input int        LiveDayEndMinute  = 30;
input int        FreeDayStartHour  = 18;          // อ·พฤ เล่นได้ตั้งแต่กี่โมง

input group           "กฎของไม้"
input double     MinStopPrice      = 2.5;         // SL แคบสุดที่ยอมรับ (จุดราคา)
input double     MaxStopPrice      = 15.0;        // SL กว้างสุดที่ยอมรับ
input int        NoStopGraceSec    = 20;          // ให้เวลาใส่ SL กี่วินาทีก่อนเริ่มบังคับ
input bool       BlockPyramiding   = true;        // ห้ามเติมไม้ทิศเดิม
input bool       LockStopLoss      = true;        // ห้ามขยับ SL ออกจากราคาเข้า

input group           "จัดการไม้อัตโนมัติ"
input bool       UsePartial        = true;        // ปิดครึ่งที่ +1R
input double     PartialAtR        = 1.0;
input double     PartialPercent    = 50.0;
input bool       MoveToBreakeven   = true;        // ปิดครึ่งแล้วเลื่อน SL มาทุน
input double     BreakevenBuffer   = 0.2;         // กันโดนสเปรดเขี่ยที่ทุนพอดี

input group           "Telegram (เว้นว่างได้)"
input string     BotToken          = "";
input string     ChatID            = "";

//------------------------------------------------------------------ ภายใน
string  gSym;
datetime gLastNag = 0;

int OnInit()
{
   gSym = OnlyThisChart ? _Symbol : "";
   trade.SetExpertMagicNumber(0);          // ไม่ยุ่งกับ magic — ไม้มือไม่มี magic
   trade.SetAsyncMode(false);
   EventSetTimer(1);

   if(MinStopPrice >= MaxStopPrice)
   { Alert("TanuGuard: MinStopPrice ต้องน้อยกว่า MaxStopPrice"); return(INIT_PARAMETERS_INCORRECT); }

   Say("🛡 TanuGuard เริ่มทำงาน · โหมด " + (Mode==MODE_CLOSE ? "ปิดไม้ที่ผิดกฎ" : "เตือนอย่างเดียว"));
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason){ EventKillTimer(); }

//------------------------------------------------------------------ เวลาไทย
datetime BangkokNow(){ return TimeGMT() + 7*3600; }

// หน้าต่างเวลาจริงของเจ้าของพอร์ต — วันไลฟ์ขายของเล่นได้แค่ก่อนเข้างาน
bool WindowOK(string &why)
{
   if(!BlockOutsideHours) return true;
   MqlDateTime t; TimeToStruct(BangkokNow(), t);

   if(t.day_of_week == 0 || t.day_of_week == 6)
   { why = "เสาร์อาทิตย์ — ไม่เล่น"; return false; }

   bool liveDay = (t.day_of_week == 1 || t.day_of_week == 3 || t.day_of_week == 5);
   int  mins    = t.hour*60 + t.min;

   if(liveDay)
   {
      if(mins >= LiveDayEndHour*60 + LiveDayEndMinute)
      { why = StringFormat("วันไลฟ์ เลย %02d:%02d แล้ว — ตั้ง limit ได้ แต่ห้ามเทรดสด",
                            LiveDayEndHour, LiveDayEndMinute); return false; }
      return true;
   }

   if(mins < FreeDayStartHour*60)
   { why = StringFormat("ยังไม่ถึง %02d:00 — ยังอยู่ในเวลางาน", FreeDayStartHour); return false; }
   return true;
}

//------------------------------------------------------------------ นับไม้แดงของวันนี้
int LossesToday()
{
   MqlDateTime t; TimeToStruct(BangkokNow(), t);
   t.hour = 0; t.min = 0; t.sec = 0;
   datetime startBkk = StructToTime(t);
   datetime start    = startBkk - 7*3600;          // แปลงกลับเป็นเวลาเซิร์ฟเวอร์ฝั่ง GMT

   if(!HistorySelect(start, TimeCurrent()+60)) return 0;

   int n = 0;
   for(int i = HistoryDealsTotal()-1; i >= 0; i--)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      if(gSym != "" && HistoryDealGetString(d, DEAL_SYMBOL) != gSym) continue;

      double net = HistoryDealGetDouble(d, DEAL_PROFIT)
                 + HistoryDealGetDouble(d, DEAL_SWAP)
                 + HistoryDealGetDouble(d, DEAL_COMMISSION);
      if(net < 0) n++;
   }
   return n;
}

//------------------------------------------------------------------ จับไม้ใหม่ทันทีที่เข้า
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &req,
                        const MqlTradeResult      &res)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_ENTRY) != DEAL_ENTRY_IN) return;

   string sym = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   if(gSym != "" && sym != gSym) return;

   ulong pos = (ulong)HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   if(!PositionSelectByTicket(pos)) return;

   string why = "";

   // 1) วันนี้แดงครบโควตาแล้ว — ไม้นี้คือไม้เอาคืน ไม่ใช่ไม้ที่มีเซ็ตอัป
   //    ลบ 1 เพราะไม้ที่เพิ่งเข้ายังไม่ปิด จึงยังไม่ถูกนับเป็นแดง
   int losses = LossesToday();
   if(MaxLossesPerDay > 0 && losses >= MaxLossesPerDay)
      why = StringFormat("วันนี้แดงครบ %d ไม้แล้ว", losses);

   // 2) นอกหน้าต่างเวลา
   string w = "";
   if(why == "" && !WindowOK(w)) why = w;

   // 3) เติมไม้ทิศเดิม — ตัวที่เปลี่ยน −35 ให้เป็น −110
   if(why == "" && BlockPyramiding && CountSameSide(sym, pos) > 0)
      why = "เติมไม้ทิศเดิม — ไซซ์ต้องใส่ตั้งแต่ไม้แรก";

   if(why != ""){ Violate(pos, why); return; }

   RememberStop(pos);
   Say("✅ ไม้ผ่านกฎ · " + Describe(pos));
}

// มีไม้ทิศเดียวกันอยู่ก่อนแล้วกี่ไม้
int CountSameSide(string sym, ulong self)
{
   if(!PositionSelectByTicket(self)) return 0;
   long myType = PositionGetInteger(POSITION_TYPE);
   int n = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0 || t == self) continue;
      if(PositionGetString(POSITION_SYMBOL) != sym) continue;
      if(PositionGetInteger(POSITION_TYPE) == myType) n++;
   }
   return n;
}

//------------------------------------------------------------------ ตรวจซ้ำทุกวินาที
void OnTimer()
{
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(gSym != "" && sym != gSym) continue;

      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      datetime tm = (datetime)PositionGetInteger(POSITION_TIME);
      bool buy    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);

      // ไม่มี SL — ให้เวลาใส่ก่อน แล้วค่อยบังคับ
      if(sl == 0.0)
      {
         if(TimeCurrent() - tm >= NoStopGraceSec)
            Violate(t, StringFormat("ไม่มี SL เกิน %d วินาที", NoStopGraceSec));
         continue;
      }

      double risk = MathAbs(open - sl);

      if(risk < MinStopPrice){ Violate(t, StringFormat("SL แคบไป %.1f จุด — สเปรดกิน", risk)); continue; }
      if(risk > MaxStopPrice){ Violate(t, StringFormat("SL กว้างไป %.1f จุด — มาสายแล้ว", risk)); continue; }

      RememberStop(t);

      // ห้ามขยับ SL ออก — ดึงกลับที่เดิมเงียบๆ ไม่ต้องเถียงกับตัวเอง
      if(LockStopLoss) EnforceStop(t, buy, open);

      // ปิดครึ่งที่ +1R แล้วเลื่อนมาทุน
      if(UsePartial) ManagePartial(t, sym, buy, open);
   }
   CleanGlobals();
}

//------------------------------------------------------------------ จำ SL แรก
string KeySL(ulong t){   return "GRD_SL_"   + (string)t; }
string KeyHalf(ulong t){ return "GRD_HALF_" + (string)t; }

void RememberStop(ulong t)
{
   if(GlobalVariableCheck(KeySL(t))) return;
   if(!PositionSelectByTicket(t)) return;
   double sl = PositionGetDouble(POSITION_SL);
   if(sl != 0.0) GlobalVariableSet(KeySL(t), sl);
}

// SL ขยับ "เข้าหาราคาเข้า" ได้ (กันทุน) แต่ขยับ "ออก" ไม่ได้
void EnforceStop(ulong t, bool buy, double open)
{
   if(!GlobalVariableCheck(KeySL(t))) return;
   double orig = GlobalVariableGet(KeySL(t));
   if(!PositionSelectByTicket(t)) return;
   double now = PositionGetDouble(POSITION_SL);
   double tp  = PositionGetDouble(POSITION_TP);

   bool widened = buy ? (now < orig - _Point) : (now > orig + _Point);
   if(!widened) return;

   if(Mode == MODE_CLOSE)
   {
      if(trade.PositionModify(t, orig, tp))
         Say(StringFormat("🔒 SL ถูกขยับออก — ดึงกลับไปที่ %.2f แล้ว", orig));
   }
   else Nag(StringFormat("⚠️ SL ถูกขยับออกจาก %.2f ไปที่ %.2f", orig, now));
}

//------------------------------------------------------------------ ปิดครึ่ง + มาทุน
void ManagePartial(ulong t, string sym, bool buy, double open)
{
   if(GlobalVariableCheck(KeyHalf(t))) return;
   if(!GlobalVariableCheck(KeySL(t)))  return;

   double orig = GlobalVariableGet(KeySL(t));
   double risk = MathAbs(open - orig);
   if(risk <= 0) return;

   double px   = buy ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);
   double gain = buy ? (px - open) : (open - px);
   if(gain < risk * PartialAtR) return;

   if(!PositionSelectByTicket(t)) return;
   double vol   = PositionGetDouble(POSITION_VOLUME);
   double step  = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin  = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double half  = MathFloor(vol * PartialPercent/100.0 / step) * step;

   // ไม้เล็กเกินจะแบ่ง — ไม่ปิดครึ่ง แต่ยังเลื่อนมาทุนได้
   if(half >= vmin && vol - half >= vmin)
   {
      if(!trade.PositionClosePartial(t, half))
      { Nag("ปิดครึ่งไม่สำเร็จ: " + (string)trade.ResultRetcode()); return; }
      Say(StringFormat("💰 +%.1fR แล้ว · ปิด %.2f lot · ที่เหลือปล่อยวิ่ง", PartialAtR, half));
   }
   else Say("ℹ️ ไม้เล็กเกินจะแบ่ง — ข้ามปิดครึ่ง เลื่อน SL มาทุนอย่างเดียว");

   if(MoveToBreakeven && PositionSelectByTicket(t))
   {
      double be = buy ? open + BreakevenBuffer : open - BreakevenBuffer;
      double tp = PositionGetDouble(POSITION_TP);
      if(trade.PositionModify(t, be, tp))
      {
         GlobalVariableSet(KeySL(t), be);       // ทุนใหม่กลายเป็นเส้นที่ห้ามขยับออก
         Say(StringFormat("🔐 SL มาที่ทุน %.2f — ไม้นี้แพ้ไม่ได้อีกแล้ว", be));
      }
   }
   GlobalVariableSet(KeyHalf(t), 1);
}

//------------------------------------------------------------------ ผิดกฎ
void Violate(ulong t, string why)
{
   if(Mode == MODE_WARN){ Nag("⛔️ ผิดกฎ: " + why); return; }
   if(!PositionSelectByTicket(t)) return;

   string d = Describe(t);
   if(trade.PositionClose(t))
      Say("⛔️ ปิดให้แล้ว — " + why + "\n" + d + "\n\nไม่ใช่การลงโทษ นี่คือกฎที่พี่เขียนเอง");
   else
      Nag("⛔️ " + why + " · ปิดไม่สำเร็จ (" + (string)trade.ResultRetcode() + ") ปิดมือด่วน");
}

string Describe(ulong t)
{
   if(!PositionSelectByTicket(t)) return "";
   bool buy    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl   = PositionGetDouble(POSITION_SL);
   double tp   = PositionGetDouble(POSITION_TP);
   double vol  = PositionGetDouble(POSITION_VOLUME);

   string s = StringFormat("/log %s %.2f", buy ? "ซื้อ" : "ขาย", open);
   if(sl != 0.0) s += StringFormat(" sl %.2f", sl);
   if(tp != 0.0) s += StringFormat(" tp %.2f", tp);
   s += StringFormat("  (%.2f lot)", vol);
   return s;
}

//------------------------------------------------------------------ เก็บกวาด
void CleanGlobals()
{
   for(int i = GlobalVariablesTotal()-1; i >= 0; i--)
   {
      string name = GlobalVariableName(i);
      if(StringFind(name, "GRD_") != 0) continue;
      int p = StringFind(name, "_", 4);
      if(p < 0) continue;
      ulong t = (ulong)StringToInteger(StringSubstr(name, p+1));
      if(t > 0 && !PositionSelectByTicket(t)) GlobalVariableDel(name);
   }
}

//------------------------------------------------------------------ แจ้งเตือน
void Nag(string msg)
{
   if(TimeCurrent() - gLastNag < 30) return;    // กันสแปมตอนเงื่อนไขค้าง
   gLastNag = TimeCurrent();
   Say(msg);
}

void Say(string msg)
{
   Print(msg);
   Alert(msg);
   if(BotToken == "" || ChatID == "") return;

   string url  = "https://api.telegram.org/bot" + BotToken + "/sendMessage";
   string body = "chat_id=" + ChatID + "&text=" + UrlEncode(msg);
   char post[], result[];
   string headers = "Content-Type: application/x-www-form-urlencoded\r\n", rh;
   StringToCharArray(body, post, 0, StringLen(body));
   ArrayResize(post, StringLen(body));
   int code = WebRequest("POST", url, headers, 5000, post, result, rh);
   if(code == -1) Print("WebRequest ไม่ผ่าน — ใส่ https://api.telegram.org ใน Tools > Options > Expert Advisors ก่อน");
}

string UrlEncode(string s)
{
   string out = "";
   uchar b[]; StringToCharArray(s, b, 0, StringLen(s));
   for(int i = 0; i < ArraySize(b); i++)
   {
      uchar c = b[i];
      if(c == 0) continue;
      if((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          c == '-' || c == '_' || c == '.' || c == '~')
         out += CharToString(c);
      else
         out += StringFormat("%%%02X", c);
   }
   return out;
}

//+------------------------------------------------------------------+
//  ติดตั้ง
//
//  1. วางไฟล์ใน  MQL5/Experts/  แล้วกด Compile ใน MetaEditor
//  2. ลากลงชาร์ต XAUUSD · เปิด Algo Trading
//  3. อยากให้ส่ง Telegram: Tools > Options > Expert Advisors
//     ติ๊ก Allow WebRequest แล้วใส่  https://api.telegram.org
//
//  สัปดาห์แรกให้ตั้ง Mode = MODE_WARN ก่อน
//  ดูว่ามันเตือนตรงที่ควรเตือนไหม แล้วค่อยเปลี่ยนเป็น MODE_CLOSE
//
//  ⚠️ EA ตัวนี้ไม่เปิดออเดอร์ใหม่ในทุกกรณี
//     คำสั่งที่มีคือ PositionClose / PositionClosePartial / PositionModify เท่านั้น
//+------------------------------------------------------------------+
