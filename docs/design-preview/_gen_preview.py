from pathlib import Path
import json
import math

ROOT = Path(r"E:\澳门开发\docs\design-preview")
CASINO_DIR = ROOT / "casinos"
CASINO_DIR.mkdir(parents=True, exist_ok=True)

CASINOS = [
  dict(id="sands-venetian", name="金沙·威尼斯人（仿真）", name_en="Sands Venetian Training Theme", mark="V", mark_label="SV",
       felt="#0D5C45", felt2="#0A4A38", rail="#E8E4DC", rail_edge="#C4A35A", accent="#1A4A7A", gold="#C4A35A",
       card_bg="#123A66", card_pattern="arch", chip_center="SV-T", chip_rings=["#1A4A7A","#C4A35A","#1A4A7A"],
       chip_edge="fine", score_style="stone", monitor_style="gold-wide", plaque="gold-rect",
       dealer="白衫 · 金棕背心 · 金名牌", blurb="运河蓝与拱券几何、大理石围边、翡翠呢面。欧式宽字距注区。"),
  dict(id="galaxy", name="银河（仿真）", name_en="Galaxy Training Theme", mark="G", mark_label="GX",
       felt="#123A5C", felt2="#0B2A44", rail="#8A9AAB", rail_edge="#D0D7E0", accent="#0B1E3A", gold="#B8C4D4",
       card_bg="#0B1E3A", card_pattern="orbit", chip_center="GX", chip_rings=["#4A90A4","#B8C4D4","#1A3A50"],
       chip_edge="double-metal", score_style="hud", monitor_style="slim", plaque="capsule",
       dealer="深灰西装 · 银领结 · 冷光名牌", blurb="靛蓝呢面、拉丝银围边、星轨牌背、HUD 路单与窄边显示器。"),
  dict(id="wynn", name="永利（仿真）", name_en="Wynn Training Theme", mark="W", mark_label="WN",
       felt="#0F3D2E", felt2="#0A2F24", rail="#4A2C14", rail_edge="#B8860B", accent="#5C1A1A", gold="#B8860B",
       card_bg="#5C1A1A", card_pattern="petal", chip_center="WN", chip_rings=["#5C1A1A","#B8860B","#3D1010"],
       chip_edge="wide-gold", score_style="wood", monitor_style="gold-thin", plaque="wood-gold",
       dealer="黑金马甲 · 酒红领饰 · 圆角金名牌", blurb="胡桃木金嵌条、深绿呢、花瓣牌背、木质路单框与暖金屏。"),
  dict(id="melco-cod", name="新濠天地（仿真）", name_en="Melco COD Training Theme", mark="M", mark_label="MC",
       felt="#2A1840", felt2="#1A0F2A", rail="#111111", rail_edge="#A61B4A", accent="#A61B4A", gold="#2EE6D6",
       card_bg="#120818", card_pattern="diamond", chip_center="MC", chip_rings=["#111111","#A61B4A","#2EE6D6"],
       chip_edge="bevel", score_style="neon", monitor_style="neon", plaque="neon",
       dealer="黑衫 · 品红织带 · 短马甲", blurb="深紫呢、烤漆黑+品红灯带、菱晶牌背、霓虹计分与粗框屏。"),
  dict(id="mgm", name="美高梅（仿真）", name_en="MGM Training Theme", mark="M", mark_label="MG",
       felt="#14302A", felt2="#0C1E1A", rail="#1C1C1C", rail_edge="#D4AF37", accent="#1C1C1C", gold="#D4AF37",
       card_bg="#0A0A0A", card_pattern="lion-line", chip_center="MG", chip_rings=["#1C1C1C","#D4AF37","#2A2A2A"],
       chip_edge="square", score_style="gallery", monitor_style="frame", plaque="vertical",
       dealer="全黑制服 · 金扣 · 极简名牌", blurb="墨呢、哑光黑金线、线描抽象狮牌背、画廊风路单与画框屏。"),
  dict(id="sjm-lisboa", name="澳博·葡京意象（仿真）", name_en="SJM Lisboa-inspired Theme", mark="S", mark_label="SJ",
       felt="#0A4A32", felt2="#063524", rail="#6B2B1F", rail_edge="#D4A017", accent="#9B1B1B", gold="#D4A017",
       card_bg="#9B1B1B", card_pattern="lotus", chip_center="SJ", chip_rings=["#9B1B1B","#D4A017","#0A4A32"],
       chip_edge="copper", score_style="classic-cn", monitor_style="copper", plaque="red-gold",
       dealer="红黑马甲 · 铜名牌", blurb="传统深绿呢、红木铜钉、莲剪影牌背、回纹路单与铜框屏。"),
]
DENOMS = [100, 500, 1000, 5000, 10000]

def card_back_svg(c, w=120, h=168):
    pattern, bg, gold, accent = c["card_pattern"], c["card_bg"], c["gold"], c["accent"]
    extras = ""
    if pattern == "arch":
        extras = f'<path d="M20 130 Q60 70 100 130" fill="none" stroke="{gold}" stroke-width="2" opacity="0.7"/><path d="M30 130 Q60 90 90 130" fill="none" stroke="{gold}" stroke-width="1.2" opacity="0.5"/><text x="60" y="55" text-anchor="middle" fill="{gold}" font-size="22" font-family="Georgia,serif">{c["mark"]}</text>'
    elif pattern == "orbit":
        extras = f'<circle cx="60" cy="84" r="28" fill="none" stroke="{gold}" stroke-width="1.5" opacity="0.8"/><circle cx="60" cy="84" r="18" fill="none" stroke="{c["chip_rings"][0]}" stroke-width="1" opacity="0.6"/><circle cx="60" cy="84" r="3" fill="{gold}"/><g fill="{gold}" opacity="0.5"><circle cx="25" cy="40" r="1.2"/><circle cx="90" cy="50" r="1"/><circle cx="40" cy="120" r="1.1"/><circle cx="95" cy="110" r="1.3"/></g><text x="60" y="150" text-anchor="middle" fill="{gold}" font-size="11" font-family="monospace">{c["mark_label"]}</text>'
    elif pattern == "petal":
        extras = f'<g transform="translate(60,84)" fill="none" stroke="{gold}" stroke-width="1.2" opacity="0.75"><ellipse cx="0" cy="-16" rx="10" ry="18"/><ellipse cx="0" cy="-16" rx="10" ry="18" transform="rotate(72)"/><ellipse cx="0" cy="-16" rx="10" ry="18" transform="rotate(144)"/><ellipse cx="0" cy="-16" rx="10" ry="18" transform="rotate(216)"/><ellipse cx="0" cy="-16" rx="10" ry="18" transform="rotate(288)"/><circle r="6" fill="{accent}" stroke="{gold}"/></g>'
    elif pattern == "diamond":
        extras = f'<g stroke="{c["accent"]}" fill="none" stroke-width="1" opacity="0.85"><path d="M60 40 L85 84 L60 128 L35 84 Z"/><path d="M60 55 L75 84 L60 113 L45 84 Z"/></g><text x="60" y="88" text-anchor="middle" fill="{c["gold"]}" font-size="14" font-family="monospace">{c["mark_label"]}</text>'
    elif pattern == "lion-line":
        extras = f'<g transform="translate(60,78)" fill="none" stroke="{gold}" stroke-width="1.4" stroke-linecap="round"><circle r="22" opacity="0.35"/><path d="M-12,-4 Q-16,-14 -6,-16 Q0,-22 6,-16 Q16,-14 12,-4"/><path d="M-8,2 Q0,8 8,2"/><path d="M-4,10 L0,16 L4,10"/><circle cx="-7" cy="-2" r="1.5" fill="{gold}"/><circle cx="7" cy="-2" r="1.5" fill="{gold}"/></g><text x="60" y="145" text-anchor="middle" fill="{gold}" font-size="10" letter-spacing="2">ART</text>'
    else:
        extras = f'<g transform="translate(60,84)" fill="none" stroke="{gold}" stroke-width="1.3"><path d="M0,20 Q-18,0 -8,-18 Q0,-8 8,-18 Q18,0 0,20 Z" opacity="0.9"/><path d="M0,16 Q-12,2 -4,-12 Q0,-4 4,-12 Q12,2 0,16 Z" opacity="0.7"/><ellipse cx="0" cy="-6" rx="14" ry="20" opacity="0.45"/></g><text x="60" y="150" text-anchor="middle" fill="{gold}" font-size="11">訓</text>'
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="{w-4}" height="{h-4}" rx="8" fill="{bg}" stroke="{gold}" stroke-width="3"/><rect x="10" y="10" width="{w-20}" height="{h-20}" rx="4" fill="none" stroke="{gold}" stroke-width="1" opacity="0.5"/>{extras}</svg>'

def card_face_svg(rank="A", suit="♠", color="#111"):
    return f'<svg viewBox="0 0 120 168" width="120" height="168" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="116" height="164" rx="8" fill="#FFFEF8" stroke="#222" stroke-width="2"/><text x="14" y="28" font-size="22" font-family="Georgia,serif" fill="{color}" font-weight="700">{rank}</text><text x="14" y="48" font-size="18" fill="{color}">{suit}</text><text x="60" y="100" text-anchor="middle" font-size="42" fill="{color}">{suit}</text></svg>'

def chip_svg(c, denom, size=72):
    rings, edge = c["chip_rings"], c["chip_edge"]
    r, cx, cy = size//2-2, size//2, size//2
    teeth = ""
    n = 24 if edge == "fine" else 16
    if edge != "square":
        for i in range(n):
            a0 = 2*math.pi*i/n
            a1 = a0 + 2*math.pi/n*0.45
            x0, y0 = cx+(r-1)*math.cos(a0), cy+(r-1)*math.sin(a0)
            x1, y1 = cx+(r-1)*math.cos(a1), cy+(r-1)*math.sin(a1)
            teeth += f'<path d="M{cx},{cy} L{x0:.1f},{y0:.1f} A{r-1},{r-1} 0 0 1 {x1:.1f},{y1:.1f} Z" fill="{rings[i%len(rings)]}" opacity="0.95"/>'
    inner = r - 10
    stroke_extra = c["gold"]
    shape = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#222"/>'
    if edge == "square":
        shape = f'<rect x="4" y="4" width="{size-8}" height="{size-8}" rx="10" fill="#222" stroke="{stroke_extra}" stroke-width="3"/>'
        teeth = ""
    label = str(denom) if denom < 1000 else f"{denom//1000}k"
    return f'<svg viewBox="0 0 {size} {size}" width="{size}" height="{size}" xmlns="http://www.w3.org/2000/svg">{shape}{teeth}<circle cx="{cx}" cy="{cy}" r="{inner}" fill="#1a1a1a" stroke="{stroke_extra}" stroke-width="2"/><circle cx="{cx}" cy="{cy}" r="{inner-6}" fill="none" stroke="{rings[0]}" stroke-width="3"/><text x="{cx}" y="{cy-4}" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" font-family="system-ui">{label}</text><text x="{cx}" y="{cy+10}" text-anchor="middle" fill="{stroke_extra}" font-size="8" font-family="monospace">{c["chip_center"]}</text><text x="{cx}" y="{cy+20}" text-anchor="middle" fill="#888" font-size="6">TRAIN</text></svg>'

def table_svg(c):
    felt, felt2, rail, edge = c["felt"], c["felt2"], c["rail"], c["rail_edge"]
    accent, gold = c["accent"], c["gold"]
    seats = ""
    for i in range(7):
        y = 235 if i in (0, 6) else 250
        x = 80 + i * 75
        seats += f'<g transform="translate({x},{y})"><ellipse cx="0" cy="0" rx="28" ry="18" fill="none" stroke="#7EC8FF" stroke-width="1.2"/><ellipse cx="0" cy="22" rx="28" ry="18" fill="none" stroke="#FF8A8A" stroke-width="1.2"/><text x="0" y="6" text-anchor="middle" fill="#fff" font-size="9">P{i+1}</text></g>'
    return f'''<svg viewBox="0 0 640 360" width="100%" style="max-width:640px" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="feltg-{c["id"]}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="{felt}"/><stop offset="100%" stop-color="{felt2}"/></linearGradient></defs>
  <ellipse cx="320" cy="200" rx="300" ry="150" fill="{rail}" stroke="{edge}" stroke-width="6"/>
  <ellipse cx="320" cy="200" rx="270" ry="128" fill="url(#feltg-{c["id"]})" stroke="{gold}" stroke-width="1.5"/>
  <rect x="230" y="78" width="180" height="36" rx="6" fill="{felt2}" stroke="{gold}" stroke-width="1"/>
  <text x="320" y="100" text-anchor="middle" fill="{gold}" font-size="12">DEALER · 荷官</text>
  <rect x="250" y="130" width="44" height="58" rx="4" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.7"/>
  <rect x="300" y="130" width="44" height="58" rx="4" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.7"/>
  <text x="272" y="125" text-anchor="middle" fill="#7EC8FF" font-size="10">閒 P</text>
  <rect x="346" y="130" width="44" height="58" rx="4" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.7"/>
  <rect x="396" y="130" width="44" height="58" rx="4" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.7"/>
  <text x="418" y="125" text-anchor="middle" fill="#FF8A8A" font-size="10">莊 B</text>
  {seats}
  <rect x="480" y="100" width="70" height="40" rx="4" fill="#222" stroke="{gold}" stroke-width="2"/><text x="515" y="124" text-anchor="middle" fill="{gold}" font-size="10">SHOE</text>
  <rect x="90" y="100" width="70" height="40" rx="4" fill="#333" stroke="{edge}" stroke-width="2"/><text x="125" y="124" text-anchor="middle" fill="#ccc" font-size="9">TRAY</text>
  <circle cx="560" cy="300" r="22" fill="{accent}" stroke="{gold}" stroke-width="2"/><text x="560" y="306" text-anchor="middle" fill="{gold}" font-size="16" font-weight="700">{c["mark"]}</text>
</svg>'''

def plaque_svg(c):
    style, gold, accent = c["plaque"], c["gold"], c["accent"]
    if style == "capsule":
        return f'<svg viewBox="0 0 160 48" width="160" height="48"><rect x="2" y="2" width="156" height="44" rx="22" fill="#111" stroke="{gold}" stroke-width="2"/><text x="80" y="20" text-anchor="middle" fill="{gold}" font-size="9">LIMIT</text><text x="80" y="36" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">100 — 100,000</text></svg>'
    if style == "vertical":
        return f'<svg viewBox="0 0 56 120" width="56" height="120"><rect x="2" y="2" width="52" height="116" rx="4" fill="#111" stroke="{gold}" stroke-width="2"/><text x="28" y="30" text-anchor="middle" fill="{gold}" font-size="9">MIN</text><text x="28" y="48" text-anchor="middle" fill="#fff" font-size="11">100</text><text x="28" y="78" text-anchor="middle" fill="{gold}" font-size="9">MAX</text><text x="28" y="96" text-anchor="middle" fill="#fff" font-size="10">100k</text></svg>'
    if style == "wood-gold":
        return f'<svg viewBox="0 0 160 50" width="160" height="50"><rect x="2" y="2" width="156" height="46" rx="3" fill="#4A2C14" stroke="{gold}" stroke-width="3"/><text x="80" y="30" text-anchor="middle" fill="{gold}" font-size="12">100 — 100,000</text></svg>'
    if style == "neon":
        return f'<svg viewBox="0 0 160 48" width="160" height="48"><rect x="2" y="2" width="156" height="44" rx="4" fill="#0a0a0a" stroke="{accent}" stroke-width="2"/><text x="80" y="32" text-anchor="middle" fill="{accent}" font-size="12" font-weight="700">100 — 100,000</text></svg>'
    if style == "red-gold":
        return f'<svg viewBox="0 0 160 48" width="160" height="48"><rect x="2" y="2" width="156" height="44" rx="3" fill="{accent}" stroke="{gold}" stroke-width="3"/><text x="80" y="20" text-anchor="middle" fill="{gold}" font-size="9">限紅 LIMIT</text><text x="80" y="36" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">100 — 100,000</text></svg>'
    return f'<svg viewBox="0 0 160 48" width="160" height="48"><rect x="2" y="2" width="156" height="44" rx="4" fill="#2a2418" stroke="{gold}" stroke-width="3"/><text x="80" y="20" text-anchor="middle" fill="{gold}" font-size="9">TABLE LIMIT</text><text x="80" y="36" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">100 — 100,000</text></svg>'

def scoreboard_html(c):
    style, gold, accent = c["score_style"], c["gold"], c["accent"]
    if style == "hud":
        frame = f"border:1px solid {gold};box-shadow:0 0 12px {c['chip_rings'][0]}66;background:#0a1520;border-radius:4px;"
        title = f"<div style='font-family:monospace;color:{gold};font-size:11px;letter-spacing:2px'>ROADMAP // LIVE</div>"
    elif style == "wood":
        frame = f"border:3px solid {gold};background:linear-gradient(#3a2818,#1a120c);border-radius:10px;"
        title = f"<div style='color:{gold};font-size:13px;text-align:center'>路 單</div>"
    elif style == "neon":
        frame = f"border:2px solid {accent};box-shadow:0 0 8px {accent};background:#0a0510;border-radius:2px;"
        title = f"<div style='color:{accent};font-family:monospace'>◆ ROAD · 路單</div>"
    elif style == "gallery":
        frame = f"border:1px solid {gold};background:#111;border-radius:0;"
        title = f"<div style='color:{gold};font-size:11px;letter-spacing:3px;text-align:center'>SCORE</div>"
    elif style == "classic-cn":
        frame = f"border:4px double {gold};background:#1a0808;border-radius:6px;"
        title = f"<div style='background:{accent};color:{gold};text-align:center;padding:4px;font-weight:700'>珠盤 · 大路</div>"
    else:
        frame = f"border:4px solid {gold};background:linear-gradient(#1a3350,#0d1a28);border-radius:6px;"
        title = f"<div style='background:{accent};color:{gold};text-align:center;padding:4px 8px;font-weight:600'>BACCARAT ROAD</div>"
    colors = ["#e74c3c","#3498db","#e74c3c","#2ecc71","#3498db","#e74c3c","#3498db","#e74c3c"]
    beads = "".join(f"<span style='display:inline-flex;width:18px;height:18px;border-radius:50%;background:{col};margin:2px;color:#fff;font-size:9px;font-weight:700;align-items:center;justify-content:center'>{'T' if '2ecc' in col else ('B' if col.startswith('#e74') else 'P')}</span>" for col in colors)
    big = "".join(f"<div style='width:16px;height:16px;border:1px solid #444;display:flex;align-items:center;justify-content:center'><div style='width:10px;height:10px;border-radius:50%;border:2px solid {colors[i%8]}'></div></div>" for i in range(24))
    return f'<div style="{frame}padding:10px;min-width:280px">{title}<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap"><div><div style="color:#aaa;font-size:10px;margin-bottom:4px">珠盤 Bead</div><div>{beads}</div></div><div><div style="color:#aaa;font-size:10px;margin-bottom:4px">大路 Big Road</div><div style="display:grid;grid-template-columns:repeat(8,16px);gap:1px">{big}</div></div></div><div style="margin-top:8px;font-size:10px;color:#bbb;display:flex;gap:10px"><span>莊 12</span><span>閒 10</span><span>和 2</span><span style="color:{gold}">靴#3</span></div></div>'

def monitor_html(c):
    style, gold, accent = c["monitor_style"], c["gold"], c["accent"]
    if style == "slim":
        bezel = f"border:2px solid {gold};border-radius:8px;background:#000;padding:4px;"
    elif style == "gold-thin":
        bezel = f"border:3px solid {gold};border-radius:6px;background:#1a1208;padding:6px;"
    elif style == "neon":
        bezel = f"border:4px solid #111;outline:2px solid {accent};background:#000;padding:6px;box-shadow:0 0 16px {accent}55;"
    elif style == "frame":
        bezel = f"border:8px solid #1c1c1c;outline:1px solid {gold};background:#000;padding:8px;"
    elif style == "copper":
        bezel = f"border:6px solid #8B5A2B;background:#1a1008;padding:6px;"
    else:
        bezel = f"border:6px solid {gold};border-radius:4px;background:#0a1628;padding:8px;"
    return f'<div style="{bezel}width:220px"><div style="background:linear-gradient(180deg,#0a0a12,#1a1020);height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff"><div style="font-size:10px;color:{gold};letter-spacing:2px">BACCARAT</div><div style="font-size:28px;font-weight:700;margin:6px 0">莊 6 : 閒 4</div><div style="font-size:12px;color:#8f8">結果 · 莊贏</div></div><div style="text-align:center;font-size:9px;color:{gold};margin-top:4px">{c["mark_label"]} DISPLAY</div></div>'

def page_html(c, all_casinos):
    chips = "".join(f'<div class="chip-wrap">{chip_svg(c,d)}</div>' for d in DENOMS)
    nav = "".join(f'<a href="{x["id"]}.html" class="{"active" if x["id"]==c["id"] else ""}">{x["name"].split("（")[0]}</a>' for x in all_casinos)
    return f'''<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{c["name"]} · 资产预览</title>
<style>
:root{{--bg:#0c0e12;--panel:#161a22;--text:#e8eaed;--muted:#9aa0a6;--gold:{c["gold"]};--accent:{c["accent"]}}}
*{{box-sizing:border-box}} body{{margin:0;font-family:"Segoe UI","PingFang TC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.5}}
header{{padding:16px 20px;border-bottom:1px solid #2a2f3a;background:linear-gradient(90deg,{c["accent"]}33,transparent);display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}}
.brand{{display:flex;gap:12px;align-items:center}} .mark{{width:40px;height:40px;border-radius:50%;background:{c["accent"]};border:2px solid {c["gold"]};display:flex;align-items:center;justify-content:center;font-weight:700;color:{c["gold"]}}}
h1{{margin:0;font-size:1.15rem}} .sub{{color:var(--muted);font-size:.8rem}}
.disclaimer{{font-size:.75rem;color:#c9a;background:#2a1520;padding:6px 10px;border-radius:6px;border:1px solid #633}}
nav{{display:flex;flex-wrap:wrap;gap:6px;padding:10px 20px;background:#12151c;border-bottom:1px solid #2a2f3a}}
nav a{{color:var(--muted);text-decoration:none;font-size:.8rem;padding:4px 10px;border-radius:999px;border:1px solid #333}}
nav a.active,nav a:hover{{color:#fff;border-color:var(--gold);background:#1a2030}}
main{{padding:20px;max-width:1100px;margin:0 auto;display:grid;gap:20px}}
section{{background:var(--panel);border:1px solid #2a2f3a;border-radius:12px;padding:16px 18px}}
section h2{{margin:0 0 12px;font-size:1rem;color:var(--gold)}}
section h2 span{{font-size:.7rem;color:var(--muted);font-weight:400;margin-left:8px}}
.row{{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}}
.chips{{display:flex;flex-wrap:wrap;gap:10px}} .meta{{color:var(--muted);font-size:.85rem;max-width:520px}}
.sw{{width:28px;height:28px;border-radius:4px;border:1px solid #444;display:inline-block}}
footer{{text-align:center;padding:24px;color:var(--muted);font-size:.75rem}} a.home{{color:var(--gold)}}
</style></head><body>
<header><div class="brand"><div class="mark">{c["mark"]}</div><div><h1>{c["name"]}</h1><div class="sub">{c["name_en"]} · <code>{c["id"]}</code></div></div></div>
<div class="disclaimer">⚠ 仿真训练主题 · 非官方授权 · 非 1:1 商标还原 · 仅训练币</div></header>
<nav><a href="../index.html">总览</a>{nav}</nav>
<main>
<section><h2>识别与气质 <span>部分品牌锚点 · 抽象徽记</span></h2>
<p class="meta">{c["blurb"]}</p>
<div><i class="sw" style="background:{c["felt"]}"></i> <i class="sw" style="background:{c["rail"]}"></i> <i class="sw" style="background:{c["accent"]}"></i> <i class="sw" style="background:{c["gold"]}"></i>
<span class="meta"> 荷官风格预留：{c["dealer"]}</span></div></section>
<section><h2>1. 牌桌 Table <span>俯视示意 · 独特材质</span></h2><div class="row">{table_svg(c)}<div><div class="meta" style="margin-bottom:8px">限红牌</div>{plaque_svg(c)}</div></div></section>
<section><h2>2. 扑克牌 Cards <span>独特牌背</span></h2><div class="row">{card_back_svg(c)}{card_back_svg(c)}{card_face_svg("A","♠")}{card_face_svg("K","♥","#c0392b")}{card_face_svg("9","♦","#c0392b")}</div></section>
<section><h2>3. 筹码 Chips <span>{c["chip_center"]} · {c["chip_edge"]}</span></h2><div class="chips">{chips}</div></section>
<section><h2>4. 计分器 / 路单 <span>{c["score_style"]}</span></h2>{scoreboard_html(c)}</section>
<section><h2>5. 显示器 Displays <span>{c["monitor_style"]}</span></h2><div class="row">{monitor_html(c)}<div class="meta">旁侧路单大屏同铬色；智能桌可开座位微屏。</div></div></section>
</main>
<footer><a class="home" href="../index.html">← 返回总览</a><br/>规范：docs/superpowers/specs/2026-07-27-macau-casino-table-asset-styles.md</footer>
</body></html>'''

for c in CASINOS:
    (CASINO_DIR / f"{c['id']}.html").write_text(page_html(c, CASINOS), encoding="utf-8")
    print("page", c["id"])

cards = []
for c in CASINOS:
    cards.append(f'<a class="card" href="casinos/{c["id"]}.html" style="--a:{c["accent"]};--g:{c["gold"]}"><div class="mark">{c["mark"]}</div><h2>{c["name"]}</h2><p>{c["blurb"]}</p><div class="swatches"><i style="background:{c["felt"]}"></i><i style="background:{c["rail"]}"></i><i style="background:{c["accent"]}"></i><i style="background:{c["gold"]}"></i></div><span class="go">查看成套资产 →</span></a>')

index = f'''<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>澳门六大赌场 · 训练资产预览</title>
<style>
body{{margin:0;font-family:"Segoe UI","PingFang TC","Microsoft YaHei",sans-serif;background:#0c0e12;color:#e8eaed}}
header{{padding:28px 20px 12px;text-align:center}} h1{{margin:0 0 8px;font-size:1.5rem}}
.disc{{display:inline-block;margin:8px auto;padding:8px 14px;background:#2a1520;border:1px solid #633;border-radius:8px;color:#e8b;font-size:.8rem;max-width:640px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:20px;max-width:1100px;margin:0 auto}}
.card{{display:block;text-decoration:none;color:inherit;background:#161a22;border:1px solid #2a2f3a;border-radius:14px;padding:18px;border-top:3px solid var(--g)}}
.card:hover{{border-color:var(--g);transform:translateY(-2px)}}
.mark{{width:44px;height:44px;border-radius:50%;background:var(--a);color:var(--g);border:2px solid var(--g);display:flex;align-items:center;justify-content:center;font-weight:800;margin-bottom:10px}}
.card h2{{margin:0 0 8px;font-size:1.05rem}} .card p{{margin:0;color:#9aa0a6;font-size:.85rem;min-height:3.2em}}
.swatches{{display:flex;gap:6px;margin:12px 0}} .swatches i{{width:22px;height:22px;border-radius:4px;border:1px solid #444;display:block}}
.go{{font-size:.8rem;color:var(--g)}} footer{{text-align:center;padding:24px;color:#777;font-size:.75rem}}
.note{{max-width:1100px;margin:0 auto;padding:0 20px;color:#9aa0a6;font-size:.85rem}}
</style></head><body>
<header><h1>澳门六大赌场 · 牌桌资产风格预览</h1>
<p style="color:#9aa0a6;margin:0">牌桌 · 扑克 · 筹码 · 计分器 · 显示器（每家独特成套）</p>
<div class="disc">仿真训练：部分可识别品牌锚点（抽象徽记/主色），非官方 Logo 1:1，非真实博彩。</div></header>
<p class="note">规范：<code>docs/superpowers/specs/2026-07-27-macau-casino-table-asset-styles.md</code> · 荷官 3D 按各页制服预留后续制作</p>
<div class="grid">{''.join(cards)}</div>
<footer>Macau Casino Training · Design Preview v0.1</footer></body></html>'''
(ROOT / "index.html").write_text(index, encoding="utf-8")
print("index")

assets = Path(r"E:\澳门开发\assets\casinos")
for c in CASINOS:
    d = assets / c["id"]
    d.mkdir(parents=True, exist_ok=True)
    theme = {
        "casinoId": c["id"],
        "displayName": {"zh-Hant": c["name"], "en": c["name_en"]},
        "disclaimer": "仿真训练主题，非官方授权",
        "mark": c["mark"], "markLabel": c["mark_label"],
        "tokens": {"felt": c["felt"], "feltShade": c["felt2"], "rail": c["rail"], "railEdge": c["rail_edge"],
                   "accent": c["accent"], "gold": c["gold"], "cardBack": c["card_bg"]},
        "patterns": {"cardBack": c["card_pattern"], "chipCenter": c["chip_center"], "chipEdge": c["chip_edge"],
                     "scoreStyle": c["score_style"], "monitorStyle": c["monitor_style"], "plaqueStyle": c["plaque"]},
        "dealerStyleNote": c["dealer"], "denominations": DENOMS,
        "previewHtml": f"docs/design-preview/casinos/{c['id']}.html",
    }
    (d / "theme.json").write_text(json.dumps(theme, ensure_ascii=False, indent=2), encoding="utf-8")
print("themes", len(list(assets.iterdir())))