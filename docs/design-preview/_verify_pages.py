# -*- coding: utf-8 -*-
"""Verify the generated preview pages: markup balance and reference image links."""
from pathlib import Path
import re

PREVIEW_ROOT = Path(__file__).resolve().parent
CASINO_PAGE_DIR = PREVIEW_ROOT / "casinos"

EXPECTED_SECTION_COUNT = 10


def verify_page(page_path: Path) -> list[str]:
    """Return a list of problems found in one page."""
    problems: list[str] = []
    html = page_path.read_text(encoding="utf-8")

    svg_open = len(re.findall(r"<svg[\s>]", html))
    svg_close = html.count("</svg>")
    if svg_open != svg_close:
        problems.append(f"svg tags unbalanced: {svg_open} open / {svg_close} close")

    group_open = len(re.findall(r"<g[\s>]", html))
    group_close = html.count("</g>")
    if group_open != group_close:
        problems.append(f"g tags unbalanced: {group_open} open / {group_close} close")

    section_count = html.count("<section>")
    if section_count != EXPECTED_SECTION_COUNT:
        problems.append(
            f"expected {EXPECTED_SECTION_COUNT} sections, found {section_count}"
        )

    unresolved_templates = re.findall(r"\{[a-z_]+[\[\(\.]", html)
    if unresolved_templates:
        problems.append(f"unresolved template markers: {unresolved_templates[:3]}")

    image_sources = re.findall(r'<img src="([^"]+)"', html)
    if not image_sources:
        problems.append("no reference images linked")
    for source in image_sources:
        resolved = (page_path.parent / source).resolve()
        if not resolved.exists():
            problems.append(f"broken image link: {source}")

    return problems


def main() -> None:
    report_lines: list[str] = []
    total_problems = 0

    for page_path in sorted(CASINO_PAGE_DIR.glob("*.html")):
        problems = verify_page(page_path)
        total_problems += len(problems)
        status = "OK" if not problems else "PROBLEMS"
        report_lines.append(f"{page_path.stem:16} {status}")
        for problem in problems:
            report_lines.append(f"    - {problem}")

    report_lines.append("")
    report_lines.append(
        "all pages clean" if total_problems == 0 else f"{total_problems} problem(s) found"
    )

    (PREVIEW_ROOT / "_verify_report.txt").write_text(
        "\n".join(report_lines) + "\n", encoding="utf-8"
    )
    print("\n".join(report_lines))


if __name__ == "__main__":
    main()
