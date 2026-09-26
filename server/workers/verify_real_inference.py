#!/usr/bin/env python3
"""Linux smoke for real local OCR/NER with synthetic inputs only."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import secrets
import tempfile
import zipfile

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid
from PIL import Image, ImageDraw, ImageFont


spec = importlib.util.spec_from_file_location("deid_worker", Path(__file__).with_name("deid_worker.py"))
worker = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(worker)


def synthetic_dicom(path: Path) -> str:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    study_uid = generate_uid()
    dataset = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = meta.MediaStorageSOPClassUID
    dataset.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    dataset.StudyInstanceUID = study_uid
    dataset.SeriesInstanceUID = generate_uid()
    dataset.PatientName = "SYNTHETIC^TEST"
    dataset.PatientID = "SYNTHETIC-ID"
    dataset.StudyDate = "20260926"
    dataset.Modality = "DX"
    dataset.BodyPartExamined = "CHEST"
    dataset.Rows = 64
    dataset.Columns = 64
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 16
    dataset.BitsStored = 16
    dataset.HighBit = 15
    dataset.PixelRepresentation = 0
    dataset.PixelData = np.zeros((64, 64), dtype=np.uint16).tobytes()
    dataset.save_as(path, enforce_file_format=True)
    return study_uid


def main() -> None:
    # Ephemeral test secret; never printed or persisted outside the process.
    os.environ["DICOM_UID_SECRET"] = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix="miap-real-inference-") as temporary:
        root = Path(temporary)
        report = root / "report.txt"
        report.write_text("患者：张三，45岁。合成验证报告。", encoding="utf-8")
        named_image = root / "named-image.png"
        image = Image.new("RGB", (800, 400), "white")
        ImageDraw.Draw(image).text((40, 40), "Name: SYNTHETIC TEST", font=ImageFont.load_default(size=36), fill="black")
        image.save(named_image)

        manual = worker.process_manual({
            "report_path": str(report), "image_path": str(named_image), "output_path": str(root / "manual"),
        })
        assert "张三" not in manual["masked_report"] and manual["masked_count"] >= 1
        assert manual["image_redaction_count"] >= 1
        assert worker.run_ocr(Image.open(manual["image_path"]), np) == []
        print("PASS real manual report NER and key-image OCR redaction", flush=True)

        dicom = root / "source.dcm"
        original_uid = synthetic_dicom(dicom)
        archive = root / "case.zip"
        with zipfile.ZipFile(archive, "w") as compressed:
            compressed.write(dicom, "one.dcm")
            compressed.write(report, "report.txt")
        extracted = worker.inspect_zip({"zip_path": str(archive), "output_path": str(root / "extracted")})
        assert len(extracted["items"]) == 1
        processed = worker.process_case({
            "case_path": extracted["items"][0]["path"], "output_path": str(root / "dicom-safe"),
        })
        assert not processed["review"]["ocr_failed"] and processed["review"]["masked_count"] >= 1
        assert "张三" not in processed["review"]["masked_report"]
        safe_file = Path(processed["processed"]["series"][0]["dicom_paths"][0])
        safe_dataset = pydicom.dcmread(safe_file)
        assert str(safe_dataset.PatientName) == "ANONYMIZED"
        assert str(safe_dataset.PatientID) == "ANONYMIZED"
        assert str(safe_dataset.StudyInstanceUID) != original_uid
        print("PASS real ZIP DICOM/report de-identification and OCR check", flush=True)

        clean_image = root / "clean.png"
        Image.new("RGB", (800, 400), "white").save(clean_image)
        clean = worker.process_attachment({
            "input_path": str(clean_image), "format": "png", "output_path": str(root / "attachment-clean"),
        })
        assert clean["page_count"] == 1
        try:
            worker.process_attachment({
                "input_path": str(named_image), "format": "png", "output_path": str(root / "attachment-rejected"),
            })
        except worker.WorkerError as error:
            assert error.code == "ATTACHMENT_IDENTIFIERS_FOUND"
        else:
            raise AssertionError("Identified synthetic attachment was accepted")
        print("PASS real attachment OCR accepts clean image and rejects identifier", flush=True)


if __name__ == "__main__":
    main()
