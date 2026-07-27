# -*- coding: utf-8 -*-
"""Refined per-casino baccarat asset previews.

Upgrades over the first pass:
  * Seat betting groups are placed on a true ellipse arc and rotated to face
    the dealer, matching how a real kidney-shaped baccarat layout is printed.
  * Dealer working area is detailed: chip tray with denomination rows, shoe with
    cut card, discard rack, drop slot, lammer (commission) box.
  * Every casino gets its own felt weave, rail material, inner border ornament,
    brand medallion, card back engraving, chip mould and roadmap chrome.
  * Cards use standard pip layouts so the faces read like real playing cards.
"""
from pathlib import Path
import json
import math

ROOT = Path(r"E:\澳门开发\docs\design-preview")
CASINO_DIR = ROOT / "casinos"
ASSET_DIR = Path(r"E:\澳门开发\assets\casinos")
CASINO_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR.mkdir(parents=True, exist_ok=True)

MASS_SEAT_LABELS = [1, 2, 3, 4, 5, 6, 7]
VIP_SEAT_LABELS = [1, 2, 3, 5, 6]
BIG_TABLE_SEAT_LABELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]

# Denomination colours follow the common Macau chip convention so a trainee
# learns to read stacks by colour; each casino only restyles the ring and mould.
DENOMINATION_BASE = {
    100: {"body": "#1E1E1E", "text": "#F5F0E1", "label": "100"},
    500: {"body": "#5B2A86", "text": "#F7F1FF", "label": "500"},
    1000: {"body": "#B58A16", "text": "#20180A", "label": "1K"},
    5000: {"body": "#A81E2E", "text": "#FFF2F2", "label": "5K"},
    10000: {"body": "#1F5FA8", "text": "#EEF6FF", "label": "10K"},
}
CHIP_DENOMINATIONS = [100, 500, 1000, 5000, 10000]

SAMPLE_OUTCOMES = [
    ("B", False, False), ("B", True, False), ("P", False, False), ("P", False, False),
    ("P", False, True), ("B", False, False), ("T", False, False), ("B", False, False),
    ("B", False, False), ("B", False, False), ("B", True, False), ("P", False, False),
    ("B", False, False), ("P", False, False), ("P", False, False), ("B", False, False),
    ("B", False, False), ("P", False, True), ("P", False, False), ("P", False, False),
    ("P", False, False), ("B", False, False), ("T", False, False), ("P", False, False),
    ("B", False, False), ("B", False, False), ("B", False, False), ("B", False, False),
    ("B", False, False), ("P", True, False), ("P", False, False), ("B", False, False),
]

CASINOS = [
    dict(
        casino_id="sands-venetian",
        display_name="金沙 · 威尼斯人（仿真訓練主題）",
        display_name_en="Sands Venetian - Training Simulation Theme",
        monogram="V",
        chip_monogram="SV",
        felt_main="#0E6045",
        felt_mid="#0B5039",
        felt_shadow="#073728",
        felt_weave="damask",
        rail="#EDE7DA",
        rail_dark="#A8906A",
        rail_style="marble",
        rail_stitch="#C9A44C",
        accent="#1A4A7A",
        gold="#C9A44C",
        line_color="#F5EEDC",
        tie_band="#C9A44C",
        card_back="#123A66",
        card_engrave="arch",
        chip_ring="#C9A44C",
        chip_mould="fine-teeth",
        chip_inserts=8,
        border_ornament="arcade",
        medallion="doge-arch",
        board_style="stone",
        monitor_style="gilt-wide",
        plaque_style="brass-plate",
        label_font="Georgia,'Times New Roman',serif",
        label_case="roman-wide",
        currency="HKD",
        mass_min=1000,
        mass_max=100000,
        vip_min=20000,
        vip_max=2000000,
        commission=True,
        smart_table=True,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform=["#FBFAF6", "#8A6A34", "#C9A44C", "#1A4A7A"],
        dealer_uniform_note="白襯衫 · 金棕背心 · 金色名牌 · 白手套",
        refine_notes="圍邊採大理石紋，內圈以連續拱券線腳收邊；注區字樣用寬字距羅馬體，金線描邊較粗以呼應歐式裝飾。",
    ),
    dict(
        casino_id="galaxy",
        display_name="銀河（仿真訓練主題）",
        display_name_en="Galaxy - Training Simulation Theme",
        monogram="G",
        chip_monogram="GX",
        felt_main="#14405F",
        felt_mid="#10344E",
        felt_shadow="#0A2740",
        felt_weave="orbit",
        rail="#98A7B8",
        rail_dark="#4E5C6B",
        rail_style="brushed-steel",
        rail_stitch="#D5DEE8",
        accent="#0B1E3A",
        gold="#C6D2E0",
        line_color="#E3ECF6",
        tie_band="#4FA3B8",
        card_back="#0B1E3A",
        card_engrave="orbit",
        chip_ring="#C6D2E0",
        chip_mould="double-ring",
        chip_inserts=6,
        border_ornament="orbit-rail",
        medallion="star-ring",
        board_style="hud",
        monitor_style="bezel-slim",
        plaque_style="capsule-led",
        label_font="'Segoe UI','Helvetica Neue',Arial,sans-serif",
        label_case="upper-tight",
        currency="HKD",
        mass_min=500,
        mass_max=50000,
        vip_min=10000,
        vip_max=1000000,
        commission=False,
        smart_table=True,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1", "Either Pair 5:1"],
        dealer_uniform=["#3A414A", "#C6D2E0", "#0B1E3A", "#4FA3B8"],
        dealer_uniform_note="深灰西裝 · 銀色領結 · 冷光名牌",
        refine_notes="免佣桌：取消佣金格，改以莊六半賠燈條標示；內圈為同心軌道細線，注區字體改無襯線緊排以配合智能桌電子感應區。",
    ),
    dict(
        casino_id="wynn",
        display_name="永利（仿真訓練主題）",
        display_name_en="Wynn - Training Simulation Theme",
        monogram="W",
        chip_monogram="WN",
        felt_main="#0F4032",
        felt_mid="#0C3428",
        felt_shadow="#082A20",
        felt_weave="petal",
        rail="#6B4020",
        rail_dark="#2E1808",
        rail_style="walnut",
        rail_stitch="#C08A2E",
        accent="#5C1A1A",
        gold="#C08A2E",
        line_color="#F0E0B8",
        tie_band="#C08A2E",
        card_back="#5C1A1A",
        card_engrave="petal",
        chip_ring="#C08A2E",
        chip_mould="wide-gold",
        chip_inserts=12,
        border_ornament="petal-chain",
        medallion="prosperity-tree",
        board_style="walnut",
        monitor_style="gilt-thin",
        plaque_style="wood-brass",
        label_font="Georgia,'Palatino Linotype',serif",
        label_case="roman-fine",
        currency="HKD",
        mass_min=1000,
        mass_max=120000,
        vip_min=50000,
        vip_max=3000000,
        commission=True,
        smart_table=True,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform=["#151515", "#C08A2E", "#5C1A1A", "#F0E0B8"],
        dealer_uniform_note="黑金馬甲 · 酒紅領飾 · 圓角金名牌",
        refine_notes="胡桃木圍邊加金嵌條與縫線；內圈花瓣連續紋，注區字體較小且精緻，強調高端桌面留白。",
    ),
    dict(
        casino_id="melco-cod",
        display_name="新濠天地（仿真訓練主題）",
        display_name_en="Melco City of Dreams - Training Simulation Theme",
        monogram="M",
        chip_monogram="MC",
        felt_main="#2B1A45",
        felt_mid="#221338",
        felt_shadow="#160C26",
        felt_weave="lattice",
        rail="#1A1620",
        rail_dark="#000000",
        rail_style="piano-black",
        rail_stitch="#A61B4A",
        accent="#A61B4A",
        gold="#2FE3D2",
        line_color="#EDE2FA",
        tie_band="#2FE3D2",
        card_back="#12081A",
        card_engrave="lattice",
        chip_ring="#2FE3D2",
        chip_mould="bevel",
        chip_inserts=10,
        border_ornament="neon-lattice",
        medallion="crystal-facet",
        board_style="neon",
        monitor_style="neon-heavy",
        plaque_style="neon-edge",
        label_font="'Segoe UI',Roboto,Arial,sans-serif",
        label_case="upper-tight",
        currency="HKD",
        mass_min=500,
        mass_max=80000,
        vip_min=20000,
        vip_max=1500000,
        commission=False,
        smart_table=True,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1", "Perfect Pair 25:1"],
        dealer_uniform=["#141118", "#A61B4A", "#2FE3D2", "#EDE2FA"],
        dealer_uniform_note="黑襯衫 · 品紅織帶 · 短版馬甲",
        refine_notes="鋼琴烤漆圍邊嵌品紅燈帶；內圈菱形晶格描邊帶青色高光，完美對子額外注區，夜場高對比但保持數字可讀。",
    ),
    dict(
        casino_id="mgm",
        display_name="美高梅（仿真訓練主題）",
        display_name_en="MGM - Training Simulation Theme",
        monogram="M",
        chip_monogram="MG",
        felt_main="#15332C",
        felt_mid="#112A24",
        felt_shadow="#0A1E19",
        felt_weave="minimal",
        rail="#242424",
        rail_dark="#080808",
        rail_style="matte-black",
        rail_stitch="#D4AF37",
        accent="#1C1C1C",
        gold="#D4AF37",
        line_color="#EDE7D2",
        tie_band="#D4AF37",
        card_back="#0A0A0A",
        card_engrave="feline",
        chip_ring="#D4AF37",
        chip_mould="square-edge",
        chip_inserts=4,
        border_ornament="single-rule",
        medallion="feline-line",
        board_style="gallery",
        monitor_style="art-frame",
        plaque_style="vertical-black",
        label_font="'Helvetica Neue',Arial,'Segoe UI',sans-serif",
        label_case="upper-airy",
        currency="HKD",
        mass_min=500,
        mass_max=50000,
        vip_min=20000,
        vip_max=1000000,
        commission=True,
        smart_table=True,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform=["#101010", "#D4AF37", "#2A2A2A", "#EDE7D2"],
        dealer_uniform_note="全黑制服 · 金釦 · 極簡名牌",
        refine_notes="啞光黑圍邊只保留一道金線；內圈單線收邊、留白最多，注區字距寬鬆，整體走當代畫廊感。",
    ),
    dict(
        casino_id="sjm-lisboa",
        display_name="澳博 · 葡京意象（仿真訓練主題）",
        display_name_en="SJM Lisboa-inspired - Training Simulation Theme",
        monogram="S",
        chip_monogram="SJ",
        felt_main="#0B4E35",
        felt_mid="#09402C",
        felt_shadow="#063324",
        felt_weave="lotus",
        rail="#8A3823",
        rail_dark="#42180E",
        rail_style="rosewood-brass",
        rail_stitch="#D4A017",
        accent="#9B1B1B",
        gold="#D4A017",
        line_color="#F6E8C4",
        tie_band="#D4A017",
        card_back="#9B1B1B",
        card_engrave="lotus",
        chip_ring="#D4A017",
        chip_mould="copper-teeth",
        chip_inserts=8,
        border_ornament="keyfret",
        medallion="lotus-seal",
        board_style="classic-cn",
        monitor_style="copper-heavy",
        plaque_style="red-gold",
        label_font="'KaiTi','STKaiti',Georgia,serif",
        label_case="bilingual",
        currency="HKD",
        mass_min=200,
        mass_max=30000,
        vip_min=10000,
        vip_max=1000000,
        commission=True,
        smart_table=False,
        tie_payout="8:1",
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform=["#7A1414", "#181818", "#D4A017", "#F6E8C4"],
        dealer_uniform_note="紅黑馬甲 · 銅色名牌",
        refine_notes="傳統桌：無電子感應區，紅木圍邊打銅釘；內圈回紋收邊，注區採繁體中英雙語並列，字體帶楷書味。",
    ),
]


# --------------------------------------------------------------------------
# Material and ornament builders (one distinct look per casino)
# --------------------------------------------------------------------------

def felt_weave_pattern(casino):
    """Woven felt texture. Each casino has its own repeat so no two felts match."""
    weave = casino["felt_weave"]
    line = casino["line_color"]
    pattern_id = f'weave-{casino["casino_id"]}'
    if weave == "damask":
        tile = 46
        body = (
            f'<path d="M0 23 Q11.5 4 23 23 Q34.5 42 46 23" fill="none" stroke="{line}" '
            f'stroke-width="0.8" opacity="0.10"/>'
            f'<path d="M23 0 Q34.5 11.5 23 23 Q11.5 34.5 23 46" fill="none" stroke="{line}" '
            f'stroke-width="0.5" opacity="0.06"/>'
        )
    elif weave == "orbit":
        tile = 44
        body = (
            f'<circle cx="22" cy="22" r="15" fill="none" stroke="{line}" stroke-width="0.75" opacity="0.10"/>'
            f'<circle cx="22" cy="22" r="7" fill="none" stroke="{line}" stroke-width="0.5" opacity="0.07"/>'
            f'<circle cx="22" cy="22" r="1.4" fill="{line}" opacity="0.12"/>'
        )
    elif weave == "petal":
        tile = 42
        body = (
            f'<path d="M21 5 Q30 21 21 37 Q12 21 21 5Z" fill="none" stroke="{line}" '
            f'stroke-width="0.8" opacity="0.11"/>'
            f'<path d="M5 21 Q21 12 37 21 Q21 30 5 21Z" fill="none" stroke="{line}" '
            f'stroke-width="0.45" opacity="0.06"/>'
        )
    elif weave == "lattice":
        tile = 40
        body = (
            f'<path d="M20 2 L38 20 L20 38 L2 20Z" fill="none" stroke="{line}" '
            f'stroke-width="0.8" opacity="0.11"/>'
            f'<path d="M20 11 L29 20 L20 29 L11 20Z" fill="none" stroke="{casino["gold"]}" '
            f'stroke-width="0.5" opacity="0.10"/>'
        )
    elif weave == "minimal":
        tile = 54
        body = (
            f'<path d="M0 27 H54" stroke="{line}" stroke-width="0.5" opacity="0.05"/>'
            f'<path d="M27 0 V54" stroke="{line}" stroke-width="0.5" opacity="0.05"/>'
        )
    else:  # lotus
        tile = 44
        body = (
            f'<path d="M22 38 Q8 27 22 6 Q36 27 22 38Z" fill="none" stroke="{line}" '
            f'stroke-width="0.8" opacity="0.11"/>'
            f'<path d="M22 34 Q14 26 22 14 Q30 26 22 34Z" fill="{line}" opacity="0.05"/>'
        )
    return (
        f'<pattern id="{pattern_id}" width="{tile}" height="{tile}" patternUnits="userSpaceOnUse">'
        f'{body}</pattern>'
    ), pattern_id


def rail_material(casino):
    """Padded armrest material: marble, brushed steel, walnut, piano black etc."""
    gradient_id = f'railmat-{casino["casino_id"]}'
    light, dark, style = casino["rail"], casino["rail_dark"], casino["rail_style"]
    if style == "marble":
        stops = (
            f'<stop offset="0%" stop-color="{dark}"/>'
            f'<stop offset="22%" stop-color="{light}"/>'
            f'<stop offset="46%" stop-color="#FFFFFF"/>'
            f'<stop offset="62%" stop-color="{light}"/>'
            f'<stop offset="100%" stop-color="{dark}"/>'
        )
    elif style == "brushed-steel":
        stops = (
            f'<stop offset="0%" stop-color="{dark}"/>'
            f'<stop offset="30%" stop-color="{light}"/>'
            f'<stop offset="50%" stop-color="#F4F8FC"/>'
            f'<stop offset="70%" stop-color="{light}"/>'
            f'<stop offset="100%" stop-color="{dark}"/>'
        )
    elif style in ("walnut", "rosewood-brass"):
        stops = (
            f'<stop offset="0%" stop-color="{dark}"/>'
            f'<stop offset="26%" stop-color="{light}"/>'
            f'<stop offset="52%" stop-color="{dark}"/>'
            f'<stop offset="74%" stop-color="{light}"/>'
            f'<stop offset="100%" stop-color="{dark}"/>'
        )
    elif style == "piano-black":
        stops = (
            f'<stop offset="0%" stop-color="{dark}"/>'
            f'<stop offset="40%" stop-color="{light}"/>'
            f'<stop offset="48%" stop-color="#5A5A62"/>'
            f'<stop offset="56%" stop-color="{light}"/>'
            f'<stop offset="100%" stop-color="{dark}"/>'
        )
    else:  # matte-black
        stops = (
            f'<stop offset="0%" stop-color="{dark}"/>'
            f'<stop offset="50%" stop-color="{light}"/>'
            f'<stop offset="100%" stop-color="{dark}"/>'
        )
    return f'<linearGradient id="{gradient_id}" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient>', gradient_id


def rail_detail(casino, felt_path):
    """Stitching or stud detail printed on the rail, unique per casino."""
    style = casino["rail_style"]
    stitch = casino["rail_stitch"]
    if style in ("walnut", "rosewood-brass"):
        # brass studs along the rail
        return (
            f'<path d="{felt_path}" fill="none" stroke="{stitch}" stroke-width="3" '
            f'stroke-dasharray="2 26" stroke-linecap="round" opacity="0.9" '
            f'transform="translate(0,0)"/>'
        )
    if style == "piano-black":
        # magenta light strip inside the rail
        return (
            f'<path d="{felt_path}" fill="none" stroke="{stitch}" stroke-width="2.4" opacity="0.75"/>'
        )
    if style == "matte-black":
        return f'<path d="{felt_path}" fill="none" stroke="{stitch}" stroke-width="1.2" opacity="0.85"/>'
    # marble / steel: fine stitch line
    return (
        f'<path d="{felt_path}" fill="none" stroke="{stitch}" stroke-width="1.1" '
        f'stroke-dasharray="7 5" opacity="0.7"/>'
    )


def inner_border_ornament(casino, felt_path):
    """Decorative inner border just inside the felt edge."""
    ornament = casino["border_ornament"]
    gold, accent = casino["gold"], casino["accent"]
    if ornament == "arcade":
        return (
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="2.2" opacity="0.55" '
            f'transform="translate(0,0) scale(1)"/>'
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="0.9" '
            f'stroke-dasharray="16 9" opacity="0.6"/>'
        )
    if ornament == "orbit-rail":
        return (
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="1.4" opacity="0.5"/>'
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="0.7" '
            f'stroke-dasharray="3 7" opacity="0.55"/>'
        )
    if ornament == "petal-chain":
        return (
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="1.8" opacity="0.55"/>'
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="0.8" '
            f'stroke-dasharray="1.5 10" stroke-linecap="round" opacity="0.75"/>'
        )
    if ornament == "neon-lattice":
        return (
            f'<path d="{felt_path}" fill="none" stroke="{accent}" stroke-width="2" opacity="0.6"/>'
            f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="0.8" '
            f'stroke-dasharray="10 6" opacity="0.5"/>'
        )
    if ornament == "single-rule":
        return f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="1.1" opacity="0.6"/>'
    # keyfret
    return (
        f'<path d="{felt_path}" fill="none" stroke="{gold}" stroke-width="1.9" opacity="0.55"/>'
        f'<path d="{felt_path}" fill="none" stroke="{accent}" stroke-width="0.9" '
        f'stroke-dasharray="12 4 4 4" opacity="0.7"/>'
    )


def brand_medallion(casino, center_x, center_y, radius):
    """Abstract brand mark printed on the felt. Identifiable, never an official logo."""
    kind = casino["medallion"]
    gold, accent, line = casino["gold"], casino["accent"], casino["line_color"]
    inner = []
    if kind == "doge-arch":
        inner.append(
            f'<path d="M{center_x - radius * 0.5} {center_y + radius * 0.42} '
            f'Q{center_x} {center_y - radius * 0.55} {center_x + radius * 0.5} {center_y + radius * 0.42}" '
            f'fill="none" stroke="{gold}" stroke-width="2"/>'
            f'<path d="M{center_x - radius * 0.28} {center_y + radius * 0.42} '
            f'Q{center_x} {center_y - radius * 0.12} {center_x + radius * 0.28} {center_y + radius * 0.42}" '
            f'fill="none" stroke="{gold}" stroke-width="1.2" opacity="0.75"/>'
        )
    elif kind == "star-ring":
        inner.append(
            f'<circle cx="{center_x}" cy="{center_y}" r="{radius * 0.55}" fill="none" '
            f'stroke="{gold}" stroke-width="1.8"/>'
            f'<circle cx="{center_x}" cy="{center_y}" r="{radius * 0.55}" fill="none" '
            f'stroke="{casino["tie_band"]}" stroke-width="2.6" stroke-dasharray="18 40" '
            f'transform="rotate(-30 {center_x} {center_y})"/>'
            f'<circle cx="{center_x}" cy="{center_y - radius * 0.55}" r="2.6" fill="{gold}"/>'
        )
    elif kind == "prosperity-tree":
        inner.append(
            f'<path d="M{center_x} {center_y + radius * 0.45} V{center_y - radius * 0.1}" '
            f'stroke="{gold}" stroke-width="2"/>'
            f'<path d="M{center_x} {center_y - radius * 0.05} Q{center_x - radius * 0.42} '
            f'{center_y - radius * 0.3} {center_x - radius * 0.18} {center_y - radius * 0.62}" '
            f'fill="none" stroke="{gold}" stroke-width="1.5"/>'
            f'<path d="M{center_x} {center_y - radius * 0.05} Q{center_x + radius * 0.42} '
            f'{center_y - radius * 0.3} {center_x + radius * 0.18} {center_y - radius * 0.62}" '
            f'fill="none" stroke="{gold}" stroke-width="1.5"/>'
        )
    elif kind == "crystal-facet":
        inner.append(
            f'<path d="M{center_x} {center_y - radius * 0.6} L{center_x + radius * 0.5} {center_y} '
            f'L{center_x} {center_y + radius * 0.6} L{center_x - radius * 0.5} {center_y}Z" '
            f'fill="none" stroke="{accent}" stroke-width="2"/>'
            f'<path d="M{center_x} {center_y - radius * 0.3} L{center_x + radius * 0.25} {center_y} '
            f'L{center_x} {center_y + radius * 0.3} L{center_x - radius * 0.25} {center_y}Z" '
            f'fill="{gold}" opacity="0.45"/>'
        )
    elif kind == "feline-line":
        inner.append(
            f'<path d="M{center_x - radius * 0.45} {center_y + radius * 0.4} '
            f'Q{center_x} {center_y - radius * 0.62} {center_x + radius * 0.45} {center_y + radius * 0.4}" '
            f'fill="none" stroke="{gold}" stroke-width="1.8"/>'
            f'<path d="M{center_x - radius * 0.2} {center_y + radius * 0.4} V{center_y - radius * 0.02} '
            f'M{center_x + radius * 0.2} {center_y + radius * 0.4} V{center_y - radius * 0.02}" '
            f'stroke="{gold}" stroke-width="1.2" opacity="0.8"/>'
        )
    else:  # lotus-seal
        inner.append(
            f'<path d="M{center_x} {center_y + radius * 0.5} Q{center_x - radius * 0.6} {center_y} '
            f'{center_x} {center_y - radius * 0.55} Q{center_x + radius * 0.6} {center_y} '
            f'{center_x} {center_y + radius * 0.5}Z" fill="none" stroke="{gold}" stroke-width="1.8"/>'
            f'<path d="M{center_x} {center_y + radius * 0.32} Q{center_x - radius * 0.3} {center_y} '
            f'{center_x} {center_y - radius * 0.3} Q{center_x + radius * 0.3} {center_y} '
            f'{center_x} {center_y + radius * 0.32}Z" fill="{gold}" opacity="0.3"/>'
        )
    return (
        f'<g opacity="0.5">'
        f'<circle cx="{center_x}" cy="{center_y}" r="{radius}" fill="none" stroke="{gold}" '
        f'stroke-width="1.1" opacity="0.6"/>'
        f'{"".join(inner)}'
        f'<text x="{center_x}" y="{center_y + radius + 16}" text-anchor="middle" fill="{line}" '
        f'font-size="10" letter-spacing="4" opacity="0.7">{casino["chip_monogram"]}</text>'
        f'</g>'
    )


# --------------------------------------------------------------------------
# Seat betting groups placed on the real curved guest edge
# --------------------------------------------------------------------------

def seat_positions_on_arc(seat_count, center_x, center_y, radius_x, radius_y,
                          start_degrees=-152.0, end_degrees=-28.0):
    """Distribute seats along the lower guest arc of the kidney layout.

    Returns (x, y, facing_degrees) where facing_degrees rotates the printed
    betting boxes so they square up to the guest sitting at that position.
    """
    positions = []
    if seat_count == 1:
        steps = [0.5]
    else:
        steps = [index / (seat_count - 1) for index in range(seat_count)]
    for step in steps:
        angle_degrees = start_degrees + (end_degrees - start_degrees) * step
        angle = math.radians(angle_degrees)
        # Lower arc: sin is negated so the seats sit below the table centre.
        x = center_x + radius_x * math.cos(angle)
        y = center_y - radius_y * math.sin(angle)
        # Rotate the layout art to face the dealer at the flat edge.
        facing = math.degrees(math.atan2(x - center_x, radius_y * 1.35)) * 0.85
        positions.append((x, y, facing))
    return positions


def seat_betting_group(casino, seat_label, center_x, base_y, facing_degrees, scale=1.0):
    """One printed seat block: TIE (far) / BANKER (mid) / PLAYER (near) + pair circles.

    Real layouts print PLAYER closest to the guest and TIE furthest away,
    with the seat number repeated on the felt edge.
    """
    line, gold, tie = casino["line_color"], casino["gold"], casino["tie_band"]
    label_font = casino["label_font"]
    letter_spacing = 3.0 if casino["label_case"] == "roman-wide" else 1.8
    box_width = 104 * scale
    main_height = 27 * scale
    gap = 4.5 * scale
    tie_payout = casino["tie_payout"]

    parts = []

    player_y = base_y
    parts.append(
        f'<rect x="{-box_width / 2:.1f}" y="{player_y:.1f}" width="{box_width:.1f}" '
        f'height="{main_height:.1f}" rx="3.5" fill="#000000" fill-opacity="0.12" '
        f'stroke="{line}" stroke-width="1.7"/>'
        f'<text x="0" y="{player_y + main_height * 0.68:.1f}" text-anchor="middle" fill="{line}" '
        f'font-size="{11.5 * scale:.1f}" letter-spacing="{letter_spacing}" '
        f'font-family="{label_font}">PLAYER</text>'
    )

    banker_y = player_y - main_height - gap
    parts.append(
        f'<rect x="{-box_width / 2:.1f}" y="{banker_y:.1f}" width="{box_width:.1f}" '
        f'height="{main_height:.1f}" rx="3.5" fill="{casino["accent"]}" fill-opacity="0.20" '
        f'stroke="{gold}" stroke-width="1.9"/>'
        f'<text x="0" y="{banker_y + main_height * 0.68:.1f}" text-anchor="middle" fill="{gold}" '
        f'font-size="{11.5 * scale:.1f}" letter-spacing="{letter_spacing}" '
        f'font-family="{label_font}">BANKER</text>'
    )

    tie_height = main_height * 0.74
    tie_y = banker_y - tie_height - gap
    parts.append(
        f'<rect x="{-box_width * 0.40:.1f}" y="{tie_y:.1f}" width="{box_width * 0.80:.1f}" '
        f'height="{tie_height:.1f}" rx="3" fill="{tie}" fill-opacity="0.18" '
        f'stroke="{tie}" stroke-width="1.5"/>'
        f'<text x="0" y="{tie_y + tie_height * 0.70:.1f}" text-anchor="middle" fill="{tie}" '
        f'font-size="{9.5 * scale:.1f}" letter-spacing="2.2" '
        f'font-family="{label_font}">TIE {tie_payout}</text>'
    )

    # Pair side bets sit as small circles flanking the PLAYER box.
    pair_radius = 10.5 * scale
    pair_offset = box_width / 2 + pair_radius + 3.5 * scale
    for direction, tag in ((-1, "P"), (1, "B")):
        cx = direction * pair_offset
        parts.append(
            f'<circle cx="{cx:.1f}" cy="{player_y + main_height / 2:.1f}" r="{pair_radius:.1f}" '
            f'fill="none" stroke="{line}" stroke-width="1.2" opacity="0.8"/>'
            f'<text x="{cx:.1f}" y="{player_y + main_height / 2 + 3.4 * scale:.1f}" '
            f'text-anchor="middle" fill="{line}" font-size="{8.5 * scale:.1f}" '
            f'opacity="0.9">{tag}P</text>'
        )

    # Seat number printed at the felt edge in front of the guest.
    number_y = player_y + main_height + 19 * scale
    parts.append(
        f'<circle cx="0" cy="{number_y:.1f}" r="{11.5 * scale:.1f}" fill="#000000" '
        f'fill-opacity="0.25" stroke="{gold}" stroke-width="1.4"/>'
        f'<text x="0" y="{number_y + 4.2 * scale:.1f}" text-anchor="middle" fill="{gold}" '
        f'font-size="{12.5 * scale:.1f}" font-family="{label_font}">{seat_label}</text>'
    )

    return (
        f'<g transform="translate({center_x:.1f},{base_y * 0:.1f}) '
        f'rotate({facing_degrees:.2f} 0 {base_y:.1f})">'
        f'{"".join(parts)}</g>'
    )


# --------------------------------------------------------------------------
# Dealer working area
# --------------------------------------------------------------------------

def chip_tray_svg(casino, x, y, width=214, height=62):
    """Dealer float: five denomination rows sunk into the tray."""
    gold, line = casino["gold"], casino["line_color"]
    parts = [
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="7" '
        f'fill="#0B0B0D" stroke="{gold}" stroke-width="1.8"/>'
    ]
    slot_count = len(CHIP_DENOMINATIONS)
    inner_pad = 8
    slot_width = (width - inner_pad * 2 - (slot_count - 1) * 4) / slot_count
    for index, denomination in enumerate(CHIP_DENOMINATIONS):
        base = DENOMINATION_BASE[denomination]
        slot_x = x + inner_pad + index * (slot_width + 4)
        parts.append(
            f'<rect x="{slot_x:.1f}" y="{y + 12}" width="{slot_width:.1f}" height="{height - 26}" '
            f'rx="3" fill="{base["body"]}" opacity="0.9" stroke="{casino["chip_ring"]}" stroke-width="0.9"/>'
        )
        # stacked chip edges
        for edge in range(4):
            parts.append(
                f'<path d="M{slot_x + 2:.1f} {y + 18 + edge * 6} H{slot_x + slot_width - 2:.1f}" '
                f'stroke="{casino["chip_ring"]}" stroke-width="0.7" opacity="0.55"/>'
            )
    parts.append(
        f'<text x="{x + width / 2:.1f}" y="{y + height + 14}" text-anchor="middle" fill="{line}" '
        f'font-size="10.5" letter-spacing="2.4" opacity="0.85">CHIP TRAY 碼盤 (FLOAT)</text>'
    )
    return "".join(parts)


def shoe_svg(casino, x, y, width=112, height=64):
    """Eight-deck dealing shoe with a visible cut card."""
    gold, line = casino["gold"], casino["line_color"]
    return (
        f'<g>'
        f'<path d="M{x} {y + height} L{x + 10} {y} H{x + width - 10} L{x + width} {y + height}Z" '
        f'fill="#16130E" stroke="{gold}" stroke-width="1.7"/>'
        f'<rect x="{x + 18}" y="{y + 10}" width="{width - 36}" height="{height - 26}" rx="2" '
        f'fill="{casino["card_back"]}" opacity="0.92" stroke="{gold}" stroke-width="0.8"/>'
        f'<rect x="{x + 24}" y="{y + 6}" width="{width - 48}" height="6" rx="1.5" '
        f'fill="#C8302E" stroke="#8A1A18" stroke-width="0.6"/>'
        f'<text x="{x + width / 2:.1f}" y="{y + height + 14}" text-anchor="middle" fill="{line}" '
        f'font-size="10.5" letter-spacing="2.2" opacity="0.85">SHOE 牌靴 · 8 DECKS</text>'
        f'</g>'
    )


def discard_rack_svg(casino, x, y, width=84, height=52):
    gold, line = casino["gold"], casino["line_color"]
    return (
        f'<g>'
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="#0C0C0E" '
        f'stroke="{line}" stroke-width="1.3" opacity="0.9"/>'
        f'<rect x="{x + 8}" y="{y + 10}" width="{width - 16}" height="{height - 20}" rx="2" '
        f'fill="{casino["card_back"]}" opacity="0.55" stroke="{gold}" stroke-width="0.7"/>'
        f'<text x="{x + width / 2:.1f}" y="{y + height + 13}" text-anchor="middle" fill="{line}" '
        f'font-size="10" letter-spacing="1.8" opacity="0.8">DISCARD 棄牌</text>'
        f'</g>'
    )


def drop_slot_svg(casino, x, y, width=76, height=46):
    gold, line = casino["gold"], casino["line_color"]
    return (
        f'<g>'
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="#08080A" '
        f'stroke="{line}" stroke-width="1.2" opacity="0.9"/>'
        f'<rect x="{x + 12}" y="{y + 14}" width="{width - 24}" height="5" rx="2.5" fill="{gold}" opacity="0.7"/>'
        f'<text x="{x + width / 2:.1f}" y="{y + height + 13}" text-anchor="middle" fill="{line}" '
        f'font-size="10" letter-spacing="1.8" opacity="0.8">DROP 錢箱</text>'
        f'</g>'
    )


def commission_row_svg(casino, x, y, seat_labels):
    """Numbered lammer boxes, one per seat, only on commission tables."""
    gold, line = casino["gold"], casino["line_color"]
    parts = [
        f'<text x="{x}" y="{y - 9}" fill="{line}" font-size="10.5" letter-spacing="2.2" '
        f'opacity="0.9">COMMISSION 佣金格 · 5% LAMMER</text>'
    ]
    box_width, box_height, spacing = 40, 27, 6
    for index, label in enumerate(seat_labels):
        box_x = x + index * (box_width + spacing)
        parts.append(
            f'<rect x="{box_x}" y="{y}" width="{box_width}" height="{box_height}" rx="2.5" '
            f'fill="#000000" fill-opacity="0.2" stroke="{gold}" stroke-width="1.1" opacity="0.9"/>'
            f'<text x="{box_x + box_width / 2}" y="{y + 18}" text-anchor="middle" fill="{gold}" '
            f'font-size="11.5" font-family="{casino["label_font"]}">{label}</text>'
        )
    return "".join(parts)


def no_commission_banner_svg(casino, x, y, width=286, height=32):
    gold = casino["gold"]
    return (
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" '
        f'fill="{casino["accent"]}" fill-opacity="0.28" stroke="{gold}" stroke-width="1.4"/>'
        f'<text x="{x + width / 2:.1f}" y="{y + 21}" text-anchor="middle" fill="{gold}" '
        f'font-size="12" letter-spacing="1.8" font-family="{casino["label_font"]}">'
        f'NO COMMISSION · 莊 6 半賠 0.5:1</text>'
    )


# --------------------------------------------------------------------------
# Table layout
# --------------------------------------------------------------------------

TABLE_WIDTH, TABLE_HEIGHT = 1240, 720

# Kidney-shaped felt: flat dealer edge on top, curved guest edge below,
# with the two shallow cut-outs a real big-table layout has beside the dealer.
FELT_PATH = (
    "M150 128 "
    "H1090 "
    "C1140 128 1172 168 1172 236 "
    "C1172 452 1010 618 620 618 "
    "C230 618 68 452 68 236 "
    "C68 168 100 128 150 128 Z"
)

DEALER_NOTCH_PATH = (
    "M470 128 C470 176 530 196 620 196 C710 196 770 176 770 128 Z"
)


def table_layout_svg(casino, layout="mass"):
    """Full printed baccarat layout for one casino and one room tier."""
    line, gold = casino["line_color"], casino["gold"]
    label_font = casino["label_font"]
    weave_pattern, weave_id = felt_weave_pattern(casino)
    rail_gradient, rail_id = rail_material(casino)

    if layout == "mass":
        seat_labels = MASS_SEAT_LABELS
        seat_scale = 0.88
        tier_name = "大眾廳 MASS"
        limit_min, limit_max = casino["mass_min"], casino["mass_max"]
    else:
        seat_labels = VIP_SEAT_LABELS
        seat_scale = 1.0
        tier_name = "貴賓廳 VIP"
        limit_min, limit_max = casino["vip_min"], casino["vip_max"]

    parts = [
        f'<svg viewBox="0 0 {TABLE_WIDTH} {TABLE_HEIGHT}" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="{casino["display_name"]} {tier_name} 百家樂牌桌版面">',
        '<defs>',
        weave_pattern,
        rail_gradient,
        f'<radialGradient id="feltlit-{casino["casino_id"]}" cx="50%" cy="16%" r="88%">'
        f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.17"/>'
        f'<stop offset="55%" stop-color="#000000" stop-opacity="0.02"/>'
        f'<stop offset="100%" stop-color="#000000" stop-opacity="0.42"/>'
        f'</radialGradient>',
        f'<linearGradient id="feltbase-{casino["casino_id"]}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="{casino["felt_main"]}"/>'
        f'<stop offset="58%" stop-color="{casino["felt_mid"]}"/>'
        f'<stop offset="100%" stop-color="{casino["felt_shadow"]}"/>'
        f'</linearGradient>',
        '</defs>',
        f'<rect width="{TABLE_WIDTH}" height="{TABLE_HEIGHT}" fill="#08080B"/>',
        # Padded rail behind the felt
        f'<path d="{FELT_PATH}" fill="none" stroke="url(#{rail_id})" stroke-width="52" stroke-linejoin="round"/>',
        rail_detail(casino, FELT_PATH),
        # Felt surface: base gradient, weave, lighting
        f'<path d="{FELT_PATH}" fill="url(#feltbase-{casino["casino_id"]})"/>',
        f'<path d="{FELT_PATH}" fill="url(#{weave_id})"/>',
        f'<path d="{FELT_PATH}" fill="url(#feltlit-{casino["casino_id"]})"/>',
        inner_border_ornament(casino, FELT_PATH),
    ]

    # Dealer stand-off notch at the flat edge
    parts.append(
        f'<path d="{DEALER_NOTCH_PATH}" fill="{casino["felt_shadow"]}" fill-opacity="0.55" '
        f'stroke="{gold}" stroke-width="1.1" stroke-opacity="0.5"/>'
        f'<text x="620" y="176" text-anchor="middle" fill="{gold}" font-size="11.5" '
        f'letter-spacing="4" font-family="{label_font}" opacity="0.85">DEALER 荷官</text>'
    )

    # Dealer equipment: shoe right of dealer, tray centre, discard and drop slot
    parts.append(chip_tray_svg(casino, 513, 206))
    parts.append(shoe_svg(casino, 800, 200))
    parts.append(discard_rack_svg(casino, 930, 206))
    parts.append(drop_slot_svg(casino, 398, 210))

    # Commission lammer boxes only exist on commission tables
    if casino["commission"]:
        parts.append(commission_row_svg(casino, 132, 286, seat_labels))
    else:
        parts.append(no_commission_banner_svg(casino, 120, 288))

    # Central dealing spots for the two hands
    parts.append(
        f'<g>'
        f'<rect x="466" y="330" width="132" height="92" rx="5" fill="#000000" fill-opacity="0.16" '
        f'stroke="{line}" stroke-width="1.7" stroke-dasharray="7 5"/>'
        f'<text x="532" y="322" text-anchor="middle" fill="{line}" font-size="12.5" letter-spacing="3.5" '
        f'font-family="{label_font}">PLAYER 閒</text>'
        f'<rect x="642" y="330" width="132" height="92" rx="5" fill="{casino["accent"]}" fill-opacity="0.22" '
        f'stroke="{gold}" stroke-width="1.7" stroke-dasharray="7 5"/>'
        f'<text x="708" y="322" text-anchor="middle" fill="{gold}" font-size="12.5" letter-spacing="3.5" '
        f'font-family="{label_font}">BANKER 莊</text>'
        f'</g>'
    )

    # Brand medallion printed between the dealing spots and the seat arc
    parts.append(brand_medallion(casino, 620, 462, 40))

    # Seat betting blocks on the guest arc
    positions = seat_positions_on_arc(
        len(seat_labels), center_x=620, center_y=250,
        radius_x=470 if layout == "mass" else 400,
        radius_y=300 if layout == "mass" else 285,
    )
    for (seat_x, seat_y, facing), label in zip(positions, seat_labels):
        parts.append(seat_betting_group(casino, label, seat_x, seat_y, facing, seat_scale))

    # Limit plaque on the felt corner, tier caption, compliance mark
    parts.append(limit_plaque_svg(casino, limit_min, limit_max, casino["currency"], x=86, y=352))
    parts.append(
        f'<text x="1176" y="120" text-anchor="end" fill="{gold}" font-size="13" letter-spacing="4" '
        f'font-family="{label_font}">{tier_name}</text>'
    )
    if casino["smart_table"]:
        parts.append(
            f'<text x="1176" y="142" text-anchor="end" fill="{line}" font-size="10.5" '
            f'letter-spacing="2" opacity="0.7">SMART TABLE 智能桌</text>'
        )
    else:
        parts.append(
            f'<text x="1176" y="142" text-anchor="end" fill="{line}" font-size="10.5" '
            f'letter-spacing="2" opacity="0.7">TRADITIONAL 傳統桌</text>'
        )
    parts.append(
        f'<text x="{TABLE_WIDTH - 24}" y="{TABLE_HEIGHT - 18}" text-anchor="end" fill="{line}" '
        f'font-size="10.5" opacity="0.5">訓練仿真 · 非官方授權 · 訓練幣結算</text>'
    )
    parts.append('</svg>')
    return "".join(parts)


def limit_plaque_svg(casino, limit_min, limit_max, currency, x=0, y=0):
    """Table minimum/maximum plaque. Casing style differs per property."""
    style = casino["plaque_style"]
    gold, line = casino["gold"], casino["line_color"]
    label_font = casino["label_font"]
    width, height = 138, 96

    if style == "capsule-led":
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{height / 2}" '
            f'fill="#0A1622" stroke="{gold}" stroke-width="2"/>'
            f'<rect x="{x + 5}" y="{y + 5}" width="{width - 10}" height="{height - 10}" '
            f'rx="{(height - 10) / 2}" fill="none" stroke="{casino["accent"]}" stroke-width="1" opacity="0.7"/>'
        )
    elif style == "vertical-black":
        width, height = 104, 122
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="3" fill="#0D0D0D" '
            f'stroke="{gold}" stroke-width="2"/>'
            f'<rect x="{x + 6}" y="{y + 6}" width="{width - 12}" height="{height - 12}" rx="1" '
            f'fill="none" stroke="{gold}" stroke-width="0.7" opacity="0.55"/>'
        )
    elif style == "wood-brass":
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="7" fill="{casino["rail_dark"]}" '
            f'stroke="{gold}" stroke-width="3"/>'
            f'<rect x="{x + 7}" y="{y + 7}" width="{width - 14}" height="{height - 14}" rx="4" '
            f'fill="#140C06" stroke="{gold}" stroke-width="1"/>'
        )
    elif style == "neon-edge":
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="#0A0410" '
            f'stroke="{casino["accent"]}" stroke-width="3"/>'
            f'<rect x="{x + 6}" y="{y + 6}" width="{width - 12}" height="{height - 12}" rx="2" '
            f'fill="none" stroke="{gold}" stroke-width="1" opacity="0.85"/>'
        )
    elif style == "red-gold":
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="4" fill="{casino["accent"]}" '
            f'stroke="{gold}" stroke-width="3"/>'
            f'<rect x="{x + 7}" y="{y + 7}" width="{width - 14}" height="{height - 14}" rx="2" '
            f'fill="none" stroke="{gold}" stroke-width="0.9" opacity="0.8"/>'
        )
    else:  # brass-plate
        shell = (
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="3" fill="#171208" '
            f'stroke="{gold}" stroke-width="2.5"/>'
            f'<rect x="{x + 6}" y="{y + 6}" width="{width - 12}" height="{height - 12}" rx="1" '
            f'fill="none" stroke="{gold}" stroke-width="0.8" opacity="0.6"/>'
        )

    center_x = x + width / 2
    return (
        f'{shell}'
        f'<text x="{center_x:.1f}" y="{y + 26}" text-anchor="middle" fill="{gold}" font-size="10.5" '
        f'letter-spacing="2.5" font-family="{label_font}">BACCARAT 百家樂</text>'
        f'<line x1="{x + 16}" y1="{y + 34}" x2="{x + width - 16}" y2="{y + 34}" stroke="{gold}" '
        f'stroke-width="0.7" opacity="0.6"/>'
        f'<text x="{center_x:.1f}" y="{y + 56}" text-anchor="middle" fill="{line}" font-size="12.5" '
        f'font-family="{label_font}">MIN {currency} {limit_min:,}</text>'
        f'<text x="{center_x:.1f}" y="{y + 78}" text-anchor="middle" fill="{line}" font-size="12.5" '
        f'font-family="{label_font}">MAX {currency} {limit_max:,}</text>'
    )


# --------------------------------------------------------------------------
# Playing cards
# --------------------------------------------------------------------------

CARD_WIDTH, CARD_HEIGHT = 132, 186

# Standard pip positions (fractions of the inner card area) used by real decks.
PIP_LAYOUTS = {
    "A": [(0.5, 0.5)],
    "2": [(0.5, 0.18), (0.5, 0.82)],
    "3": [(0.5, 0.18), (0.5, 0.5), (0.5, 0.82)],
    "4": [(0.28, 0.18), (0.72, 0.18), (0.28, 0.82), (0.72, 0.82)],
    "5": [(0.28, 0.18), (0.72, 0.18), (0.5, 0.5), (0.28, 0.82), (0.72, 0.82)],
    "6": [(0.28, 0.18), (0.72, 0.18), (0.28, 0.5), (0.72, 0.5), (0.28, 0.82), (0.72, 0.82)],
    "7": [(0.28, 0.18), (0.72, 0.18), (0.5, 0.34), (0.28, 0.5), (0.72, 0.5),
          (0.28, 0.82), (0.72, 0.82)],
    "8": [(0.28, 0.18), (0.72, 0.18), (0.5, 0.34), (0.28, 0.5), (0.72, 0.5),
          (0.5, 0.66), (0.28, 0.82), (0.72, 0.82)],
    "9": [(0.28, 0.16), (0.72, 0.16), (0.28, 0.38), (0.72, 0.38), (0.5, 0.5),
          (0.28, 0.62), (0.72, 0.62), (0.28, 0.84), (0.72, 0.84)],
}
FACE_RANKS = {"J", "Q", "K"}


def card_engraving_pattern(casino):
    """Guilloche-style engraving used on the card back, unique per casino."""
    style = casino["card_engrave"]
    gold = casino["gold"]
    accent = casino["accent"]
    pattern_id = f'cardpat-{casino["casino_id"]}'
    if style == "arch":
        tile = 22
        body = (
            f'<path d="M2 19 Q11 4 20 19" fill="none" stroke="{gold}" stroke-width="1.15" opacity="0.85"/>'
            f'<path d="M7 19 Q11 12 15 19" fill="none" stroke="{gold}" stroke-width="0.6" opacity="0.55"/>'
        )
    elif style == "orbit":
        tile = 22
        body = (
            f'<circle cx="11" cy="11" r="7.5" fill="none" stroke="{gold}" stroke-width="1" opacity="0.8"/>'
            f'<circle cx="11" cy="11" r="1.8" fill="{gold}" opacity="0.9"/>'
        )
    elif style == "petal":
        tile = 22
        body = (
            f'<path d="M11 2 Q17 11 11 20 Q5 11 11 2Z" fill="none" stroke="{gold}" '
            f'stroke-width="1" opacity="0.85"/>'
            f'<path d="M2 11 Q11 6 20 11 Q11 16 2 11Z" fill="none" stroke="{gold}" '
            f'stroke-width="0.55" opacity="0.45"/>'
        )
    elif style == "lattice":
        tile = 20
        body = (
            f'<path d="M10 1 L19 10 L10 19 L1 10Z" fill="none" stroke="{accent}" '
            f'stroke-width="1.1" opacity="0.95"/>'
            f'<path d="M10 6 L14 10 L10 14 L6 10Z" fill="{gold}" opacity="0.6"/>'
        )
    elif style == "feline-line":
        tile = 24
        body = (
            f'<path d="M4 18 Q12 3 20 18" fill="none" stroke="{gold}" stroke-width="1" opacity="0.8"/>'
            f'<path d="M8 18 V13 M12 18 V11 M16 18 V13" stroke="{gold}" stroke-width="0.75" opacity="0.6"/>'
        )
    else:  # lotus
        tile = 22
        body = (
            f'<path d="M11 20 Q3 12 11 2 Q19 12 11 20Z" fill="none" stroke="{gold}" '
            f'stroke-width="1" opacity="0.85"/>'
            f'<path d="M11 17 Q7 12 11 6 Q15 12 11 17Z" fill="{gold}" opacity="0.35"/>'
        )
    return (
        f'<pattern id="{pattern_id}" width="{tile}" height="{tile}" patternUnits="userSpaceOnUse">'
        f'{body}</pattern>'
    ), pattern_id


def card_back_svg(casino, width=CARD_WIDTH, height=CARD_HEIGHT):
    """Card back with the real white margin, engraved field and centre medallion."""
    engraving, engraving_id = card_engraving_pattern(casino)
    gold, back = casino["gold"], casino["card_back"]
    margin = 7
    inner_x, inner_y = margin, margin
    inner_w, inner_h = width - margin * 2, height - margin * 2
    return (
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" aria-label="牌背 Card back">'
        f'<defs>{engraving}</defs>'
        f'<rect width="{width}" height="{height}" rx="10" fill="#FCFBF6" stroke="#DCD5C2" stroke-width="1"/>'
        f'<rect x="{inner_x}" y="{inner_y}" width="{inner_w}" height="{inner_h}" rx="6" fill="{back}"/>'
        f'<rect x="{inner_x}" y="{inner_y}" width="{inner_w}" height="{inner_h}" rx="6" '
        f'fill="url(#{engraving_id})"/>'
        f'<rect x="{inner_x + 5}" y="{inner_y + 5}" width="{inner_w - 10}" height="{inner_h - 10}" rx="4" '
        f'fill="none" stroke="{gold}" stroke-width="1.1" opacity="0.9"/>'
        f'{brand_medallion(casino, width / 2, height / 2, 25)}'
        f'</svg>'
    )


def suit_glyph(suit, x, y, size, color, rotate=0):
    transform = f' transform="rotate({rotate} {x:.1f} {y:.1f})"' if rotate else ""
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" dominant-baseline="central" '
        f'fill="{color}" font-size="{size:.1f}"{transform}>{suit}</text>'
    )


def card_face_svg(casino, rank, suit, width=CARD_WIDTH, height=CARD_HEIGHT):
    """Face-up card using standard pip layout so it reads like a real card."""
    color = "#C4141C" if suit in {"♥", "♦"} else "#151515"
    gold = casino["gold"]
    parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'aria-label="{rank}{suit}">',
        f'<rect width="{width}" height="{height}" rx="10" fill="#FCFBF6" stroke="#D8D1BE" stroke-width="1"/>',
        f'<rect x="5" y="5" width="{width - 10}" height="{height - 10}" rx="7" fill="none" '
        f'stroke="{gold}" stroke-width="0.7" opacity="0.45"/>',
    ]

    # Corner indices, top-left and rotated bottom-right, as on real cards.
    for rotation in (0, 180):
        group_transform = (
            "" if rotation == 0 else f' transform="rotate(180 {width / 2} {height / 2})"'
        )
        parts.append(
            f'<g{group_transform}>'
            f'<text x="17" y="31" text-anchor="middle" fill="{color}" font-size="19" '
            f'font-family="Georgia,serif" font-weight="600">{rank}</text>'
            f'{suit_glyph(suit, 17, 47, 15, color)}'
            f'</g>'
        )

    inner_left, inner_top = 30.0, 30.0
    inner_right, inner_bottom = width - 30.0, height - 30.0
    inner_width = inner_right - inner_left
    inner_height = inner_bottom - inner_top

    if rank in FACE_RANKS:
        # Court cards: framed panel with the letter and mirrored suit marks.
        parts.append(
            f'<rect x="{inner_left}" y="{inner_top}" width="{inner_width}" height="{inner_height}" '
            f'rx="5" fill="{casino["accent"]}" fill-opacity="0.10" stroke="{gold}" '
            f'stroke-width="1" opacity="0.9"/>'
            f'<line x1="{inner_left}" y1="{height / 2}" x2="{inner_right}" y2="{height / 2}" '
            f'stroke="{gold}" stroke-width="0.7" opacity="0.5"/>'
        )
        for rotation in (0, 180):
            group_transform = (
                "" if rotation == 0 else f' transform="rotate(180 {width / 2} {height / 2})"'
            )
            parts.append(
                f'<g{group_transform}>'
                f'<text x="{width / 2}" y="{inner_top + 34}" text-anchor="middle" fill="{color}" '
                f'font-size="30" font-family="Georgia,serif">{rank}</text>'
                f'{suit_glyph(suit, width / 2, inner_top + 58, 17, color)}'
                f'</g>'
            )
    elif rank == "T":
        pips = PIP_LAYOUTS["9"] + [(0.5, 0.5)]
        for fraction_x, fraction_y in PIP_LAYOUTS["8"]:
            pass
        # 10 is drawn as two columns of five.
        parts.append('')
        ten_positions = [
            (0.28, 0.14), (0.72, 0.14), (0.28, 0.32), (0.72, 0.32), (0.5, 0.42),
            (0.28, 0.58), (0.72, 0.58), (0.5, 0.58), (0.28, 0.86), (0.72, 0.86),
        ]
        for fraction_x, fraction_y in ten_positions:
            cx = inner_left + inner_width * fraction_x
            cy = inner_top + inner_height * fraction_y
            rotate = 180 if fraction_y > 0.5 else 0
            parts.append(suit_glyph(suit, cx, cy, 20, color, rotate))
    else:
        for fraction_x, fraction_y in PIP_LAYOUTS[rank]:
            cx = inner_left + inner_width * fraction_x
            cy = inner_top + inner_height * fraction_y
            size = 40 if rank == "A" else 22
            rotate = 180 if fraction_y > 0.55 and rank != "A" else 0
            parts.append(suit_glyph(suit, cx, cy, size, color, rotate))

    parts.append('</svg>')
    return "".join(parts)


# --------------------------------------------------------------------------
# Chips
# --------------------------------------------------------------------------

def chip_svg(casino, denomination, size=124):
    """Casino chip: denomination body colour, casino ring inserts and mould edge."""
    base = DENOMINATION_BASE[denomination]
    body, text_color, label = base["body"], base["text"], base["label"]
    ring = casino["chip_ring"]
    mould = casino["chip_mould"]
    insert_count = casino["chip_inserts"]
    center = size / 2
    outer_radius = center - 4

    parts = [
        f'<svg viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg" '
        f'aria-label="{denomination} 訓練幣籌碼">',
        f'<defs><radialGradient id="chipshade-{casino["casino_id"]}-{denomination}" cx="38%" cy="30%" r="78%">'
        f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.28"/>'
        f'<stop offset="62%" stop-color="#000000" stop-opacity="0.05"/>'
        f'<stop offset="100%" stop-color="#000000" stop-opacity="0.42"/>'
        f'</radialGradient></defs>',
        f'<circle cx="{center}" cy="{center}" r="{outer_radius}" fill="{body}"/>',
    ]

    # Edge inserts: the visual signature that differs per casino mould.
    for index in range(insert_count):
        angle = (360 / insert_count) * index
        if mould == "fine-teeth":
            parts.append(
                f'<rect x="{center - 5}" y="{center - outer_radius}" width="10" height="15" rx="1.5" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )
        elif mould == "double-ring":
            parts.append(
                f'<rect x="{center - 8}" y="{center - outer_radius}" width="16" height="11" rx="5.5" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )
        elif mould == "wide-gold":
            parts.append(
                f'<rect x="{center - 11}" y="{center - outer_radius}" width="22" height="17" rx="2" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )
        elif mould == "bevel":
            parts.append(
                f'<polygon points="{center - 9},{center - outer_radius} {center + 9},{center - outer_radius} '
                f'{center + 4},{center - outer_radius + 16} {center - 4},{center - outer_radius + 16}" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )
        elif mould == "square-edge":
            parts.append(
                f'<rect x="{center - 8}" y="{center - outer_radius}" width="16" height="14" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )
        else:  # copper-teeth
            parts.append(
                f'<polygon points="{center},{center - outer_radius} '
                f'{center + 7},{center - outer_radius + 15} {center - 7},{center - outer_radius + 15}" '
                f'fill="{ring}" transform="rotate({angle} {center} {center})"/>'
            )

    parts.append(
        f'<circle cx="{center}" cy="{center}" r="{outer_radius - 17}" fill="{body}" '
        f'stroke="{ring}" stroke-width="1.6"/>'
        f'<circle cx="{center}" cy="{center}" r="{outer_radius - 27}" fill="none" '
        f'stroke="{ring}" stroke-width="0.8" opacity="0.6"/>'
        f'<text x="{center}" y="{center - 6}" text-anchor="middle" fill="{ring}" font-size="10" '
        f'letter-spacing="1.6" font-family="{casino["label_font"]}">{casino["chip_monogram"]}</text>'
        f'<text x="{center}" y="{center + 16}" text-anchor="middle" fill="{text_color}" '
        f'font-size="19" font-weight="700" font-family="{casino["label_font"]}">{label}</text>'
        f'<circle cx="{center}" cy="{center}" r="{outer_radius}" fill="url(#chipshade-{casino["casino_id"]}-{denomination})"/>'
        f'<circle cx="{center}" cy="{center}" r="{outer_radius}" fill="none" stroke="#000000" '
        f'stroke-width="1" stroke-opacity="0.35"/>'
    )
    parts.append('</svg>')
    return "".join(parts)


def chip_stack_svg(casino, denomination, count=6, width=132, height=150):
    """Side view of a chip stack so trainees learn to read stack heights."""
    base = DENOMINATION_BASE[denomination]
    ring = casino["chip_ring"]
    chip_height = 11
    chip_width = 92
    left = (width - chip_width) / 2
    parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'aria-label="{denomination} 碼堆側視">'
    ]
    for index in range(count):
        y = height - 18 - (index + 1) * chip_height
        parts.append(
            f'<rect x="{left}" y="{y}" width="{chip_width}" height="{chip_height}" rx="4" '
            f'fill="{base["body"]}" stroke="#000000" stroke-opacity="0.35" stroke-width="0.8"/>'
            f'<rect x="{left}" y="{y + chip_height / 2 - 1.2}" width="{chip_width}" height="2.4" '
            f'fill="{ring}" opacity="0.85"/>'
        )
    parts.append(
        f'<ellipse cx="{width / 2}" cy="{height - 18 - count * chip_height}" rx="{chip_width / 2}" '
        f'ry="6" fill="{base["body"]}" stroke="{ring}" stroke-width="1.2"/>'
        f'<text x="{width / 2}" y="{height - 4}" text-anchor="middle" fill="{ring}" font-size="11" '
        f'font-family="{casino["label_font"]}">{base["label"]} × {count}</text>'
    )
    parts.append('</svg>')
    return "".join(parts)


# --------------------------------------------------------------------------
# Macau roadmaps (bead plate, big road, and the three derived roads)
# --------------------------------------------------------------------------

BEAD_PLATE_ROWS = 6
BIG_ROAD_ROWS = 6


def build_bead_plate(outcomes):
    """Bead plate cells in draw order; the grid fills top-to-bottom per column."""
    return [
        {"side": side, "player_pair": player_pair, "banker_pair": banker_pair}
        for side, player_pair, banker_pair in outcomes
    ]


def build_big_road(outcomes):
    """Big road columns: a new column starts whenever the winning side changes.

    Ties do not open a cell of their own; they annotate the most recent cell.
    """
    columns = []
    current_column = []
    current_side = None

    for side, _player_pair, _banker_pair in outcomes:
        if side == "T":
            if current_column:
                current_column[-1]["ties"] += 1
            elif columns:
                columns[-1][-1]["ties"] += 1
            continue
        if side != current_side:
            if current_column:
                columns.append(current_column)
            current_column = []
            current_side = side
        current_column.append({"side": side, "ties": 0})

    if current_column:
        columns.append(current_column)
    return columns


def build_derived_road(big_road_columns, offset):
    """Derived roads compare column depths at a fixed offset.

    offset 1 = big eye boy, 2 = small road, 3 = cockroach pig.
    Red marks a 'regular' comparison, blue marks an 'irregular' one.
    """
    marks = []
    for column_index in range(offset + 1, len(big_road_columns)):
        compared = big_road_columns[column_index - offset]
        reference = big_road_columns[column_index - offset - 1]
        marks.append("R" if len(compared) == len(reference) else "B")
    return marks


def board_chrome(casino, width, height):
    """Display housing around the roadmaps, styled per casino."""
    style = casino["board_style"]
    gold, rail_dark = casino["gold"], casino["rail_dark"]
    accent = casino["accent"]

    if style == "stone":
        return (
            f'<rect width="{width}" height="{height}" rx="9" fill="#0E1A15" '
            f'stroke="{casino["rail"]}" stroke-width="4"/>'
            f'<rect x="11" y="11" width="{width - 22}" height="{height - 22}" rx="4" fill="#0A140F" '
            f'stroke="{gold}" stroke-width="1.3"/>'
        ), "#2C3E36", "Georgia,serif"
    if style == "hud":
        return (
            f'<rect width="{width}" height="{height}" rx="12" fill="#07121C" '
            f'stroke="{gold}" stroke-width="1.4"/>'
            f'<path d="M14 4 H{width - 14}" stroke="{casino["tie_band"]}" stroke-width="2" opacity="0.7"/>'
        ), "#27455C", "'Segoe UI',system-ui,sans-serif"
    if style == "walnut":
        return (
            f'<rect width="{width}" height="{height}" rx="10" fill="{rail_dark}"/>'
            f'<rect x="9" y="9" width="{width - 18}" height="{height - 18}" rx="5" fill="#0B1811" '
            f'stroke="{gold}" stroke-width="2.2"/>'
        ), "#33473C", "Georgia,serif"
    if style == "neon":
        return (
            f'<rect width="{width}" height="{height}" rx="10" fill="#08040E" '
            f'stroke="{accent}" stroke-width="2.6"/>'
            f'<rect x="8" y="8" width="{width - 16}" height="{height - 16}" rx="6" fill="none" '
            f'stroke="{casino["tie_band"]}" stroke-width="1" opacity="0.55"/>'
        ), "#3A2050", "'Segoe UI',system-ui,sans-serif"
    if style == "gallery":
        return (
            f'<rect width="{width}" height="{height}" rx="3" fill="#0B0B0B" '
            f'stroke="{gold}" stroke-width="1.2"/>'
            f'<rect x="13" y="13" width="{width - 26}" height="{height - 26}" rx="1" fill="none" '
            f'stroke="{gold}" stroke-width="0.6" opacity="0.45"/>'
        ), "#2E2E2E", "'Helvetica Neue',Arial,sans-serif"
    # classic-cn
    return (
        f'<rect width="{width}" height="{height}" rx="8" fill="#150908" '
        f'stroke="{gold}" stroke-width="2.6"/>'
        f'<rect x="10" y="10" width="{width - 20}" height="{height - 20}" rx="3" fill="none" '
        f'stroke="{accent}" stroke-width="1.5" opacity="0.85"/>'
    ), "#4A2020", "'KaiTi','STKaiti',Georgia,serif"


BANKER_RED = "#D42A2A"
PLAYER_BLUE = "#1E6FD9"
TIE_GREEN = "#2E9E4F"


def roadmap_svg(casino, outcomes):
    """Bead plate + big road + big eye boy + small road + cockroach pig."""
    width, height = 1240, 520
    chrome, grid_color, title_font = board_chrome(casino, width, height)
    gold, line = casino["gold"], casino["line_color"]

    bead_cells = build_bead_plate(outcomes)
    big_road_columns = build_big_road(outcomes)

    parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="{casino["display_name"]} 計分器五路">',
        chrome,
    ]

    def section_title(x, y, chinese, english):
        return (
            f'<text x="{x}" y="{y}" fill="{gold}" font-size="13" letter-spacing="2.4" '
            f'font-family="{title_font}">{chinese}</text>'
            f'<text x="{x}" y="{y + 15}" fill="{line}" font-size="9.5" letter-spacing="1.8" '
            f'opacity="0.62">{english}</text>'
        )

    # ---- Bead plate: 6 rows per column, filled top to bottom ----
    bead_x, bead_y, bead_cell = 36, 74, 34
    bead_columns = 11
    parts.append(section_title(bead_x, 46, "珠盤路", "BEAD PLATE"))
    for column in range(bead_columns):
        for row in range(BEAD_PLATE_ROWS):
            cx = bead_x + column * bead_cell
            cy = bead_y + row * bead_cell
            parts.append(
                f'<rect x="{cx}" y="{cy}" width="{bead_cell}" height="{bead_cell}" '
                f'fill="none" stroke="{grid_color}" stroke-width="0.9"/>'
            )
    for index, cell in enumerate(bead_cells):
        column, row = divmod(index, BEAD_PLATE_ROWS)
        if column >= bead_columns:
            break
        cx = bead_x + column * bead_cell + bead_cell / 2
        cy = bead_y + row * bead_cell + bead_cell / 2
        fill = {"B": BANKER_RED, "P": PLAYER_BLUE, "T": TIE_GREEN}[cell["side"]]
        glyph = {"B": "莊", "P": "閒", "T": "和"}[cell["side"]]
        parts.append(
            f'<circle cx="{cx}" cy="{cy}" r="{bead_cell * 0.38:.1f}" fill="{fill}"/>'
            f'<text x="{cx}" y="{cy + 4}" text-anchor="middle" fill="#FFFFFF" font-size="11" '
            f'font-family="{title_font}">{glyph}</text>'
        )
        # Pair dots follow the real convention: player pair bottom-left, banker pair top-right.
        if cell["player_pair"]:
            parts.append(
                f'<circle cx="{cx - bead_cell * 0.32:.1f}" cy="{cy + bead_cell * 0.30:.1f}" r="3.1" '
                f'fill="{PLAYER_BLUE}" stroke="#FFFFFF" stroke-width="0.8"/>'
            )
        if cell["banker_pair"]:
            parts.append(
                f'<circle cx="{cx + bead_cell * 0.32:.1f}" cy="{cy - bead_cell * 0.30:.1f}" r="3.1" '
                f'fill="{BANKER_RED}" stroke="#FFFFFF" stroke-width="0.8"/>'
            )

    # ---- Big road: hollow circles, new column on a change of side ----
    big_x = bead_x + bead_columns * bead_cell + 30
    big_y, big_cell = bead_y, 30
    big_columns = 21
    parts.append(section_title(big_x, 46, "大路", "BIG ROAD"))
    for column in range(big_columns):
        for row in range(BIG_ROAD_ROWS):
            parts.append(
                f'<rect x="{big_x + column * big_cell}" y="{big_y + row * big_cell}" '
                f'width="{big_cell}" height="{big_cell}" fill="none" stroke="{grid_color}" '
                f'stroke-width="0.85"/>'
            )
    for column_index, column in enumerate(big_road_columns):
        if column_index >= big_columns:
            break
        for row_index, cell in enumerate(column):
            # Real big roads turn sideways ("dragon tail") once a column is full.
            if row_index < BIG_ROAD_ROWS:
                draw_column, draw_row = column_index, row_index
            else:
                draw_column = column_index + (row_index - BIG_ROAD_ROWS + 1)
                draw_row = BIG_ROAD_ROWS - 1
            if draw_column >= big_columns:
                continue
            cx = big_x + draw_column * big_cell + big_cell / 2
            cy = big_y + draw_row * big_cell + big_cell / 2
            stroke = BANKER_RED if cell["side"] == "B" else PLAYER_BLUE
            parts.append(
                f'<circle cx="{cx}" cy="{cy}" r="{big_cell * 0.34:.1f}" fill="none" '
                f'stroke="{stroke}" stroke-width="2.4"/>'
            )
            if cell["ties"]:
                parts.append(
                    f'<path d="M{cx - big_cell * 0.3:.1f} {cy + big_cell * 0.3:.1f} '
                    f'L{cx + big_cell * 0.3:.1f} {cy - big_cell * 0.3:.1f}" stroke="{TIE_GREEN}" '
                    f'stroke-width="2"/>'
                )
                if cell["ties"] > 1:
                    parts.append(
                        f'<text x="{cx + big_cell * 0.30:.1f}" y="{cy + big_cell * 0.34:.1f}" '
                        f'fill="{TIE_GREEN}" font-size="9">{cell["ties"]}</text>'
                    )

    # ---- Derived roads ----
    derived_specs = [
        (1, "大眼仔", "BIG EYE BOY", "circle"),
        (2, "小路", "SMALL ROAD", "disc"),
        (3, "曱甴路", "COCKROACH PIG", "slash"),
    ]
    derived_y = big_y + BIG_ROAD_ROWS * big_cell + 52
    derived_cell = 21
    derived_rows = 3
    derived_columns = 26

    for spec_index, (offset, chinese, english, glyph_kind) in enumerate(derived_specs):
        block_x = 36 + spec_index * (derived_columns * derived_cell + 44)
        parts.append(section_title(block_x, derived_y - 12, chinese, english))
        for column in range(derived_columns):
            for row in range(derived_rows):
                parts.append(
                    f'<rect x="{block_x + column * derived_cell}" '
                    f'y="{derived_y + 18 + row * derived_cell}" width="{derived_cell}" '
                    f'height="{derived_cell}" fill="none" stroke="{grid_color}" stroke-width="0.7"/>'
                )
        marks = build_derived_road(big_road_columns, offset)
        for mark_index, mark in enumerate(marks):
            column, row = divmod(mark_index, derived_rows)
            if column >= derived_columns:
                break
            cx = block_x + column * derived_cell + derived_cell / 2
            cy = derived_y + 18 + row * derived_cell + derived_cell / 2
            color = BANKER_RED if mark == "R" else PLAYER_BLUE
            radius = derived_cell * 0.30
            if glyph_kind == "disc":
                parts.append(f'<circle cx="{cx}" cy="{cy}" r="{radius:.1f}" fill="{color}"/>')
            elif glyph_kind == "slash":
                parts.append(
                    f'<path d="M{cx - radius:.1f} {cy + radius:.1f} L{cx + radius:.1f} '
                    f'{cy - radius:.1f}" stroke="{color}" stroke-width="2.1"/>'
                )
            else:
                parts.append(
                    f'<circle cx="{cx}" cy="{cy}" r="{radius:.1f}" fill="none" '
                    f'stroke="{color}" stroke-width="1.9"/>'
                )

    parts.append(
        f'<text x="{width - 26}" y="{height - 18}" text-anchor="end" fill="{line}" font-size="10.5" '
        f'opacity="0.5">訓練仿真 · 路單畫法依澳門現場慣例</text>'
    )
    parts.append('</svg>')
    return "".join(parts)


# --------------------------------------------------------------------------
# Result monitor and dealer uniform
# --------------------------------------------------------------------------

def result_monitor_svg(casino, outcomes):
    """Table-side result display: current shoe counters and the last results."""
    width, height = 620, 300
    style = casino["monitor_style"]
    gold, line, accent = casino["gold"], casino["line_color"], casino["accent"]
    label_font = casino["label_font"]

    banker_wins = sum(1 for side, _p, _b in outcomes if side == "B")
    player_wins = sum(1 for side, _p, _b in outcomes if side == "P")
    ties = sum(1 for side, _p, _b in outcomes if side == "T")

    if style == "gilt-wide":
        housing = (
            f'<rect width="{width}" height="{height}" rx="10" fill="{gold}"/>'
            f'<rect x="14" y="14" width="{width - 28}" height="{height - 28}" rx="5" fill="#07100C"/>'
        )
        stand = f'<rect x="{width / 2 - 46}" y="{height - 10}" width="92" height="10" rx="3" fill="{gold}"/>'
    elif style == "bezel-slim":
        housing = (
            f'<rect width="{width}" height="{height}" rx="14" fill="#0A0D12"/>'
            f'<rect x="6" y="6" width="{width - 12}" height="{height - 12}" rx="10" fill="#05090F" '
            f'stroke="{casino["tie_band"]}" stroke-width="1.1" stroke-opacity="0.6"/>'
        )
        stand = f'<rect x="{width / 2 - 30}" y="{height - 8}" width="60" height="8" rx="4" fill="#3A4652"/>'
    elif style == "gilt-thin":
        housing = (
            f'<rect width="{width}" height="{height}" rx="8" fill="{casino["rail_dark"]}"/>'
            f'<rect x="9" y="9" width="{width - 18}" height="{height - 18}" rx="4" fill="#0A1610" '
            f'stroke="{gold}" stroke-width="1.8"/>'
        )
        stand = f'<rect x="{width / 2 - 40}" y="{height - 9}" width="80" height="9" rx="3" fill="{gold}"/>'
    elif style == "neon-heavy":
        housing = (
            f'<rect width="{width}" height="{height}" rx="10" fill="#0B0B0F"/>'
            f'<rect x="16" y="16" width="{width - 32}" height="{height - 32}" rx="6" fill="#07030D" '
            f'stroke="{accent}" stroke-width="2.2"/>'
            f'<path d="M16 16 H{width - 16}" stroke="{casino["tie_band"]}" stroke-width="3" opacity="0.85"/>'
        )
        stand = f'<rect x="{width / 2 - 34}" y="{height - 9}" width="68" height="9" rx="3" fill="#1A1A20"/>'
    elif style == "art-frame":
        housing = (
            f'<rect width="{width}" height="{height}" rx="2" fill="#151515"/>'
            f'<rect x="10" y="10" width="{width - 20}" height="{height - 20}" rx="1" fill="#050505" '
            f'stroke="{gold}" stroke-width="1.1"/>'
            f'<rect x="18" y="18" width="{width - 36}" height="{height - 36}" rx="1" fill="none" '
            f'stroke="{gold}" stroke-width="0.5" opacity="0.4"/>'
        )
        stand = ''
    else:  # copper-heavy
        housing = (
            f'<rect width="{width}" height="{height}" rx="8" fill="{casino["rail"]}"/>'
            f'<rect x="18" y="18" width="{width - 36}" height="{height - 36}" rx="4" fill="#140A08" '
            f'stroke="{gold}" stroke-width="2"/>'
        )
        stand = f'<rect x="{width / 2 - 44}" y="{height - 10}" width="88" height="10" rx="3" fill="{casino["rail_dark"]}"/>'

    parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'aria-label="{casino["display_name"]} 桌邊顯示器">',
        housing,
        f'<text x="{width / 2}" y="60" text-anchor="middle" fill="{gold}" font-size="17" '
        f'letter-spacing="5" font-family="{label_font}">BACCARAT 百家樂</text>',
        f'<text x="{width / 2}" y="82" text-anchor="middle" fill="{line}" font-size="11" '
        f'letter-spacing="2" opacity="0.65">{casino["display_name_en"]}</text>',
    ]

    counters = [
        ("BANKER 莊", banker_wins, "#D8382F"),
        ("PLAYER 閒", player_wins, "#2E7BD0"),
        ("TIE 和", ties, "#33A457"),
    ]
    for index, (caption, value, color) in enumerate(counters):
        cx = 140 + index * 170
        parts.append(
            f'<circle cx="{cx}" cy="150" r="42" fill="none" stroke="{color}" stroke-width="2.4" opacity="0.9"/>'
            f'<text x="{cx}" y="160" text-anchor="middle" fill="{color}" font-size="32" '
            f'font-family="{label_font}">{value}</text>'
            f'<text x="{cx}" y="209" text-anchor="middle" fill="{line}" font-size="11.5" '
            f'letter-spacing="1.6" opacity="0.85">{caption}</text>'
        )

    # Last results strip, newest on the right
    recent = outcomes[-12:]
    strip_y = 246
    parts.append(
        f'<text x="46" y="{strip_y - 12}" fill="{line}" font-size="10.5" letter-spacing="2" '
        f'opacity="0.6">LAST 12 · 近十二局</text>'
    )
    for index, (side, _player_pair, _banker_pair) in enumerate(recent):
        color = {"B": "#D8382F", "P": "#2E7BD0", "T": "#33A457"}[side]
        glyph = {"B": "莊", "P": "閒", "T": "和"}[side]
        cx = 60 + index * 42
        parts.append(
            f'<circle cx="{cx}" cy="{strip_y}" r="14" fill="{color}" fill-opacity="0.85"/>'
            f'<text x="{cx}" y="{strip_y + 5}" text-anchor="middle" fill="#FFFFFF" '
            f'font-size="13">{glyph}</text>'
        )

    if stand:
        parts.append(stand)
    parts.append('</svg>')
    return "".join(parts)


def dealer_uniform_svg(casino, width=190, height=250):
    """Dealer uniform styling reference: silhouette plus the approved palette."""
    shirt, vest, trim, tie_color = casino["dealer_uniform"]
    gold = casino["gold"]
    return (
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'aria-label="荷官制服風格參考">'
        f'<rect width="{width}" height="{height}" rx="8" fill="#0C0C10"/>'
        # head
        f'<circle cx="95" cy="52" r="24" fill="#2A2A2E"/>'
        # shirt torso
        f'<path d="M56 88 Q95 74 134 88 L142 196 H48 Z" fill="{shirt}"/>'
        # vest panels
        f'<path d="M64 90 Q95 80 126 90 L132 194 H100 L96 120 L92 194 H58 Z" fill="{vest}"/>'
        # collar and tie
        f'<path d="M88 80 L95 100 L102 80" fill="none" stroke="{trim}" stroke-width="2.4"/>'
        f'<path d="M95 100 L101 122 L95 132 L89 122 Z" fill="{tie_color}"/>'
        # name badge
        f'<rect x="106" y="132" width="22" height="9" rx="2" fill="{gold}"/>'
        # arms
        f'<path d="M56 88 L40 190 H54 L66 110 Z" fill="{shirt}" opacity="0.92"/>'
        f'<path d="M134 88 L150 190 H136 L124 110 Z" fill="{shirt}" opacity="0.92"/>'
        # gloves hint
        f'<rect x="36" y="188" width="20" height="12" rx="5" fill="#F3F1EA" opacity="0.9"/>'
        f'<rect x="134" y="188" width="20" height="12" rx="5" fill="#F3F1EA" opacity="0.9"/>'
        f'<text x="95" y="228" text-anchor="middle" fill="{gold}" font-size="10.5" '
        f'letter-spacing="1.6">UNIFORM REF · 制服參考</text>'
        f'<text x="95" y="242" text-anchor="middle" fill="#9A968C" font-size="9">3D 模型待建</text>'
        f'</svg>'
    )


# --------------------------------------------------------------------------
# Page assembly
# --------------------------------------------------------------------------

PAGE_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 90px;
  background: #06060A; color: #E7E4DB;
  font-family: 'Noto Sans TC','Microsoft JhengHei','PingFang TC',system-ui,sans-serif;
  line-height: 1.66;
}
header.head { padding: 32px 44px 26px; border-bottom: 1px solid rgba(255,255,255,0.1); }
.crumb { font-size: 13px; opacity: 0.6; letter-spacing: 1px; }
.crumb a { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; }
h1 { margin: 12px 0 4px; font-size: 28px; letter-spacing: 1px; }
.sub { font-size: 14px; opacity: 0.68; }
.badges { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px; }
.badge { padding: 5px 11px; border-radius: 3px; font-size: 12px; letter-spacing: 0.6px;
  border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.05); }
.badge.warn { border-color: rgba(255,120,120,0.45); background: rgba(255,70,70,0.1); }
main { padding: 0 44px; max-width: 1360px; margin: 0 auto; }
section { margin-top: 48px; }
h2 { font-size: 19px; letter-spacing: 1.6px; margin: 0 0 8px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.12); }
h2 .en { font-size: 12px; opacity: 0.48; margin-left: 10px; letter-spacing: 2px; }
.note { font-size: 13.5px; opacity: 0.72; margin: 10px 0 18px; }
.canvas { background: #0A0A0E; border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px; padding: 16px; }
.canvas svg { width: 100%; height: auto; display: block; }
.row { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
.tile { background: #0A0A0E; border: 1px solid rgba(255,255,255,0.09);
  border-radius: 8px; padding: 13px; text-align: center; }
.tile svg { width: 100%; height: auto; display: block; }
.tile .cap { margin-top: 9px; font-size: 12px; opacity: 0.66; }
.cards .tile { width: 146px; }
.chips .tile { width: 146px; }
.plaques .tile { width: 236px; }
.uniform .tile { width: 204px; }
table.spec { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }
table.spec th, table.spec td { border: 1px solid rgba(255,255,255,0.12);
  padding: 9px 12px; text-align: left; vertical-align: top; }
table.spec th { background: rgba(255,255,255,0.05); white-space: nowrap; }
.swatches { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.swatch { width: 112px; font-size: 11.5px; }
.swatch i { display: block; height: 48px; border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.2); }
.swatch b { display: block; margin-top: 6px; font-weight: 500; }
.swatch span { opacity: 0.6; font-family: ui-monospace,Consolas,monospace; }
footer.foot { margin: 64px 44px 0; padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,0.1); font-size: 12.5px; opacity: 0.55; }
@media (max-width: 900px) {
  header.head, main, footer.foot { padding-left: 18px; padding-right: 18px;
    margin-left: 0; margin-right: 0; }
}
"""

SWATCH_FIELDS = [
    ("呢面 Felt", "felt_main"),
    ("呢面中調", "felt_mid"),
    ("呢面暗部", "felt_shadow"),
    ("圍邊 Rail", "rail"),
    ("圍邊暗部", "rail_dark"),
    ("品牌色 Accent", "accent"),
    ("金屬描邊", "gold"),
    ("和局帶 Tie", "tie_band"),
    ("牌背底 Card", "card_back"),
]


def swatch_block(casino):
    cells = []
    for label, key in SWATCH_FIELDS:
        value = casino[key]
        cells.append(
            f'<div class="swatch"><i style="background:{value}"></i>'
            f'<b>{label}</b><span>{value}</span></div>'
        )
    return f'<div class="swatches">{"".join(cells)}</div>'


def build_casino_page(casino, outcomes):
    """One refined page per casino."""
    currency = casino["currency"]
    commission_text = "5% 佣金（設佣金格）" if casino["commission"] else "免佣（莊六半賠 0.5:1）"
    smart_text = "智能桌（電子注區感應）" if casino["smart_table"] else "傳統桌（無電子感應）"

    card_tiles = [
        f'<div class="tile">{card_back_svg(casino)}<div class="cap">牌背 Card Back</div></div>'
    ]
    for rank, suit in [("A", "♠"), ("9", "♦"), ("6", "♣"), ("K", "♥")]:
        card_tiles.append(
            f'<div class="tile">{card_face_svg(casino, rank, suit)}'
            f'<div class="cap">{rank}{suit}</div></div>'
        )

    chip_tiles = []
    for denomination in CHIP_DENOMINATIONS:
        chip_tiles.append(
            f'<div class="tile">{chip_svg(casino, denomination)}'
            f'<div class="cap">{currency} {denomination:,}</div></div>'
        )

    stack_tiles = []
    for denomination in (1000, 10000):
        stack_tiles.append(
            f'<div class="tile">{chip_stack_svg(casino, denomination)}'
            f'<div class="cap">碼堆 {currency} {denomination:,} × 6</div></div>'
        )

    plaque_tiles = (
        f'<div class="tile"><svg viewBox="0 0 236 108" xmlns="http://www.w3.org/2000/svg">'
        f'{limit_plaque_svg(casino, casino["mass_min"], casino["mass_max"], currency, x=10, y=8)}'
        f'</svg><div class="cap">大眾廳限紅牌</div></div>'
        f'<div class="tile"><svg viewBox="0 0 236 108" xmlns="http://www.w3.org/2000/svg">'
        f'{limit_plaque_svg(casino, casino["vip_min"], casino["vip_max"], currency, x=10, y=8)}'
        f'</svg><div class="cap">貴賓廳限紅牌</div></div>'
    )

    side_bet_rows = "".join(f'<li>{item}</li>' for item in casino["side_bets"])

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{casino["display_name"]} · 牌桌資產精修</title>
<style>{PAGE_CSS}</style>
</head>
<body>
<header class="head">
  <div class="crumb"><a href="../index.html">← 返回總覽</a> · 澳門賭場訓練系統 · 資產精修 v2</div>
  <h1>{casino["display_name"]}</h1>
  <div class="sub">{casino["display_name_en"]}</div>
  <div class="badges">
    <span class="badge">{commission_text}</span>
    <span class="badge">{smart_text}</span>
    <span class="badge">和局賠付 {casino["tie_payout"]}</span>
    <span class="badge">8 副牌靴</span>
    <span class="badge warn">仿真訓練 · 非官方授權 · 訓練幣結算</span>
  </div>
</header>
<main>

<section>
  <h2>1. 大眾廳牌桌版面 <span class="en">MASS TABLE · 7 SEATS</span></h2>
  <p class="note">
    腰形桌面、荷官在平邊、玩家在弧邊；七個座位沿真實弧線分佈並各自旋轉朝向荷官。
    每座由近至遠印 PLAYER → BANKER → TIE，兩側為對子邊注圈，座號印於呢面邊緣。
    荷官工作區含碼盤、牌靴（附切牌）、棄牌箱與錢箱投口。{casino["refine_notes"]}
  </p>
  <div class="canvas">{table_layout_svg(casino, layout="mass")}</div>
</section>

<section>
  <h2>2. 貴賓廳牌桌版面 <span class="en">VIP TABLE · 5 SEATS</span></h2>
  <p class="note">貴賓桌座位減至五個（沿用跳過 13 的編號慣例），注區放大、間距加寬以容納咪牌動作與大額碼堆。</p>
  <div class="canvas">{table_layout_svg(casino, layout="vip")}</div>
</section>

<section>
  <h2>3. 限紅牌 <span class="en">TABLE LIMIT PLAQUE</span></h2>
  <p class="note">限紅數值一律由 Rule Pack 版本化資料驅動，不可烤進貼圖。下列為佔位示例值，上線前需以現場數據校準。</p>
  <div class="row plaques">{plaque_tiles}</div>
</section>

<section>
  <h2>4. 撲克牌 <span class="en">PLAYING CARDS</span></h2>
  <p class="note">
    牌面採標準點數排布與國際紅黑花色，確保教學可讀性；牌背為本場專屬雕紋與中心徽記，並保留真實牌具的白色留白邊。
  </p>
  <div class="row cards">{"".join(card_tiles)}</div>
</section>

<section>
  <h2>5. 籌碼 <span class="en">CHIPS · TRAINING CURRENCY</span></h2>
  <p class="note">面額主色沿用澳門常見慣例以便辨識碼堆；環紋、嵌條與模具邊緣為本場專屬造型。全部為訓練幣，不涉及真實貨幣。</p>
  <div class="row chips">{"".join(chip_tiles)}</div>
  <div class="row chips" style="margin-top:18px">{"".join(stack_tiles)}</div>
</section>

<section>
  <h2>6. 計分器（澳門五路） <span class="en">ROADMAPS</span></h2>
  <p class="note">
    珠盤路每列六格、先上下再左右；大路同方向往下延伸、換方向開新列、和局於當格加綠斜線；
    大眼仔 / 小路 / 曱甴路分別以偏移 1 / 2 / 3 由大路推導，紅為齊整、藍為不齊整。
  </p>
  <div class="canvas">{roadmap_svg(casino, outcomes)}</div>
</section>

<section>
  <h2>7. 桌邊顯示器 <span class="en">TABLE-SIDE MONITOR</span></h2>
  <p class="note">顯示本靴莊閒和統計與近十二局結果；外框與待機裝飾為本場專屬。</p>
  <div class="canvas" style="max-width:760px">{result_monitor_svg(casino, outcomes)}</div>
</section>

<section>
  <h2>8. 荷官制服風格 <span class="en">DEALER UNIFORM REFERENCE</span></h2>
  <p class="note">{casino["dealer_uniform_note"]}。此為配色與版型參考，3D 模型於後續階段依此製作。</p>
  <div class="row uniform">
    <div class="tile">{dealer_uniform_svg(casino)}<div class="cap">制服參考</div></div>
  </div>
</section>

<section>
  <h2>9. 規格與色板 <span class="en">SPECIFICATION</span></h2>
  <table class="spec">
    <tr><th>casinoId</th><td><code>{casino["casino_id"]}</code></td></tr>
    <tr><th>大眾廳限紅</th><td>{currency} {casino["mass_min"]:,} – {casino["mass_max"]:,}</td></tr>
    <tr><th>貴賓廳限紅</th><td>{currency} {casino["vip_min"]:,} – {casino["vip_max"]:,}</td></tr>
    <tr><th>佣金規則</th><td>{commission_text}</td></tr>
    <tr><th>邊注</th><td><ul style="margin:0;padding-left:18px">{side_bet_rows}</ul></td></tr>
    <tr><th>桌面設備</th><td>{smart_text}</td></tr>
    <tr><th>呢面織紋</th><td><code>{casino["felt_weave"]}</code></td></tr>
    <tr><th>圍邊material</th><td><code>{casino["rail_style"]}</code></td></tr>
    <tr><th>內圈線腳</th><td><code>{casino["border_ornament"]}</code></td></tr>
    <tr><th>中心徽記</th><td><code>{casino["medallion"]}</code></td></tr>
    <tr><th>牌背雕紋</th><td><code>{casino["card_engrave"]}</code></td></tr>
    <tr><th>籌碼模具</th><td><code>{casino["chip_mould"]}</code> · {casino["chip_inserts"]} 嵌條</td></tr>
    <tr><th>計分器外框</th><td><code>{casino["board_style"]}</code></td></tr>
    <tr><th>顯示器外框</th><td><code>{casino["monitor_style"]}</code></td></tr>
    <tr><th>注區字體</th><td><code>{casino["label_font"]}</code></td></tr>
  </table>
  {swatch_block(casino)}
</section>

</main>
<footer class="foot">
  本頁為訓練系統仿真設計稿，僅用於教學訓練，非任何賭場官方授權素材；限紅與賠付數值須以 Rule Pack 版本化資料為準。
</footer>
</body>
</html>
"""


def build_index_page():
    cards = []
    for casino in CASINOS:
        commission_text = "5% 佣金" if casino["commission"] else "免佣 · 莊六半賠"
        cards.append(f"""
      <a class="card" href="casinos/{casino["casino_id"]}.html">
        <div class="thumb" style="background:linear-gradient(135deg,{casino["felt_main"]},{casino["felt_shadow"]})">
          <span class="mono" style="color:{casino["gold"]};border-color:{casino["gold"]}">{casino["monogram"]}</span>
        </div>
        <div class="body">
          <h3>{casino["display_name"]}</h3>
          <p>{casino["refine_notes"]}</p>
          <div class="tags">
            <span>{commission_text}</span>
            <span>{casino["currency"]} {casino["mass_min"]:,}+</span>
            <span>{casino["felt_weave"]}</span>
          </div>
        </div>
      </a>""")

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>澳門賭場訓練系統 · 牌桌資產精修總覽</title>
<style>
{PAGE_CSS}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:22px; margin-top:26px; }}
.card {{ display:block; text-decoration:none; color:inherit; background:#0A0A0E;
  border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden;
  transition:border-color .18s, transform .18s; }}
.card:hover {{ border-color:rgba(255,255,255,0.3); transform:translateY(-2px); }}
.thumb {{ height:132px; display:flex; align-items:center; justify-content:center; }}
.mono {{ width:62px; height:62px; border:2px solid; border-radius:50%; display:flex;
  align-items:center; justify-content:center; font:600 27px Georgia,serif; }}
.body {{ padding:16px 18px 18px; }}
.body h3 {{ margin:0 0 8px; font-size:16.5px; }}
.body p {{ margin:0; font-size:13px; opacity:0.7; line-height:1.6; }}
.tags {{ margin-top:12px; display:flex; flex-wrap:wrap; gap:7px; }}
.tags span {{ font-size:11.5px; padding:3px 9px; border-radius:3px;
  border:1px solid rgba(255,255,255,0.2); opacity:0.85; }}
</style>
</head>
<body>
<header class="head">
  <div class="crumb">澳門賭場訓練系統 · 設計預覽</div>
  <h1>牌桌資產精修總覽</h1>
  <div class="sub">六家賭場 · 牌桌 / 撲克 / 籌碼 / 計分器 / 顯示器 / 制服參考</div>
  <div class="badges">
    <span class="badge">依標準百家樂桌規格復刻</span>
    <span class="badge">澳門五路計分</span>
    <span class="badge">每家獨立材質與模具</span>
    <span class="badge warn">仿真訓練 · 非官方授權</span>
  </div>
</header>
<main>
  <section style="margin-top:26px">
    <h2>選擇賭場 <span class="en">SELECT PROPERTY</span></h2>
    <p class="note">
      共用真實桌型幾何（腰形桌、荷官平邊、玩家弧邊、每座三注、佣金格、牌靴與碼盤），
      各家差異體現在呢面織紋、圍邊材質、內圈線腳、牌背雕紋、籌碼模具、計分器與顯示器外框。
    </p>
    <div class="grid">{"".join(cards)}</div>
  </section>
</main>
<footer class="foot">
  設計稿僅用於訓練教學；不含任何賭場官方商標原件。限紅與賠付以 Rule Pack 版本化資料為準。
</footer>
</body>
</html>
"""


def write_theme_json(casino):
    payload = {
        "casinoId": casino["casino_id"],
        "displayName": casino["display_name"],
        "displayNameEn": casino["display_name_en"],
        "disclaimer": "仿真訓練主題，非官方授權；訓練幣結算",
        "palette": {
            "feltMain": casino["felt_main"],
            "feltMid": casino["felt_mid"],
            "feltShadow": casino["felt_shadow"],
            "rail": casino["rail"],
            "railDark": casino["rail_dark"],
            "accent": casino["accent"],
            "gold": casino["gold"],
            "lineColor": casino["line_color"],
            "tieBand": casino["tie_band"],
            "cardBack": casino["card_back"],
        },
        "materials": {
            "feltWeave": casino["felt_weave"],
            "railStyle": casino["rail_style"],
            "borderOrnament": casino["border_ornament"],
            "medallion": casino["medallion"],
            "cardEngrave": casino["card_engrave"],
            "chipMould": casino["chip_mould"],
            "chipInserts": casino["chip_inserts"],
            "boardStyle": casino["board_style"],
            "monitorStyle": casino["monitor_style"],
            "plaqueStyle": casino["plaque_style"],
            "labelFont": casino["label_font"],
        },
        "tableRules": {
            "currency": casino["currency"],
            "massLimits": {"min": casino["mass_min"], "max": casino["mass_max"]},
            "vipLimits": {"min": casino["vip_min"], "max": casino["vip_max"]},
            "commission": casino["commission"],
            "tiePayout": casino["tie_payout"],
            "sideBets": casino["side_bets"],
            "smartTable": casino["smart_table"],
            "massSeatLabels": MASS_SEAT_LABELS,
            "vipSeatLabels": VIP_SEAT_LABELS,
            "bigTableSeatLabels": BIG_TABLE_SEAT_LABELS,
        },
        "chipDenominations": CHIP_DENOMINATIONS,
        "dealerUniform": {
            "palette": casino["dealer_uniform"],
            "note": casino["dealer_uniform_note"],
        },
    }
    target = ASSET_DIR / casino["casino_id"]
    target.mkdir(parents=True, exist_ok=True)
    (target / "theme.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main():
    for casino in CASINOS:
        page = build_casino_page(casino, SAMPLE_OUTCOMES)
        (CASINO_DIR / f'{casino["casino_id"]}.html').write_text(page, encoding="utf-8")
        write_theme_json(casino)
        print("refined", casino["casino_id"])
    (ROOT / "index.html").write_text(build_index_page(), encoding="utf-8")
    print("wrote index.html")


if __name__ == "__main__":
    main()
