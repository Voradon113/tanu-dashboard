#!/usr/bin/env python3
"""
อ่านไฟล์ Gold ETF Flows ของ World Gold Council แล้วสรุปให้อัตโนมัติ

    pip install openpyxl
    python3 wgc-etf-report.py ETF_Flows_20260802_0900.xlsx

โหลดไฟล์: gold.org -> Goldhub -> Data -> Gold ETF flows
"""

import sys
import datetime as dt
import statistics as st

import openpyxl

BLOCKS = (1, 8, 15)   # Key Tables วางข้อมูล 3 ช่วงเวลาเรียงข้างกัน
GLD_FAMILY = (
    'SPDR Gold Shares',
    'SPDR Gold MiniShares Trust',
    'iShares Gold Trust',
    'iShares Gold Trust Micro',
)


def load(path):
    return openpyxl.load_workbook(path, data_only=True)


def coverage(wb):
    """แท็บ Periods Legend คือแหล่งเดียวที่เชื่อได้ว่าข้อมูลถึงวันไหน — ชื่อไฟล์เชื่อไม่ได้"""
    rows = list(wb['Periods Legend'].iter_rows(values_only=True))
    out = {}
    for r in rows:
        if r[0] in ('DAILY', 'MTD', 'YTD'):
            out[r[0]] = (r[1], r[3])
    return out


def headline(wb):
    ws = wb['Key Tables by sub-class']
    rows = list(ws.iter_rows(values_only=True))
    periods = []
    for b in BLOCKS:
        title = rows[1][b]
        regions, total = [], None
        for r in rows[3:9]:
            label = r[b]
            if not label:
                continue
            rec = dict(name=label, aum=r[b + 1], flow=r[b + 2],
                       tonnes=r[b + 3], demand=r[b + 4])
            if label == 'Total':
                total = rec
            else:
                regions.append(rec)
        periods.append(dict(title=title, regions=regions, total=total))
    return periods


def monthly(wb, n=18):
    rows = list(wb['Holdings by month'].iter_rows(values_only=True))[6:]
    series = [(r[0], r[1], r[3]) for r in rows if r[0]]
    out = []
    for i in range(1, len(series)):
        d, price, tonnes = series[i]
        out.append(dict(date=d, price=price, tonnes=tonnes,
                        delta=tonnes - series[i - 1][2]))
    return out, out[-n:]


def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** .5
    return num / den if den else 0.0


def fund_rows(wb, names):
    """ดึงกองที่สนใจจากตาราง Top/Bottom flows ทุกช่วงเวลา"""
    ws = wb['Key Tables by sub-class']
    hits = {}
    for r in ws.iter_rows(values_only=True):
        for b in BLOCKS:
            name = r[b]
            if isinstance(name, str) and name.strip() in names and r[b + 2] is not None:
                hits.setdefault(name.strip(), {})[b] = r[b + 2]
    return hits


def main(path):
    wb = load(path)

    print('=' * 62)
    cov = coverage(wb)
    daily = cov.get('DAILY', (None, None))[1]
    print('ข้อมูลถึงวันที่ :', str(daily)[:10] if daily else '?')
    if isinstance(daily, dt.datetime):
        age = (dt.datetime.now() - daily).days
        flag = '  <-- เก่าเกิน 45 วัน ไปโหลดใหม่' if age > 45 else ''
        print(f'อายุข้อมูล     : {age} วัน{flag}')
    print('=' * 62)

    for p in headline(wb):
        t = p['total']
        print(f"\n## {p['title']}")
        print(f"   รวม  {t['flow']:+,.0f} US$mn | {t['demand']:+.1f} ตัน "
              f"| ถือรวม {t['tonnes']:,.0f} ตัน | AUM ${t['aum']:,.1f}bn")
        for r in p['regions']:
            print(f"     {r['name']:<16}{r['flow']:>+12,.0f} US$mn{r['demand']:>+9.1f} ตัน")

    allm, recent = monthly(wb)
    print('\n## รายเดือน')
    print(f"{'เดือน':<10}{'ทอง $/oz':>10}{'ถือ (ตัน)':>12}{'เปลี่ยน':>10}")
    for m in recent:
        print(f"{str(m['date'])[:7]:<10}{m['price']:>10,.0f}"
              f"{m['tonnes']:>12,.0f}{m['delta']:>+10.1f}")

    peak = max(allm, key=lambda x: x['tonnes'])
    last = allm[-1]
    print(f"\n## พีค -> ปัจจุบัน")
    print(f"   พีค    {str(peak['date'])[:7]}  {peak['tonnes']:,.0f} ตัน @ ${peak['price']:,.0f}")
    print(f"   ล่าสุด {str(last['date'])[:7]}  {last['tonnes']:,.0f} ตัน @ ${last['price']:,.0f}")
    print(f"   ทองคำ  {last['tonnes'] - peak['tonnes']:+,.1f} ตัน "
          f"({(last['tonnes'] / peak['tonnes'] - 1) * 100:+.1f}%)")
    print(f"   ราคา   {(last['price'] / peak['price'] - 1) * 100:+.1f}%")

    # ไหลออกเกิน 100 ตัน/เดือน = โครงสร้างเปลี่ยน ไม่ใช่แค่แกว่ง
    d = last['delta']
    verdict = ('ปกติ' if d > -50 else
               'เริ่มร้อน' if d > -100 else
               'โครงสร้างเปลี่ยน - ระวังขาลงยาว')
    print(f"\n   เดือนล่าสุด {d:+.1f} ตัน  ->  {verdict}")

    # เรียงตาม BLOCKS เสมอ ไม่งั้นแต่ละกองจะเรียงช่วงเวลาไม่ตรงกัน
    titles = [p['title'] for p in headline(wb)]
    print('\n## กอง GLD และพี่น้อง (flow US$mn)')
    print('   ' + ' ' * 32 + ''.join(f'{t:>12}' for t in titles))
    fam = fund_rows(wb, GLD_FAMILY)
    for name in GLD_FAMILY:
        vals = fam.get(name)
        if not vals:
            continue
        cells = ''.join(f"{vals[b]:>+12,.0f}" if b in vals else f"{'—':>12}"
                        for b in BLOCKS)
        print(f'   {name:<32}{cells}')

    print('\n## flow นำราคาไหม (5 ปีล่าสุด)')
    sub = allm[-60:]
    dt_ = [m['delta'] for m in sub]
    pc = [(sub[i]['price'] / sub[i - 1]['price'] - 1) * 100 for i in range(1, len(sub))]
    print(f'   เดือนเดียวกัน r = {corr(dt_[1:], pc):+.2f}')
    print(f'   -> เดือนถัดไป r = {corr(dt_[1:-1], pc[1:]):+.2f}   (อ่อน = ตามราคา ไม่ได้นำ)')
    print()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
