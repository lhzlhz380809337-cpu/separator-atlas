"""Generate the Windows desktop icon from the workbench visual language."""
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "desktop" / "SeparatorAtlas.ico"


def make_icon(size: int) -> Image.Image:
    scale = 4
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    pad = round(size * 0.035 * scale)
    radius = round(size * 0.24 * scale)
    draw.rounded_rectangle(
        (pad, pad, size * scale - pad, size * scale - pad),
        radius=radius,
        fill=(20, 59, 83, 255),
    )
    points = [
        (0.20, 0.35), (0.50, 0.18), (0.80, 0.35), (0.50, 0.52), (0.20, 0.35),
    ]
    points = [(round(x * size * scale), round(y * size * scale)) for x, y in points]
    width = max(scale, round(size * 0.055 * scale))
    draw.line(points, fill=(114, 210, 205, 255), width=width, joint="curve")
    for y_left, y_center, y_right in ((0.54, 0.70, 0.54), (0.70, 0.86, 0.70)):
        layer = [
            (round(0.20 * size * scale), round(y_left * size * scale)),
            (round(0.50 * size * scale), round(y_center * size * scale)),
            (round(0.80 * size * scale), round(y_right * size * scale)),
        ]
        draw.line(layer, fill=(114, 210, 205, 255), width=width, joint="curve")
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [make_icon(size) for size in sizes]
    images[-1].save(OUTPUT, format="ICO", append_images=images[:-1], sizes=[(s, s) for s in sizes])
    print(OUTPUT)


if __name__ == "__main__":
    main()
