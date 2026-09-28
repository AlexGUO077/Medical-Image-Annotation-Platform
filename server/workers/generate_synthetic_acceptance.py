#!/usr/bin/env python3
"""Create ephemeral, wholly synthetic inputs for the M1 HTTP acceptance smoke."""

from pathlib import Path
import sys
import zipfile

from PIL import Image, ImageDraw, ImageFont

from verify_real_inference import synthetic_dicom


def main() -> None:
    root = Path(sys.argv[1])
    root.mkdir(parents=True, exist_ok=True)
    report = root / "report.txt"
    report.write_text("患者：张三，45岁。合成验证报告。", encoding="utf-8")
    image = Image.new("RGB", (800, 400), "white")
    ImageDraw.Draw(image).text(
        (40, 40), "Name: SYNTHETIC TEST",
        font=ImageFont.load_default(size=36), fill="black",
    )
    image.save(root / "named-image.png")
    dicom = root / "source.dcm"
    synthetic_dicom(dicom, image)
    with zipfile.ZipFile(root / "case.zip", "w") as archive:
        archive.write(dicom, "one.dcm")
        archive.write(report, "report.txt")


if __name__ == "__main__":
    main()
