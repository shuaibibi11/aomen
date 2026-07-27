# -*- coding: utf-8 -*-
"""Generate casino reference images through an OpenAI-compatible image relay.

The refined SVG previews define the authoritative layout geometry. These
generated images are *art direction references* only: felt weave, rail
material, lighting mood and dealer uniform. They are never used as the
source of truth for betting-area positions, limits or payouts.

Usage
-----
    python tools/generate_reference_images.py --list
    python tools/generate_reference_images.py --casino wynn
    python tools/generate_reference_images.py --casino wynn --kind table-mood
    python tools/generate_reference_images.py --all --kind felt-swatch

Credentials come from .env (never committed):
    MCT_IMAGE_API_BASE, MCT_IMAGE_API_KEY, MCT_IMAGE_MODEL, MCT_HTTP_PROXY
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
THEME_ROOT = PROJECT_ROOT / "assets" / "casinos"
OUTPUT_ROOT = PROJECT_ROOT / "assets" / "generated"

REQUEST_TIMEOUT_SECONDS = 240
PAUSE_BETWEEN_REQUESTS_SECONDS = 3

# The relay occasionally returns 502/504 when its upstream provider times out.
# Those failures are transient, so retry with a growing pause before giving up.
MAX_ATTEMPTS_PER_IMAGE = 4
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}
RETRY_BACKOFF_SECONDS = [10, 25, 45]

# Every prompt ends with these constraints. Brand marks are deliberately
# excluded so generated references stay legally safe for a training product.
GLOBAL_CONSTRAINTS = (
    "No text, no lettering, no numbers, no logos, no brand marks, "
    "no watermarks, no people's faces in focus. "
    "Photographic, physically plausible casino furniture, "
    "neutral colour balance suitable for texture reference."
)


def load_environment(env_path: Path) -> dict[str, str]:
    """Read simple KEY=VALUE pairs from a .env file."""
    if not env_path.exists():
        raise SystemExit(
            f"Missing {env_path}. Copy .env.example to .env and fill in credentials."
        )
    settings: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        settings[key.strip()] = value.strip()
    return settings


def load_casino_themes(theme_root: Path) -> dict[str, dict]:
    """Load every theme.json so prompts stay in sync with the design tokens."""
    themes: dict[str, dict] = {}
    for theme_file in sorted(theme_root.glob("*/theme.json")):
        themes[theme_file.parent.name] = json.loads(
            theme_file.read_text(encoding="utf-8")
        )
    if not themes:
        raise SystemExit(f"No theme.json files found under {theme_root}")
    return themes


# Per-casino art direction. Keys match the casino_id used by the SVG generator.
ART_DIRECTION = {
    "sands-venetian": {
        "felt": "emerald green wool felt with a faint tone-on-tone damask scroll weave",
        "rail": "cream white marble armrest rail with warm gold inlay piping",
        "mood": "warm European palazzo lighting, gilded arcade columns blurred behind",
        "uniform": "white dress shirt, gold-brown waistcoat, white gloves",
    },
    "galaxy": {
        "felt": "indigo blue wool felt with faint concentric orbital ring weave",
        "rail": "brushed stainless steel armrest rail with a cool specular highlight",
        "mood": "bright modern resort lighting, cool silver-blue ambience, glass and steel",
        "uniform": "charcoal grey suit with a silver bow tie",
    },
    "wynn": {
        "felt": "deep forest green wool felt with faint symmetrical petal motif weave",
        "rail": "polished walnut wood armrest rail with a slim brass inlay strip",
        "mood": "intimate warm amber lighting, rich burgundy and gold surroundings",
        "uniform": "black waistcoat with gold trim and a burgundy necktie",
    },
    "melco-cod": {
        "felt": "deep violet purple wool felt with faint diamond lattice weave",
        "rail": "glossy piano black armrest rail with a thin magenta LED light line",
        "mood": "contemporary nightlife lighting, magenta and teal accent glow, dark surfaces",
        "uniform": "black shirt with a magenta ribbon trim, short modern vest",
    },
    "mgm": {
        "felt": "near-black dark green wool felt, very subtle plain weave",
        "rail": "matte black armrest rail with a single thin gold pinstripe",
        "mood": "minimal art-gallery lighting, clean lines, generous negative space",
        "uniform": "all black uniform with gold buttons",
    },
    "sjm-lisboa": {
        "felt": "traditional deep green wool felt with faint lotus silhouette weave",
        "rail": "dark rosewood armrest rail with decorative copper stud nails",
        "mood": "classic Chinese casino warmth, red and gold surroundings, brass fittings",
        "uniform": "red and black waistcoat with a copper name badge",
    },
}

# Prompt builders keyed by asset kind.
PROMPT_KINDS = {
    "felt-swatch": (
        "Flat top-down macro photograph of a casino gaming table felt swatch: {felt}. "
        "Even studio softbox lighting, fills the entire frame, sharp fabric fibre detail, "
        "seamless texture reference for a 3D material."
    ),
    "rail-material": (
        "Close-up macro photograph of a casino gaming table padded armrest rail: {rail}. "
        "Shallow depth of field along the curve, studio lighting, material reference."
    ),
    "table-mood": (
        "Wide three-quarter photograph of an empty baccarat gaming table in a Macau casino. "
        "Kidney-shaped table with {felt} and {rail}. Dealer position at the flat edge with "
        "a card shoe and a chip tray; seven guest positions along the curved edge. "
        "{mood}. The printed betting layout is left blank and unmarked."
    ),
    "chip-stack": (
        "Macro photograph of stacks of casino chips on {felt}. "
        "Clay composite chips with edge-spot inserts, crisp rim detail, "
        "shallow depth of field, {mood}."
    ),
    "dealer-uniform": (
        "Waist-up photograph of a professional casino dealer standing behind a baccarat "
        "table, seen from the front, hands resting on the table edge. "
        "Wearing {uniform}. {mood}. Head cropped above the frame, face not visible."
    ),
    "room-ambience": (
        "Wide photograph of a Macau casino gaming floor interior with rows of "
        "baccarat tables. {mood}. Empty tables, no players, architectural reference "
        "for lighting and material mood."
    ),
}

DEFAULT_KINDS = ["felt-swatch", "rail-material", "table-mood"]


def build_prompt(casino_id: str, kind: str) -> str:
    """Compose the final prompt for one casino and one asset kind."""
    if kind not in PROMPT_KINDS:
        raise SystemExit(
            f"Unknown kind '{kind}'. Valid kinds: {', '.join(sorted(PROMPT_KINDS))}"
        )
    direction = ART_DIRECTION.get(casino_id)
    if direction is None:
        raise SystemExit(f"No art direction defined for casino '{casino_id}'")
    body = PROMPT_KINDS[kind].format(**direction)
    return f"{body} {GLOBAL_CONSTRAINTS}"


def request_image(settings: dict[str, str], prompt: str, size: str) -> bytes:
    """Call the relay and return decoded PNG bytes."""
    base_url = settings["MCT_IMAGE_API_BASE"].rstrip("/")
    payload = json.dumps(
        {
            "model": settings.get("MCT_IMAGE_MODEL", "gpt-image-2"),
            "prompt": prompt,
            "size": size,
            "n": 1,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"{base_url}/v1/images/generations",
        data=payload,
        headers={
            "Authorization": f"Bearer {settings['MCT_IMAGE_API_KEY']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    proxy_url = settings.get("MCT_HTTP_PROXY", "").strip()
    if proxy_url:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        )
    else:
        opener = urllib.request.build_opener()

    with opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        parsed = json.loads(response.read().decode("utf-8"))

    first_result = parsed["data"][0]
    if first_result.get("b64_json"):
        return base64.b64decode(first_result["b64_json"])

    image_url = first_result.get("url")
    if not image_url:
        raise RuntimeError("Relay returned neither b64_json nor url")
    with opener.open(image_url, timeout=REQUEST_TIMEOUT_SECONDS) as image_response:
        return image_response.read()


def generate_one(settings: dict[str, str], casino_id: str, kind: str, size: str,
                 overwrite: bool) -> Path | None:
    """Generate and save a single reference image."""
    output_directory = OUTPUT_ROOT / casino_id
    output_directory.mkdir(parents=True, exist_ok=True)
    output_path = output_directory / f"{kind}.png"

    if output_path.exists() and not overwrite:
        print(f"  skip   {casino_id}/{kind}.png (exists, use --overwrite)")
        return output_path

    prompt = build_prompt(casino_id, kind)
    image_bytes = None

    for attempt_index in range(MAX_ATTEMPTS_PER_IMAGE):
        attempt_label = f"attempt {attempt_index + 1}/{MAX_ATTEMPTS_PER_IMAGE}"
        print(f"  render {casino_id}/{kind}.png ({attempt_label}) ...", flush=True)
        try:
            image_bytes = request_image(settings, prompt, size)
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:200]
            retryable = error.code in RETRYABLE_HTTP_STATUS
            print(f"    HTTP {error.code}{' (retryable)' if retryable else ''}: {detail}")
            if not retryable:
                break
        except Exception as error:  # noqa: BLE001 - transient network failures
            print(f"    {type(error).__name__}: {str(error)[:200]}")

        is_last_attempt = attempt_index == MAX_ATTEMPTS_PER_IMAGE - 1
        if not is_last_attempt:
            backoff = RETRY_BACKOFF_SECONDS[
                min(attempt_index, len(RETRY_BACKOFF_SECONDS) - 1)
            ]
            print(f"    retrying in {backoff}s", flush=True)
            time.sleep(backoff)

    if image_bytes is None:
        print(f"  FAILED {casino_id}/{kind} after {MAX_ATTEMPTS_PER_IMAGE} attempts")
        return None

    output_path.write_bytes(image_bytes)
    prompt_log = output_directory / f"{kind}.prompt.txt"
    prompt_log.write_text(prompt + "\n", encoding="utf-8")
    print(f"  saved  {output_path.relative_to(PROJECT_ROOT)} "
          f"({len(image_bytes) // 1024} KB)")
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--casino", action="append", default=[],
                        help="casino id (repeatable)")
    parser.add_argument("--all", action="store_true", help="every casino")
    parser.add_argument("--kind", action="append", default=[],
                        help=f"asset kind (repeatable): {', '.join(sorted(PROMPT_KINDS))}")
    parser.add_argument("--size", default="1024x1024", help="image size")
    parser.add_argument("--overwrite", action="store_true",
                        help="regenerate images that already exist")
    parser.add_argument("--list", action="store_true",
                        help="list available casinos and kinds, then exit")
    arguments = parser.parse_args()

    themes = load_casino_themes(THEME_ROOT)

    if arguments.list:
        print("casinos:")
        for casino_id, theme in themes.items():
            print(f"  {casino_id:16} {theme['displayName']}")
        print("\nkinds:")
        for kind in sorted(PROMPT_KINDS):
            print(f"  {kind}")
        return 0

    if arguments.all:
        target_casinos = list(themes.keys())
    elif arguments.casino:
        target_casinos = arguments.casino
        unknown = [name for name in target_casinos if name not in themes]
        if unknown:
            raise SystemExit(f"Unknown casino id(s): {', '.join(unknown)}")
    else:
        raise SystemExit("Specify --casino <id> (repeatable) or --all. Use --list to see options.")

    target_kinds = arguments.kind or DEFAULT_KINDS

    settings = load_environment(ENV_FILE)
    for required_key in ("MCT_IMAGE_API_BASE", "MCT_IMAGE_API_KEY"):
        if not settings.get(required_key):
            raise SystemExit(f"{required_key} missing from {ENV_FILE}")

    total_jobs = len(target_casinos) * len(target_kinds)
    print(f"Generating {total_jobs} image(s) at {arguments.size}\n")

    succeeded = 0
    for casino_id in target_casinos:
        print(f"{casino_id} ({themes[casino_id]['displayName']})")
        for kind in target_kinds:
            result = generate_one(settings, casino_id, kind,
                                  arguments.size, arguments.overwrite)
            if result is not None:
                succeeded += 1
            time.sleep(PAUSE_BETWEEN_REQUESTS_SECONDS)
        print()

    print(f"Done: {succeeded}/{total_jobs} image(s) available.")
    return 0 if succeeded == total_jobs else 1


if __name__ == "__main__":
    sys.exit(main())
