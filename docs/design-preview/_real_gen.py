# -*- coding: utf-8 -*-
"""Generate casino table previews using real baccarat layout specifications."""
from pathlib import Path
import json
import math

ROOT = Path(r"E:\澳门开发\docs\design-preview")
CASINO_DIR = ROOT / "casinos"
ASSET_DIR = Path(r"E:\澳门开发\assets\casinos")
CASINO_DIR.mkdir(parents=True, exist_ok=True)
ASSET_DIR.mkdir(parents=True, exist_ok=True)

# Real layout constants derived from standard baccarat table specifications.
MASS_SEAT_COUNT = 7
BIG_TABLE_SEAT_LABELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15]  # 13 omitted

CASINOS = [
    dict(
        casino_id="sands-venetian",
        display_name="金沙 · 威尼斯人（仿真训练主题）",
        display_name_en="Sands Venetian - Training Simulation Theme",
        monogram="V",
        chip_monogram="SV",
        felt_main="#0E6045",
        felt_shadow="#083A2A",
        felt_pattern="damask",
        rail="#E9E3D6",
        rail_dark="#B9A47A",
        rail_style="marble",
        accent="#1A4A7A",
        gold="#C9A44C",
        line_color="#F2EAD3",
        tie_band="#C9A44C",
        card_back="#123A66",
        card_pattern="arch",
        chip_rings=["#1A4A7A", "#C9A44C", "#0E3358"],
        chip_edge="fine-teeth",
        board_style="stone",
        monitor_style="gold-wide",
        plaque_style="brass-plate",
        currency="HKD",
        mass_min=1000,
        mass_max=100000,
        vip_min=20000,
        vip_max=2000000,
        commission=True,
        smart_table=True,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform="白襯衫 · 金棕背心 · 金色名牌 · 白手套",
        notes="歐式拱券暗紋、大理石圍邊、翡翠呢面；寬字距羅馬體注區字樣。",
    ),
    dict(
        casino_id="galaxy",
        display_name="銀河（仿真訓練主題）",
        display_name_en="Galaxy - Training Simulation Theme",
        monogram="G",
        chip_monogram="GX",
        felt_main="#14405F",
        felt_shadow="#0A2740",
        felt_pattern="orbit",
        rail="#8D9CAD",
        rail_dark="#5C6B7C",
        rail_style="brushed-steel",
        accent="#0B1E3A",
        gold="#C6D2E0",
        line_color="#DCE6F0",
        tie_band="#4FA3B8",
        card_back="#0B1E3A",
        card_pattern="orbit",
        chip_rings=["#3E8CA8", "#C6D2E0", "#12324A"],
        chip_edge="double-ring",
        board_style="hud",
        monitor_style="bezel-slim",
        plaque_style="capsule-led",
        currency="HKD",
        mass_min=500,
        mass_max=50000,
        vip_min=10000,
        vip_max=1000000,
        commission=False,
        smart_table=True,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1", "Either Pair 5:1"],
        dealer_uniform="深灰西裝 · 銀色領結 · 冷光名牌",
        notes="星軌同心圓暗紋、拉絲鋼圍邊、靛藍呢面；免佣桌庄六半賠標示。",
    ),
    dict(
        casino_id="wynn",
        display_name="永利（仿真訓練主題）",
        display_name_en="Wynn - Training Simulation Theme",
        monogram="W",
        chip_monogram="WN",
        felt_main="#0F4032",
        felt_shadow="#082A20",
        felt_pattern="petal",
        rail="#5A3418",
        rail_dark="#331C0C",
        rail_style="walnut",
        accent="#5C1A1A",
        gold="#C08A2E",
        line_color="#EBD9AE",
        tie_band="#C08A2E",
        card_back="#5C1A1A",
        card_pattern="petal",
        chip_rings=["#5C1A1A", "#C08A2E", "#3A0F0F"],
        chip_edge="wide-gold",
        board_style="walnut",
        monitor_style="gold-thin",
        plaque_style="wood-brass",
        currency="HKD",
        mass_min=1000,
        mass_max=120000,
        vip_min=50000,
        vip_max=3000000,
        commission=True,
        smart_table=True,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform="黑金馬甲 · 酒紅領飾 · 圓角金名牌",
        notes="花瓣對稱暗紋、胡桃木金嵌條圍邊、墨綠呢面；精緻小字注區。",
    ),
    dict(
        casino_id="melco-cod",
        display_name="新濠天地（仿真訓練主題）",
        display_name_en="Melco City of Dreams - Training Simulation Theme",
        monogram="M",
        chip_monogram="MC",
        felt_main="#2B1A45",
        felt_shadow="#180E29",
        felt_pattern="lattice",
        rail="#141118",
        rail_dark="#000000",
        rail_style="piano-black",
        accent="#A61B4A",
        gold="#2FE3D2",
        line_color="#E8DCF5",
        tie_band="#2FE3D2",
        card_back="#12081A",
        card_pattern="lattice",
        chip_rings=["#141118", "#A61B4A", "#2FE3D2"],
        chip_edge="bevel",
        board_style="neon",
        monitor_style="neon-heavy",
        plaque_style="neon-edge",
        currency="HKD",
        mass_min=500,
        mass_max=80000,
        vip_min=20000,
        vip_max=1500000,
        commission=False,
        smart_table=True,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1", "Perfect Pair 25:1"],
        dealer_uniform="黑襯衫 · 品紅織帶 · 短版馬甲",
        notes="菱形晶格暗紋、鋼琴烤漆圍邊配品紅燈帶、深紫呢面。",
    ),
    dict(
        casino_id="mgm",
        display_name="美高梅（仿真訓練主題）",
        display_name_en="MGM - Training Simulation Theme",
        monogram="M",
        chip_monogram="MG",
        felt_main="#15332C",
        felt_shadow="#0B1F1A",
        felt_pattern="minimal",
        rail="#1E1E1E",
        rail_dark="#0A0A0A",
        rail_style="matte-black",
        accent="#1C1C1C",
        gold="#D4AF37",
        line_color="#E8E2CF",
        tie_band="#D4AF37",
        card_back="#0A0A0A",
        card_pattern="feline-line",
        chip_rings=["#1C1C1C", "#D4AF37", "#2E2E2E"],
        chip_edge="square-edge",
        board_style="gallery",
        monitor_style="art-frame",
        plaque_style="vertical-black",
        currency="HKD",
        mass_min=500,
        mass_max=50000,
        vip_min=20000,
        vip_max=1000000,
        commission=True,
        smart_table=True,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform="全黑制服 · 金釦 · 極簡名牌",
        notes="極簡細線暗紋、啞光黑加一道金線圍邊、墨綠近黑呢面。",
    ),
    dict(
        casino_id="sjm-lisboa",
        display_name="澳博 · 葡京意象（仿真訓練主題）",
        display_name_en="SJM Lisboa-inspired - Training Simulation Theme",
        monogram="S",
        chip_monogram="SJ",
        felt_main="#0B4E35",
        felt_shadow="#063324",
        felt_pattern="lotus",
        rail="#7A3020",
        rail_dark="#4A1C10",
        rail_style="rosewood-brass",
        accent="#9B1B1B",
        gold="#D4A017",
        line_color="#F0E2BE",
        tie_band="#D4A017",
        card_back="#9B1B1B",
        card_pattern="lotus",
        chip_rings=["#9B1B1B", "#D4A017", "#0B4E35"],
        chip_edge="copper-teeth",
        board_style="classic-cn",
        monitor_style="copper-heavy",
        plaque_style="red-gold",
        currency="HKD",
        mass_min=200,
        mass_max=30000,
        vip_min=10000,
        vip_max=1000000,
        commission=True,
        smart_table=False,
        side_bets=["Player Pair 11:1", "Banker Pair 11:1"],
        dealer_uniform="紅黑馬甲 · 銅色名牌",
        notes="蓮花剪影暗紋、紅木銅釘圍邊、傳統深綠呢面；繁體中英雙語注區。",
    ),
]

CHIP_DENOMINATIONS = [100, 500, 1000, 5000, 10000]

# Fixed sample shoe outcomes used to render every roadmap consistently.
# B = Banker, P = Player, T = Tie
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


def felt_pattern_def(casino):
    """Subtle woven pattern per casino so no two felts are identical."""
    pattern = casino["felt_pattern"]
    line = casino["line_color"]
    pid = f'feltpat-{casino["casino_id"]}'
    if pattern == "damask":
        body = (f'<path d="M0 20 Q10 4 20 20 Q30 36 40 20" fill="none" stroke="{line}" '
                f'stroke-width="0.7" opacity="0.09"/>')
        size = 40
    elif pattern == "orbit":
        body = (f'<circle cx="20" cy="20" r="13" fill="none" stroke="{line}" stroke-width="0.7" opacity="0.09"/>'
                f'<circle cx="20" cy="20" r="5" fill="none" stroke="{line}" stroke-width="0.5" opacity="0.08"/>')
        size = 40
    elif pattern == "petal":
        body = (f'<path d="M20 6 Q28 20 20 34 Q12 20 20 6Z" fill="none" stroke="{line}" '
                f'stroke-width="0.7" opacity="0.10"/>')
        size = 40
    elif pattern == "lattice":
        body = (f'<path d="M0 20 L20 0 L40 20 L20 40Z" fill="none" stroke="{line}" '
                f'stroke-width="0.7" opacity="0.10"/>')
        size = 40
    elif pattern == "linen":
        body = (f'<path d="M0 0 H40" stroke="{line}" stroke-width="0.5" opacity="0.07"/>'
                f'<path d="M0 20 H40" stroke="{line}" stroke-width="0.5" opacity="0.05"/>'
                f'<path d="M20 0 V40" stroke="{line}" stroke-width="0.5" opacity="0.05"/>')
        size = 40
    else:  # keyfret
        body = (f'<path d="M6 6 H34 V34 H14 V14 H26" fill="none" stroke="{line}" '
                f'stroke-width="0.8" opacity="0.10"/>')
        size = 40
    return (f'<pattern id="{pid}" width="{size}" height="{size}" patternUnits="userSpaceOnUse">'
            f'{body}</pattern>'), pid


def rail_gradient_def(casino):
    """Distinct rail material per casino."""
    gid = f'rail-{casino["casino_id"]}'
    light, dark = casino["rail"], casino["rail_dark"]
    style = casino["rail_style"]
    if style == "brushed-steel":
        stops = (f'<stop offset="0%" stop-color="{dark}"/><stop offset="35%" stop-color="{light}"/>'
                 f'<stop offset="55%" stop-color="#F2F6FA"/><stop offset="75%" stop-color="{light}"/>'
                 f'<stop offset="100%" stop-color="{dark}"/>')
    elif style == "marble":
        stops = (f'<stop offset="0%" stop-color="{light}"/><stop offset="45%" stop-color="#FFFFFF"/>'
                 f'<stop offset="60%" stop-color="{light}"/><stop offset="100%" stop-color="{dark}"/>')
    elif style in ("walnut", "rosewood"):
        stops = (f'<stop offset="0%" stop-color="{dark}"/><stop offset="40%" stop-color="{light}"/>'
                 f'<stop offset="70%" stop-color="{dark}"/><stop offset="100%" stop-color="{light}"/>')
    elif style == "piano-black":
        stops = (f'<stop offset="0%" stop-color="{dark}"/><stop offset="45%" stop-color="{light}"/>'
                 f'<stop offset="50%" stop-color="#4A4A4A"/><stop offset="100%" stop-color="{dark}"/>')
    else:  # matte-black
        stops = (f'<stop offset="0%" stop-color="{dark}"/><stop offset="50%" stop-color="{light}"/>'
                 f'<stop offset="100%" stop-color="{dark}"/>')
    return f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient>', gid


def seat_betting_group(casino, seat_label, center_x, base_y, scale=1.0):
    """One seat's real betting stack: TIE (far) / BANKER (mid) / PLAYER (near) + pair circles."""
    line = casino["line_color"]
    gold = casino["gold"]
    tie = casino["tie_band"]
    box_w = 108 * scale
    box_h = 30 * scale
    gap = 5 * scale
    parts = []

    # PLAYER box closest to the guest
    py = base_y
    parts.append(
        f'<rect x="{center_x - box_w / 2:.1f}" y="{py:.1f}" width="{box_w:.1f}" height="{box_h:.1f}" rx="4" '
        f'fill="none" stroke="{line}" stroke-width="1.6" opacity="0.95"/>'
        f'<text x="{center_x:.1f}" y="{py + box_h * 0.68:.1f}" text-anchor="middle" fill="{line}" '
        f'font-size="{12 * scale:.1f}" letter-spacing="2.5" font-family="Georgia,serif">PLAYER</text>'
    )
    # BANKER box behind it
    by = py - box_h - gap
    parts.append(
        f'<rect x="{center_x - box_w / 2:.1f}" y="{by:.1f}" width="{box_w:.1f}" height="{box_h:.1f}" rx="4" '
        f'fill="none" stroke="{gold}" stroke-width="1.8" opacity="0.98"/>'
        f'<text x="{center_x:.1f}" y="{by + box_h * 0.68:.1f}" text-anchor="middle" fill="{gold}" '
        f'font-size="{12 * scale:.1f}" letter-spacing="2.5" font-family="Georgia,serif">BANKER</text>'
    )
    # TIE box furthest from guest
    ty = by - box_h * 0.78 - gap
    parts.append(
        f'<rect x="{center_x - box_w * 0.42:.1f}" y="{ty:.1f}" width="{box_w * 0.84:.1f}" '
        f'height="{box_h * 0.78:.1f}" rx="4" fill="{tie}" fill-opacity="0.16" stroke="{tie}" stroke-width="1.4"/>'
        f'<text x="{center_x:.1f}" y="{ty + box_h * 0.53:.1f}" text-anchor="middle" fill="{tie}" '
        f'font-size="{10.5 * scale:.1f}" letter-spacing="3">TIE 8:1</text>'
    )
    # Pair side-bet circles flanking the player box
    if casino["side_bets"]:
        r = 11 * scale
        for dx, tag in ((-box_w / 2 - r - 4 * scale, "P"), (box_w / 2 + r + 4 * scale, "B")):
            parts.append(
                f'<circle cx="{center_x + dx:.1f}" cy="{py + box_h / 2:.1f}" r="{r:.1f}" fill="none" '
                f'stroke="{line}" stroke-width="1.2" opacity="0.75"/>'
                f'<text x="{center_x + dx:.1f}" y="{py + box_h / 2 + 3.5 * scale:.1f}" text-anchor="middle" '
                f'fill="{line}" font-size="{9 * scale:.1f}" opacity="0.9">{tag}R</text>'
            )
    # Seat number badge at the felt edge
    parts.append(
        f'<circle cx="{center_x:.1f}" cy="{py + box_h + 17 * scale:.1f}" r="{11 * scale:.1f}" '
        f'fill="none" stroke="{gold}" stroke-width="1.3"/>'
        f'<text x="{center_x:.1f}" y="{py + box_h + 21 * scale:.1f}" text-anchor="middle" fill="{gold}" '
        f'font-size="{12 * scale:.1f}" font-family="Georgia,serif">{seat_label}</text>'
    )
    return "".join(parts)


def table_top_svg(casino, layout="mass"):
    """Real baccarat layout: kidney/semi-circular felt, dealer at flat edge,
    7 mirrored seat positions, central card area, shoe, drop box, commission boxes."""
    width, height = 1180, 680
    line, gold, accent = casino["line_color"], casino["gold"], casino["accent"]
    felt_pat, felt_pat_id = felt_pattern_def(casino)
    rail_grad, rail_grad_id = rail_gradient_def(casino)

    seat_count = MASS_SEAT_COUNT if layout == "mass" else 5
    currency = casino["currency"]
    limit_min = casino["mass_min"] if layout == "mass" else casino["vip_min"]
    limit_max = casino["mass_max"] if layout == "mass" else casino["vip_max"]

    # Felt outline: flat dealer edge on top, curved guest side at bottom.
    felt = (
        f'M120 120 H1060 '
        f'C1105 120 1130 160 1130 230 '
        f'C1130 470 930 600 590 600 '
        f'C250 600 50 470 50 230 '
        f'C50 160 75 120 120 120 Z'
    )

    parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'role="img" aria-label="{casino["display_name"]} 百家樂牌桌版面">',
        f'<defs>{felt_pat}{rail_grad}',
        f'<radialGradient id="feltlight-{casino["casino_id"]}" cx="50%" cy="18%" r="85%">'
        f'<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>'
        f'<stop offset="60%" stop-color="#000000" stop-opacity="0"/>'
        f'<stop offset="100%" stop-color="#000000" stop-opacity="0.38"/></radialGradient>',
        '</defs>',
        f'<rect width="{width}" height="{height}" fill="#0A0A0C"/>',
        # Rail (padded armrest) drawn as thick stroke behind felt
        f'<path d="{felt}" fill="none" stroke="url(#{rail_grad_id})" stroke-width="46" stroke-linejoin="round"/>',
        f'<path d="{felt}" fill="none" stroke="{casino["rail_dark"]}" stroke-width="2" opacity="0.8"/>',
        # Felt surface
        f'<path d="{felt}" fill="{casino["felt_main"]}"/>',
        f'<path d="{felt}" fill="url(#{felt_pat_id})"/>',
        f'<path d="{felt}" fill="url(#feltlight-{casino["casino_id"]})"/>',
    ]

    # Dealer working area at flat edge: shoe (left of dealer view), chip tray, drop box
    parts.append(
        f'<rect x="500" y="132" width="180" height="54" rx="6" fill="{casino["felt_shadow"]}" '
        f'stroke="{gold}" stroke-width="1.4" opacity="0.95"/>'
        f'<text x="590" y="164" text-anchor="middle" fill="{gold}" font-size="13" letter-spacing="3">CHIP TRAY 碼盤</text>'
    )
    parts.append(
        f'<rect x="742" y="130" width="118" height="58" rx="8" fill="#14100C" stroke="{gold}" stroke-width="1.6"/>'
        f'<path d="M754 152 H848" stroke="{gold}" stroke-width="1" opacity="0.6"/>'
        f'<text x="801" y="172" text-anchor="middle" fill="{line}" font-size="12" letter-spacing="2">SHOE 牌靴</text>'
    )
    parts.append(
        f'<rect x="322" y="136" width="96" height="48" rx="5" fill="#0C0C0E" stroke="{line}" '
        f'stroke-width="1.2" opacity="0.85"/>'
        f'<text x="370" y="165" text-anchor="middle" fill="{line}" font-size="11" letter-spacing="1.5">DROP 錢箱</text>'
    )
    parts.append(
        f'<rect x="880" y="138" width="86" height="44" rx="5" fill="#0C0C0E" stroke="{line}" '
        f'stroke-width="1.1" opacity="0.8"/>'
        f'<text x="923" y="165" text-anchor="middle" fill="{line}" font-size="11">DISCARD</text>'
    )

    # Commission boxes along dealer side (only when the table charges 5% vig)
    if casino["commission"]:
        box_w, start_x, box_y = 46, 150, 200
        for index in range(seat_count):
            bx = start_x + index * (box_w + 8)
            parts.append(
                f'<rect x="{bx}" y="{box_y}" width="{box_w}" height="30" rx="3" fill="none" '
                f'stroke="{gold}" stroke-width="1.1" opacity="0.85"/>'
                f'<text x="{bx + box_w / 2}" y="{box_y + 20}" text-anchor="middle" fill="{gold}" '
                f'font-size="12" font-family="Georgia,serif">{index + 1}</text>'
            )
        parts.append(
            f'<text x="{start_x}" y="{box_y - 8}" fill="{line}" font-size="11" letter-spacing="2" '
            f'opacity="0.9">COMMISSION 佣金格 (5%)</text>'
        )
    else:
        parts.append(
            f'<rect x="150" y="200" width="300" height="34" rx="5" fill="{casino["accent"]}" '
            f'fill-opacity="0.25" stroke="{gold}" stroke-width="1.3"/>'
            f'<text x="300" y="223" text-anchor="middle" fill="{gold}" font-size="13" letter-spacing="2">'
            f'NO COMMISSION · 莊六半賠 (0.5:1)</text>'
        )

    # Central card zone: PLAYER hand left, BANKER hand right of the dealing spot
    parts.append(
        f'<g opacity="0.95">'
        f'<rect x="452" y="252" width="122" height="86" rx="6" fill="none" stroke="{line}" '
        f'stroke-width="1.6" stroke-dasharray="6 4"/>'
        f'<text x="513" y="245" text-anchor="middle" fill="{line}" font-size="13" letter-spacing="3">PLAYER 閒</text>'
        f'<rect x="606" y="252" width="122" height="86" rx="6" fill="none" stroke="{gold}" '
        f'stroke-width="1.6" stroke-dasharray="6 4"/>'
        f'<text x="667" y="245" text-anchor="middle" fill="{gold}" font-size="13" letter-spacing="3">BANKER 莊</text>'
        f'</g>'
    )

    # Seat betting positions arranged along the curved guest edge
    if layout == "mass":
        seat_xs = [176, 314, 452, 590, 728, 866, 1004]
        seat_ys = [470, 500, 520, 528, 520, 500, 470]
        labels = [1, 2, 3, 4, 5, 6, 7]
        scale = 0.92
    else:
        seat_xs = [300, 445, 590, 735, 880]
        seat_ys = [500, 522, 530, 522, 500]
        labels = [1, 2, 3, 5, 6]
        scale = 1.0

    for seat_x, seat_y, label in zip(seat_xs, seat_ys, labels):
        parts.append(seat_betting_group(casino, label, seat_x, seat_y, scale))

    # Table limit plaque anchored at the felt corner
    parts.append(limit_plaque_svg(casino, limit_min, limit_max, currency, x=64, y=250))

    # Compliance mark
    parts.append(
        f'<text x="{width - 24}" y="{height - 20}" text-anchor="end" fill="{line}" font-size="11" '
        f'opacity="0.55">訓練仿真 · 非官方授權 · 訓練幣結算</text>'
    )
    parts.append('</svg>')
    return "".join(parts)


def limit_plaque_svg(casino, limit_min, limit_max, currency, x=0, y=0):
    """Table minimum/maximum plaque; style differs per casino."""
    style = casino["plaque_style"]
    gold, line = casino["gold"], casino["line_color"]
    w, h = 132, 92
    if style == "capsule-led":
        shell = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" fill="#0B0F14" '
                 f'stroke="{gold}" stroke-width="2"/>')
    elif style == "vertical-gold":
        shell = (f'<rect x="{x}" y="{y}" width="{w * 0.72}" height="{h * 1.2}" rx="4" fill="#101010" '
                 f'stroke="{gold}" stroke-width="2"/>')
        w, h = w * 0.72, h * 1.2
    elif style == "wood-brass":
        shell = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{casino["rail_dark"]}" '
                 f'stroke="{gold}" stroke-width="3"/>')
    elif style == "neon-edge":
        shell = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="#0A0410" '
                 f'stroke="{casino["accent"]}" stroke-width="3"/>')
    elif style == "red-gold-plate":
        shell = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{casino["accent"]}" '
                 f'stroke="{gold}" stroke-width="3"/>')
    else:  # brass-plate
        shell = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#1A1508" '
                 f'stroke="{gold}" stroke-width="2.5"/>')

    return (
        f'{shell}'
        f'<text x="{x + w / 2:.1f}" y="{y + 24:.1f}" text-anchor="middle" fill="{gold}" font-size="11" '
        f'letter-spacing="2">BACCARAT 百家樂</text>'
        f'<text x="{x + w / 2:.1f}" y="{y + 48:.1f}" text-anchor="middle" fill="{line}" font-size="13">'
        f'MIN {currency} {limit_min:,}</text>'
        f'<text x="{x + w / 2:.1f}" y="{y + 70:.1f}" text-anchor="middle" fill="{line}" font-size="13">'
        f'MAX {currency} {limit_max:,}</text>'
    )


def card_back_svg(casino, width=118, height=166):
    """Casino-specific card back. Real cards keep a white border margin."""
    pattern = casino["card_pattern"]
    back = casino["card_back"]
    gold = casino["gold"]
    accent = casino["accent"]
    pid = f'cardpat-{casino["casino_id"]}'

    if pattern == "arch":
        motif = (f'<path d="M4 26 Q13 6 22 26" fill="none" stroke="{gold}" stroke-width="1.3" opacity="0.85"/>'
                 f'<path d="M9 26 Q13 15 17 26" fill="none" stroke="{gold}" stroke-width="0.8" opacity="0.6"/>')
        tile = 26
    elif pattern == "orbit":
        motif = (f'<circle cx="13" cy="13" r="9" fill="none" stroke="{gold}" stroke-width="1.1" opacity="0.8"/>'
                 f'<circle cx="13" cy="13" r="2.2" fill="{gold}" opacity="0.85"/>')
        tile = 26
    elif pattern == "petal":
        motif = (f'<path d="M13 3 Q20 13 13 23 Q6 13 13 3Z" fill="none" stroke="{gold}" '
                 f'stroke-width="1.1" opacity="0.85"/>')
        tile = 26
    elif pattern == "lattice":
        motif = (f'<path d="M13 2 L24 13 L13 24 L2 13Z" fill="none" stroke="{accent}" stroke-width="1.2" opacity="0.9"/>'
                 f'<path d="M13 8 L18 13 L13 18 L8 13Z" fill="{gold}" opacity="0.55"/>')
        tile = 26
    elif pattern == "lion-line":
        motif = (f'<path d="M6 20 Q13 4 20 20" fill="none" stroke="{gold}" stroke-width="1.1" opacity="0.85"/>'
                 f'<path d="M10 20 V14 M16 20 V14" stroke="{gold}" stroke-width="0.9" opacity="0.7"/>')
        tile = 26
    else:  # lotus
        motif = (f'<path d="M13 22 Q4 14 13 4 Q22 14 13 22Z" fill="none" stroke="{gold}" '
                 f'stroke-width="1.1" opacity="0.85"/>'
                 f'<path d="M13 22 Q9 16 13 10 Q17 16 13 22Z" fill="{gold}" opacity="0.35"/>')
        tile = 26

    return (
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" aria-label="牌背">'
        f'<defs><pattern id="{pid}" width="{tile}" height="{tile}" patternUnits="userSpaceOnUse">{motif}</pattern></defs>'
        f'<rect width="{width}" height="{height}" rx="9" fill="#FCFBF7"/>'
        f'<rect x="5" y="5" width="{width - 10}" height="{height - 10}" rx="6" fill="{back}"/>'
        f'<rect x="5" y="5" width="{width - 10}" height="{height - 10}" rx="6" fill="url(#{pid})"/>'
        f'<rect x="11" y="11" width="{width - 22}" height="{height - 22}" rx="4" fill="none" '
        f'stroke="{gold}" stroke-width="1.2" opacity="0.9"/>'
        f'<circle cx="{width / 2}" cy="{height / 2}" r="21" fill="{back}" stroke="{gold}" stroke-width="1.3"/>'
        f'<text x="{width / 2}" y="{height / 2 + 7}" text-anchor="middle" fill="{gold}" font-size="19" '
        f'font-family="Georgia,serif">{casino["monogram"]}</text>'
        f'</svg>'
    )


def card_face_svg(casino, rank, suit, width=118, height=166):
    """Face card in real casino proportions; suit colors stay standard for readability."""
    red_suits = {"♥", "♦"}
    color = "#C4141C" if suit in red_suits else "#141414"
    gold = casino["gold"]
    return (
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" aria-label="{rank}{suit}">'
        f'<rect width="{width}" height="{height}" rx="9" fill="#FCFBF7" stroke="#DED8C8" stroke-width="1"/>'
        f'<rect x="4" y="4" width="{width - 8}" height="{height - 8}" rx="7" fill="none" '
        f'stroke="{gold}" stroke-width="0.8" opacity="0.55"/>'
        f'<text x="14" y="30" fill="{color}" font-size="22" font-family="Georgia,serif">{rank}</text>'
        f'<text x="14" y="50" fill="{color}" font-size="18">{suit}</text>'
        f'<text x="{width / 2}" y="{height / 2 + 18}" text-anchor="middle" fill="{color}" font-size="46">{suit}</text>'
        f'<g transform="rotate(180 {width / 2} {height / 2})">'
        f'<text x="14" y="30" fill="{color}" font-size="22" font-family="Georgia,serif">{rank}</text>'
        f'<text x="14" y="50" fill="{color}" font-size="18">{suit}</text></g>'
        f'</svg>'
    )


def chip_svg(casino, denomination, size=104):
    """Casino-specific chip: edge spots, inlay ring, center monogram, denomination."""
    rings = casino["chip_rings"]
    gold = casino["gold"]
    edge_style = casino["chip_edge"]
    center = size / 2
    radius = size / 2 - 3

    denomination_colors = {
        100: rings[0],
        500: rings[1],
        1000: rings[2],
        5000: "#4B1F6E",
        10000: "#1C1C1C",
    }
    body = denomination_colors.get(denomination, rings[0])

    spots = []
    spot_count = {"fine-teeth": 24, "double-ring": 16, "wide-gold": 12,
                  "bevel-cut": 14, "square-cut": 8, "copper-teeth": 18}.get(edge_style, 16)
    for index in range(spot_count):
        angle = (2 * math.pi * index) / spot_count
        sx = center + math.cos(angle) * (radius - 5)
        sy = center + math.sin(angle) * (radius - 5)
        if edge_style == "square-cut":
            spots.append(f'<rect x="{sx - 4:.1f}" y="{sy - 4:.1f}" width="8" height="8" fill="{gold}" opacity="0.9"/>')
        else:
            spots.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="3.4" fill="{gold}" opacity="0.9"/>')

    extra_ring = ""
    if edge_style == "double-ring":
        extra_ring = (f'<circle cx="{center}" cy="{center}" r="{radius - 11:.1f}" fill="none" '
                      f'stroke="{gold}" stroke-width="1.6" opacity="0.8"/>')
    elif edge_style == "wide-gold":
        extra_ring = (f'<circle cx="{center}" cy="{center}" r="{radius - 2:.1f}" fill="none" '
                      f'stroke="{gold}" stroke-width="5" opacity="0.85"/>')

    return (
        f'<svg viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg" aria-label="籌碼 {denomination}">'
        f'<circle cx="{center}" cy="{center}" r="{radius:.1f}" fill="{body}" stroke="#000" stroke-width="1.4"/>'
        f'{"".join(spots)}{extra_ring}'
        f'<circle cx="{center}" cy="{center}" r="{radius - 17:.1f}" fill="#F6F2E6" opacity="0.96"/>'
        f'<circle cx="{center}" cy="{center}" r="{radius - 17:.1f}" fill="none" stroke="{body}" stroke-width="1.4"/>'
        f'<text x="{center}" y="{center - 3:.1f}" text-anchor="middle" fill="{body}" font-size="12" '
        f'font-family="Georgia,serif" letter-spacing="1">{casino["chip_monogram"]}</text>'
        f'<text x="{center}" y="{center + 15:.1f}" text-anchor="middle" fill="#1A1A1A" font-size="15" '
        f'font-weight="700">{denomination:,}</text>'
        f'</svg>'
    )


def derive_big_road(results):
    """Big road: columns break when the winning side changes; ties annotate current cell."""
    columns = []
    current = []
    current_side = None
    for side, is_tie in [(r[0], r[0] == "T") for r in results] if False else [(r[0], r[0] == "T") for r in results]:
        pass
    # Build from raw tuples (side, player_pair, banker_pair)
    for entry in results:
        side = entry[0]
        if side == "T":
            if current:
                current[-1]["ties"] += 1
            continue
        if side != current_side:
            if current:
                columns.append(current)
            current = []
            current_side = side
        current.append({"side": side, "ties": 0})
    if current:
        columns.append(current)
    return columns


def derive_bead_plate(results):
    """Bead plate fills top-to-bottom then left-to-right, 6 rows per column."""
    cells = []
    for entry in results:
        cells.append({"side": entry[0], "player_pair": entry[1], "banker_pair": entry[2]})
    return cells


def derive_derived_road(big_road_columns, offset):
    """Big eye boy (offset 1), small road (2), cockroach pig (3).
    Red when the compared columns are 'regular', blue when 'irregular'."""
    marks = []
    for column_index in range(offset + 1, len(big_road_columns)):
        left = big_road_columns[column_index - offset]
        far_left = big_road_columns[column_index - offset - 1]
        marks.append("R" if len(left) == len(far_left) else "B")
    return marks


def scoreboard_svg(casino, results):
    """Real Macau road display: bead plate + big road + three derived roads."""
    width, height = 1180, 470
    style = casino["board_style"]
    gold = casino["gold"]
    line = casino["line_color"]
    banker_red = "#D32F2F"
    player_blue = "#1976D2"
    tie_green = "#2E7D32"

    if style == "hud":
        shell = f'<rect width="{width}" height="{height}" rx="10" fill="#08121C" stroke="{gold}" stroke-width="1.4" opacity="0.98"/>'
        grid_color = "#2A4A60"
        title_font = "'Segoe UI',system-ui,sans-serif"
    elif style == "walnut":
        shell = (f'<rect width="{width}" height="{height}" rx="10" fill="{casino["rail_dark"]}"/>'
                 f'<rect x="8" y="8" width="{width - 16}" height="{height - 16}" rx="6" fill="#0D1A14" '
                 f'stroke="{gold}" stroke-width="2"/>')
        grid_color = "#33473C"
        title_font = "Georgia,serif"
    elif style == "neon":
        shell = (f'<rect width="{width}" height="{height}" rx="10" fill="#0A0410" stroke="{casino["accent"]}" '
                 f'stroke-width="2.5"/>')
        grid_color = "#3A2050"
        title_font = "'Segoe UI',system-ui,sans-serif"
    elif style == "gallery":
        shell = (f'<rect width="{width}" height="{height}" rx="4" fill="#0C0C0C" stroke="{gold}" stroke-width="1.2"/>'
                 f'<rect x="10" y="10" width="{width - 20}" height="{height - 20}" rx="2" fill="none" '
                 f'stroke="{gold}" stroke-width="0.6" opacity="0.5"/>')
        grid_color = "#2E2E2E"
        title_font = "'Helvetica Neue',Arial,sans-serif"
    elif style == "keyfret":
        shell = (f'<rect width="{width}" height="{height}" rx="8" fill="#160A0A" stroke="{gold}" stroke-width="2.5"/>'
                 f'<rect x="10" y="10" width="{width - 20}" height="{height - 20}" rx="4" fill="none" '
                 f'stroke="{casino["accent"]}" stroke-width="1.4" opacity="0.8"/>')
        grid_color = "#4A2020"
        title_font = "'KaiTi','STKaiti',Georgia,serif"
    else:  # stone
        shell = (f'<rect width="{width}" height="{height}" rx="8" fill="#101A16" stroke="{casino["rail"]}" stroke-width="3"/>'
                 f'<rect x="9" y="9" width="{width - 18}" height="{height - 18}" rx="4" fill="none" '
                 f'stroke="{gold}" stroke-width="1.2"/>')
        grid_color = "#2C3E36"
        title_font = "Georgia,serif"

    parts = [f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
             f'role="img" aria-label="{casino["display_name"]} 路單顯示">', shell]

    # ---- Bead plate (珠盤路) ----
    bead_x, bead_y, bead_cell = 26, 54, 34
    bead_rows, bead_cols = 6, 9
    parts.append(f'<text x="{bead_x}" y="{bead_y - 16}" fill="{gold}" font-size="15" '
                 f'font-family="{title_font}" letter-spacing="2">珠盤路 BEAD PLATE</text>')
    for column in range(bead_cols):
        for row in range(bead_rows):
            cx = bead_x + column * bead_cell
            cy = bead_y + row * bead_cell
            parts.append(f'<rect x="{cx}" y="{cy}" width="{bead_cell}" height="{bead_cell}" '
                         f'fill="none" stroke="{grid_color}" stroke-width="1"/>')
    bead_cells = derive_bead_plate(results)
    for index, cell in enumerate(bead_cells[:bead_rows * bead_cols]):
        column, row = divmod(index, bead_rows)
        cx = bead_x + column * bead_cell + bead_cell / 2
        cy = bead_y + row * bead_cell + bead_cell / 2
        fill = {"B": banker_red, "P": player_blue, "T": tie_green}[cell["side"]]
        glyph = {"B": "莊", "P": "閒", "T": "和"}[cell["side"]]
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{bead_cell * 0.38:.1f}" fill="{fill}"/>'
                     f'<text x="{cx}" y="{cy + 4.5}" text-anchor="middle" fill="#FFFFFF" font-size="12">{glyph}</text>')
        if cell["player_pair"]:
            parts.append(f'<circle cx="{cx - bead_cell * 0.34:.1f}" cy="{cy - bead_cell * 0.32:.1f}" r="3.4" fill="{player_blue}" stroke="#FFF" stroke-width="0.8"/>')
        if cell["banker_pair"]:
            parts.append(f'<circle cx="{cx + bead_cell * 0.34:.1f}" cy="{cy - bead_cell * 0.32:.1f}" r="3.4" fill="{banker_red}" stroke="#FFF" stroke-width="0.8"/>')

    # ---- Big road (大路) ----
    big_x, big_y, big_cell = 356, 54, 26
    big_rows, big_cols = 6, 30
    parts.append(f'<text x="{big_x}" y="{big_y - 16}" fill="{gold}" font-size="15" '
                 f'font-family="{title_font}" letter-spacing="2">大路 BIG ROAD</text>')
    for column in range(big_cols):
        for row in range(big_rows):
            parts.append(f'<rect x="{big_x + column * big_cell}" y="{big_y + row * big_cell}" '
                         f'width="{big_cell}" height="{big_cell}" fill="none" stroke="{grid_color}" stroke-width="0.8"/>')
    big_columns = derive_big_road(results)
    for column_index, column in enumerate(big_columns[:big_cols]):
        for row_index, cell in enumerate(column[:big_rows]):
            cx = big_x + column_index * big_cell + big_cell / 2
            cy = big_y + row_index * big_cell + big_cell / 2
            stroke = banker_red if cell["side"] == "B" else player_blue
            parts.append(f'<circle cx="{cx}" cy="{cy}" r="{big_cell * 0.36:.1f}" fill="none" '
                         f'stroke="{stroke}" stroke-width="2.4"/>')
            if cell["ties"]:
                parts.append(f'<path d="M{cx - 7} {cy + 7} L{cx + 7} {cy - 7}" stroke="{tie_green}" stroke-width="1.8"/>')

    # ---- Derived roads: 大眼仔 / 小路 / 曱甴路 ----
    derived_specs = [
        ("大眼仔 BIG EYE BOY", 1, 640, "circle"),
        ("小路 SMALL ROAD", 2, 640, "dot"),
        ("曱甴路 COCKROACH PIG", 3, 640, "slash"),
    ]
    derived_y = 292
    for spec_index, (title, offset, _unused, glyph_kind) in enumerate(derived_specs):
        origin_x = 26 + spec_index * 388
        parts.append(f'<text x="{origin_x}" y="{derived_y - 12}" fill="{gold}" font-size="13" '
                     f'font-family="{title_font}" letter-spacing="1.5">{title}</text>')
        cell_size = 20
        rows, cols = 6, 17
        for column in range(cols):
            for row in range(rows):
                parts.append(f'<rect x="{origin_x + column * cell_size}" y="{derived_y + row * cell_size}" '
                             f'width="{cell_size}" height="{cell_size}" fill="none" stroke="{grid_color}" stroke-width="0.7"/>')
        marks = derive_derived_road(big_columns, offset)
        for mark_index, mark in enumerate(marks[:rows * cols]):
            column, row = divmod(mark_index, rows)
            cx = origin_x + column * cell_size + cell_size / 2
            cy = derived_y + row * cell_size + cell_size / 2
            color = banker_red if mark == "R" else player_blue
            if glyph_kind == "circle":
                parts.append(f'<circle cx="{cx}" cy="{cy}" r="6" fill="none" stroke="{color}" stroke-width="2"/>')
            elif glyph_kind == "dot":
                parts.append(f'<circle cx="{cx}" cy="{cy}" r="5.4" fill="{color}"/>')
            else:
                parts.append(f'<path d="M{cx - 6} {cy + 6} L{cx + 6} {cy - 6}" stroke="{color}" stroke-width="2.2"/>')

    parts.append(f'<text x="{width - 26}" y="{height - 18}" text-anchor="end" fill="{line}" font-size="11" '
                 f'opacity="0.75">五路標準畫法 · 紅=莊 藍=閒 綠=和 · 訓練仿真</text>')
    parts.append('</svg>')
    return "".join(parts)


def result_monitor_svg(casino, results):
    """Table-side result display: shoe/round counters, last outcome, side-bet odds, road summary."""
    width, height = 1180, 300
    style = casino["monitor_style"]
    gold = casino["gold"]
    line = casino["line_color"]

    if style == "bezel-slim":
        frame = (f'<rect width="{width}" height="{height}" rx="12" fill="#05080C"/>'
                 f'<rect x="6" y="6" width="{width - 12}" height="{height - 12}" rx="8" fill="#0A1420" '
                 f'stroke="{gold}" stroke-width="1"/>')
    elif style == "gold-thin":
        frame = (f'<rect width="{width}" height="{height}" rx="10" fill="#120C06"/>'
                 f'<rect x="8" y="8" width="{width - 16}" height="{height - 16}" rx="6" fill="#0C1710" '
                 f'stroke="{gold}" stroke-width="2"/>')
    elif style == "neon-bezel":
        frame = (f'<rect width="{width}" height="{height}" rx="10" fill="#0A0410"/>'
                 f'<rect x="10" y="10" width="{width - 20}" height="{height - 20}" rx="6" fill="#100620" '
                 f'stroke="{casino["accent"]}" stroke-width="3"/>')
    elif style == "art-frame":
        frame = (f'<rect width="{width}" height="{height}" rx="4" fill="#0A0A0A"/>'
                 f'<rect x="14" y="14" width="{width - 28}" height="{height - 28}" rx="2" fill="#0F0F0F" '
                 f'stroke="{gold}" stroke-width="1.6"/>')
    elif style == "copper-bezel":
        frame = (f'<rect width="{width}" height="{height}" rx="8" fill="#3A1A0E"/>'
                 f'<rect x="12" y="12" width="{width - 24}" height="{height - 24}" rx="4" fill="#140A08" '
                 f'stroke="{gold}" stroke-width="2.4"/>')
    else:  # gold-wide
        frame = (f'<rect width="{width}" height="{height}" rx="10" fill="#161208"/>'
                 f'<rect x="12" y="12" width="{width - 24}" height="{height - 24}" rx="6" fill="#0B1712" '
                 f'stroke="{gold}" stroke-width="2.2"/>')

    banker_wins = sum(1 for r in results if r[0] == "B")
    player_wins = sum(1 for r in results if r[0] == "P")
    ties = sum(1 for r in results if r[0] == "T")
    last = results[-1][0] if results else "B"
    last_label = {"B": "莊 BANKER", "P": "閒 PLAYER", "T": "和 TIE"}[last]
    last_color = {"B": "#D32F2F", "P": "#1976D2", "T": "#2E7D32"}[last]

    commission_text = "5% 佣金 COMMISSION" if casino["commission"] else "免佣 NO COMMISSION · 莊6 半賠"

    parts = [f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
             f'role="img" aria-label="{casino["display_name"]} 桌邊顯示器">', frame]
    parts.append(f'<text x="44" y="58" fill="{gold}" font-size="19" letter-spacing="3">'
                 f'{casino["display_name_en"]}</text>')
    parts.append(f'<text x="44" y="86" fill="{line}" font-size="14" opacity="0.85">'
                 f'BACCARAT 百家樂 · {commission_text}</text>')

    parts.append(f'<rect x="44" y="108" width="240" height="120" rx="8" fill="{last_color}" opacity="0.16" '
                 f'stroke="{last_color}" stroke-width="2"/>')
    parts.append(f'<text x="164" y="150" text-anchor="middle" fill="{line}" font-size="13" opacity="0.8">LAST RESULT 上局</text>')
    parts.append(f'<text x="164" y="196" text-anchor="middle" fill="{last_color}" font-size="34">{last_label}</text>')

    stats = [("莊 BANKER", banker_wins, "#D32F2F"), ("閒 PLAYER", player_wins, "#1976D2"), ("和 TIE", ties, "#2E7D32")]
    for index, (label, value, color) in enumerate(stats):
        sx = 320 + index * 150
        parts.append(f'<rect x="{sx}" y="108" width="132" height="120" rx="8" fill="none" '
                     f'stroke="{color}" stroke-width="1.6" opacity="0.85"/>'
                     f'<text x="{sx + 66}" y="146" text-anchor="middle" fill="{line}" font-size="12">{label}</text>'
                     f'<text x="{sx + 66}" y="196" text-anchor="middle" fill="{color}" font-size="36">{value}</text>')

    odds_x = 790
    parts.append(f'<text x="{odds_x}" y="128" fill="{gold}" font-size="13" letter-spacing="2">PAYOUT 賠率</text>')
    payout_lines = [
        "PLAYER 閒 1 : 1",
        "BANKER 莊 1 : 1" + ("（－5%）" if casino["commission"] else "（莊6 賠 1:2）"),
        "TIE 和 8 : 1",
    ] + casino["side_bets"]
    for index, text in enumerate(payout_lines[:5]):
        parts.append(f'<text x="{odds_x}" y="{152 + index * 22}" fill="{line}" font-size="12.5" opacity="0.9">{text}</text>')

    parts.append(f'<text x="{width - 40}" y="{height - 22}" text-anchor="end" fill="{line}" font-size="11" '
                 f'opacity="0.6">訓練仿真 · 非官方授權 · 訓練幣結算</text>')
    parts.append('</svg>')
    return "".join(parts)


PAGE_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 80px;
  background: #07070A;
  color: #E6E3DA;
  font-family: 'Noto Sans TC','Microsoft JhengHei','PingFang TC',system-ui,sans-serif;
  line-height: 1.65;
}
header.page-head {
  padding: 30px 40px 24px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  background: linear-gradient(180deg, var(--brand-wash), transparent);
}
.crumb { font-size: 13px; opacity: 0.62; letter-spacing: 1px; }
.crumb a { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; }
h1 { margin: 10px 0 4px; font-size: 27px; letter-spacing: 1px; }
.subtitle { font-size: 14px; opacity: 0.7; }
.disclaimer {
  margin-top: 14px; display: inline-block;
  padding: 7px 14px; border-radius: 4px;
  background: rgba(255,80,80,0.1); border: 1px solid rgba(255,120,120,0.4);
  font-size: 12.5px; letter-spacing: 0.5px;
}
main { padding: 0 40px; max-width: 1320px; margin: 0 auto; }
section { margin-top: 46px; }
h2 {
  font-size: 19px; letter-spacing: 1.5px; margin: 0 0 6px;
  padding-bottom: 9px; border-bottom: 1px solid rgba(255,255,255,0.12);
}
h2 .en { font-size: 12px; opacity: 0.5; margin-left: 10px; letter-spacing: 2px; }
.note { font-size: 13.5px; opacity: 0.72; margin: 10px 0 18px; }
.canvas {
  background: #0B0B0E; border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px; padding: 18px; overflow: hidden;
}
.canvas svg { width: 100%; height: auto; display: block; }
.row { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.tile {
  background: #0B0B0E; border: 1px solid rgba(255,255,255,0.09);
  border-radius: 8px; padding: 14px; text-align: center;
}
.tile svg { width: 100%; height: auto; display: block; }
.tile .cap { margin-top: 9px; font-size: 12px; opacity: 0.68; letter-spacing: 0.6px; }
.cards .tile { width: 132px; }
.chips .tile { width: 128px; }
.plaques .tile { width: 220px; }
table.spec {
  width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px;
}
table.spec th, table.spec td {
  border: 1px solid rgba(255,255,255,0.12); padding: 9px 12px; text-align: left; vertical-align: top;
}
table.spec th { background: rgba(255,255,255,0.05); font-weight: 600; white-space: nowrap; }
table.spec td code { font-size: 12.5px; opacity: 0.9; }
.swatches { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
.swatch { width: 108px; font-size: 11.5px; }
.swatch i { display: block; height: 46px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.18); }
.swatch b { display: block; margin-top: 6px; font-weight: 500; }
.swatch span { opacity: 0.6; font-family: ui-monospace,Consolas,monospace; }
footer.page-foot {
  margin: 60px 40px 0; padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,0.1);
  font-size: 12.5px; opacity: 0.55;
}
@media (max-width: 860px) {
  header.page-head, main, footer.page-foot { padding-left: 18px; padding-right: 18px; margin-left: 0; margin-right: 0; }
}
"""


def swatch_row(casino):
    entries = [
        ("桌呢 Felt", casino["felt_main"]),
        ("呢面暗部 Shadow", casino["felt_shadow"]),
        ("圍邊 Rail", casino["rail"]),
        ("圍邊暗部", casino["rail_dark"]),
        ("品牌強調 Accent", casino["accent"]),
        ("金屬/描邊 Gold", casino["gold"]),
        ("和局帶 Tie", casino["tie_band"]),
        ("牌背 Card Back", casino["card_back"]),
    ]
    cells = []
    for label, value in entries:
        cells.append(
            f'<div class="swatch"><i style="background:{value}"></i>'
            f'<b>{label}</b><span>{value}</span></div>'
        )
    return f'<div class="swatches">{"".join(cells)}</div>'


def build_casino_page(casino, results):
    name = casino["display_name"]
    currency = casino["currency"]
    ranks_demo = [("A", "♠"), ("9", "♦"), ("K", "♣"), ("7", "♥")]

    card_tiles = [f'<div class="tile">{card_back_svg(casino)}<div class="cap">牌背 Card Back</div></div>']
    for rank, suit in ranks_demo:
        card_tiles.append(
            f'<div class="tile">{card_face_svg(casino, rank, suit)}'
            f'<div class="cap">{rank}{suit}</div></div>'
        )

    chip_tiles = []
    for denom in CHIP_DENOMINATIONS:
        chip_tiles.append(
            f'<div class="tile">{chip_svg(casino, denom)}'
            f'<div class="cap">{currency} {denom:,}</div></div>'
        )

    side_bet_rows = "".join(f"<li>{item}</li>" for item in casino["side_bets"])
    commission_text = (
        "收 5% 佣金（庄赢），荷官侧设佣金格逐座记账"
        if casino["commission"]
        else "免佣桌（No Commission）：庄以 6 点赢只赔一半，桌上不设佣金格"
    )

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{name} — 牌桌資產預覽</title>
<style>{PAGE_CSS}
:root {{ --brand-wash: {casino["accent"]}33; }}
</style>
</head>
<body>
<header class="page-head">
  <div class="crumb"><a href="../index.html">← 返回總覽</a> · 澳門賭場訓練系統 · 牌桌資產預覽</div>
  <h1>{name}</h1>
  <div class="subtitle">{casino["display_name_en"]}</div>
  <div class="subtitle">{casino["notes"]}</div>
  <div class="disclaimer">訓練仿真素材 · 非官方授權 · 品牌可識別但非 1:1 還原 · 訓練幣結算</div>
</header>

<main>

<section>
  <h2>1. 大眾廳牌桌版面 <span class="en">MASS TABLE LAYOUT · 7 SEATS</span></h2>
  <p class="note">依真實百家樂大台版面：荷官位於直邊，客位沿弧邊；每座獨立三注區（近端 PLAYER、中段 BANKER、外側 TIE 帶），
  對子邊注圓圈置於座位兩側；荷官側含碼盤、牌靴、錢箱、廢牌箱{"、佣金格" if casino["commission"] else ""}。</p>
  <div class="canvas">{table_top_svg(casino, layout="mass")}</div>
</section>

<section>
  <h2>2. 貴賓廳牌桌版面 <span class="en">VIP TABLE LAYOUT · 5 SEATS</span></h2>
  <p class="note">貴賓廳座位較少、限紅更高、注區間距加大以便咪牌與大額碼堆擺放。</p>
  <div class="canvas">{table_top_svg(casino, layout="vip")}</div>
</section>

<section>
  <h2>3. 限紅牌 <span class="en">TABLE LIMIT PLAQUE</span></h2>
  <p class="note">限紅數值一律由 Rule Pack 版本化資料驅動，不得烤進貼圖。以下為當前示例值。</p>
  <div class="row plaques">
    <div class="tile"><svg viewBox="0 0 144 104" xmlns="http://www.w3.org/2000/svg">{limit_plaque_svg(casino, casino["mass_min"], casino["mass_max"], currency, 6, 6)}</svg><div class="cap">大眾廳 Mass</div></div>
    <div class="tile"><svg viewBox="0 0 144 104" xmlns="http://www.w3.org/2000/svg">{limit_plaque_svg(casino, casino["vip_min"], casino["vip_max"], currency, 6, 6)}</svg><div class="cap">貴賓廳 VIP</div></div>
  </div>
</section>

<section>
  <h2>4. 撲克牌 <span class="en">PLAYING CARDS</span></h2>
  <p class="note">牌面點數與花色顏色保持國際標準以確保可讀性與教學正確；牌背為各場專屬圖案。真實牌具留白邊。</p>
  <div class="row cards">{"".join(card_tiles)}</div>
</section>

<section>
  <h2>5. 籌碼 <span class="en">CHIPS · {currency}</span></h2>
  <p class="note">環帶配色、邊緣齒紋與中心章各場不同；面額色序與桌面限紅對應。</p>
  <div class="row chips">{"".join(chip_tiles)}</div>
</section>

<section>
  <h2>6. 計分器（五路） <span class="en">ROAD DISPLAY · BEAD PLATE + BIG ROAD + 3 DERIVED</span></h2>
  <p class="note">依澳門實務畫法：珠盤路由上至下、逐列向右，紅莊藍閒綠和並標對子點；大路換邊換列、和局於當前格加註；
  下三路（大眼仔／小路／曱甴路）依大路列高規律衍生紅藍點。</p>
  <div class="canvas">{scoreboard_svg(casino, results)}</div>
</section>

<section>
  <h2>7. 桌邊顯示器 <span class="en">TABLE RESULT MONITOR</span></h2>
  <p class="note">顯示當局點數、勝方、賠付提示與限紅摘要；外框與 UI 鉻色各場不同。</p>
  <div class="canvas">{result_monitor_svg(casino, results)}</div>
</section>

<section>
  <h2>8. 桌台規格與規則摘要 <span class="en">TABLE SPECIFICATION</span></h2>
  <table class="spec">
    <tr><th>桌形</th><td>腰形／半圓（荷官直邊，客位弧邊）</td></tr>
    <tr><th>座位</th><td>大眾廳 {MASS_SEAT_COUNT} 座；貴賓廳 5 座（大台編號慣例跳過 13）</td></tr>
    <tr><th>注區順序</th><td>由客位向內：PLAYER 閒 → BANKER 莊 → TIE 和（外側帶狀）</td></tr>
    <tr><th>邊注</th><td><ul style="margin:0;padding-left:18px">{side_bet_rows}</ul></td></tr>
    <tr><th>佣金</th><td>{commission_text}</td></tr>
    <tr><th>牌靴</th><td>8 副；荷官側牌靴 + 廢牌箱</td></tr>
    <tr><th>智能桌</th><td>{"是（RFID 感應注區描邊）" if casino["smart_table"] else "否（傳統呢面）"}</td></tr>
    <tr><th>限紅</th><td>大眾 {currency} {casino["mass_min"]:,}–{casino["mass_max"]:,}；貴賓 {currency} {casino["vip_min"]:,}–{casino["vip_max"]:,}（示例值，實際以 Rule Pack 為準）</td></tr>
    <tr><th>荷官制服</th><td>{casino["dealer_uniform"]}（3D 模型於後續階段依此執行）</td></tr>
    <tr><th>資產目錄</th><td><code>assets/casinos/{casino["casino_id"]}/</code></td></tr>
  </table>
</section>

<section>
  <h2>9. 主題色板 <span class="en">THEME TOKENS</span></h2>
  <p class="note">以下色值即 <code>theme.json</code> 內容，3D 與 2.5D 表現層共用同一組 token。</p>
  {swatch_row(casino)}
</section>

</main>

<footer class="page-foot">
  訓練仿真素材，非官方授權，不代表任何營運商實際場景；限紅與規則以 Rule Pack 版本化資料為準。<br>
  由 <code>docs/design-preview/_real_gen.py</code> 生成。
</footer>
</body>
</html>
"""


def build_index_page():
    cards = []
    for casino in CASINOS:
        cards.append(f"""
    <a class="entry" href="casinos/{casino["casino_id"]}.html">
      <span class="bar" style="background:linear-gradient(90deg,{casino["accent"]},{casino["gold"]})"></span>
      <b>{casino["display_name"]}</b>
      <em>{casino["display_name_en"]}</em>
      <p>{casino["notes"]}</p>
      <div class="mini">
        <i style="background:{casino["felt_main"]}"></i>
        <i style="background:{casino["rail"]}"></i>
        <i style="background:{casino["accent"]}"></i>
        <i style="background:{casino["gold"]}"></i>
        <i style="background:{casino["card_back"]}"></i>
      </div>
      <div class="meta">{"收佣 5%" if casino["commission"] else "免佣桌"} · {casino["currency"]} {casino["mass_min"]:,}起 · {"智能桌" if casino["smart_table"] else "傳統桌"}</div>
    </a>""")

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>澳門賭場訓練系統 — 牌桌資產預覽總覽</title>
<style>{PAGE_CSS}
:root {{ --brand-wash: #1A4A7A33; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 20px; margin-top: 26px; }}
.entry {{
  display: block; text-decoration: none; color: inherit;
  background: #0B0B0E; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px; padding: 0 18px 18px; overflow: hidden;
  transition: border-color .18s, transform .18s;
}}
.entry:hover {{ border-color: rgba(255,255,255,0.35); transform: translateY(-2px); }}
.entry .bar {{ display: block; height: 5px; margin: 0 -18px 16px; }}
.entry b {{ font-size: 16.5px; display: block; }}
.entry em {{ font-size: 11.5px; opacity: 0.5; font-style: normal; letter-spacing: 1px; }}
.entry p {{ font-size: 13px; opacity: 0.72; margin: 10px 0 12px; }}
.mini {{ display: flex; gap: 6px; }}
.mini i {{ width: 34px; height: 22px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.16); }}
.meta {{ margin-top: 12px; font-size: 12px; opacity: 0.6; }}
</style>
</head>
<body>
<header class="page-head">
  <div class="crumb">澳門賭場訓練系統 · 資產設計預覽</div>
  <h1>六大營運商牌桌資產預覽</h1>
  <div class="subtitle">依真實百家樂牌桌版面規格繪製：牌桌、限紅牌、撲克牌、籌碼、五路計分器、桌邊顯示器</div>
  <div class="disclaimer">訓練仿真素材 · 非官方授權 · 品牌可識別但非 1:1 還原</div>
</header>
<main>
  <section style="margin-top:20px">
    <h2>選擇賭場主題 <span class="en">SELECT CASINO THEME</span></h2>
    <div class="grid">{"".join(cards)}</div>
  </section>
  <section>
    <h2>共用版面規格 <span class="en">SHARED LAYOUT RULES</span></h2>
    <table class="spec">
      <tr><th>桌形</th><td>腰形／半圓，荷官在直邊中央，客位沿弧邊</td></tr>
      <tr><th>注區堆疊</th><td>每座由近至遠：PLAYER 閒 / BANKER 莊 / TIE 和</td></tr>
      <tr><th>座位數</th><td>大眾廳 7 座（迷你／中台慣例）；貴賓廳 5 座；大台編號跳 13</td></tr>
      <tr><th>荷官側設備</th><td>碼盤 Chip Tray、牌靴 Shoe、錢箱 Drop Box、廢牌箱 Discard、佣金格（收佣桌）</td></tr>
      <tr><th>五路計分</th><td>珠盤路、大路、大眼仔路、小路、曱甴路</td></tr>
      <tr><th>差異來源</th><td>賭場差異僅由 Theme（材質色板／圖案）與 Rule Pack（限紅／邊注／佣金）決定，桌體幾何共用</td></tr>
    </table>
  </section>
</main>
<footer class="page-foot">
  由 <code>docs/design-preview/_real_gen.py</code> 生成；規格依據見
  <code>docs/superpowers/specs/2026-07-27-macau-real-table-layout-requirements.md</code>。
</footer>
</body>
</html>
"""


def write_theme_json(casino):
    payload = {
        "casinoId": casino["casino_id"],
        "displayName": casino["display_name"],
        "displayNameEn": casino["display_name_en"],
        "disclaimer": "訓練仿真素材，非官方授權，品牌可識別但非 1:1 還原",
        "palette": {
            "feltMain": casino["felt_main"],
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
            "feltPattern": casino["felt_pattern"],
            "railStyle": casino["rail_style"],
            "cardPattern": casino["card_pattern"],
            "chipEdge": casino["chip_edge"],
            "chipRings": casino["chip_rings"],
            "boardStyle": casino["board_style"],
            "monitorStyle": casino["monitor_style"],
            "plaqueStyle": casino["plaque_style"],
        },
        "identity": {"monogram": casino["monogram"], "chipMonogram": casino["chip_monogram"]},
        "tableLayout": {
            "shape": "kidney",
            "massSeats": MASS_SEAT_COUNT,
            "vipSeats": 5,
            "bigTableSeatLabels": BIG_TABLE_SEAT_LABELS,
            "betOrderFromGuest": ["player", "banker", "tie"],
            "commissionBoxes": casino["commission"],
            "smartTable": casino["smart_table"],
        },
        "limitsExample": {
            "currency": casino["currency"],
            "mass": {"min": casino["mass_min"], "max": casino["mass_max"]},
            "vip": {"min": casino["vip_min"], "max": casino["vip_max"]},
        },
        "sideBets": casino["side_bets"],
        "chipDenominations": CHIP_DENOMINATIONS,
        "dealerUniform": casino["dealer_uniform"],
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
        print("wrote", casino["casino_id"])
    (ROOT / "index.html").write_text(build_index_page(), encoding="utf-8")
    print("wrote index.html")


if __name__ == "__main__":
    main()
