#!/usr/bin/env python3
"""Local-only ZIP inspection, DICOM de-identification, OCR and report masking worker."""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import subprocess
import xml.etree.ElementTree as ET
import zipfile

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
MAX_FILES = 5000
MAX_RATIO = 100
ALLOWED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
SUPPORTED_MODALITIES = {"CR", "DX", "CT", "MR", "US"}
UID_PRESERVE_KEYWORDS = {"SOPClassUID", "MediaStorageSOPClassUID", "TransferSyntaxUID", "ImplementationClassUID"}


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def inspect_zip(request: dict) -> dict:
    zip_path = checked_path(request, "zip_path")
    output_path = checked_path(request, "output_path")
    if not zip_path.is_file() or zip_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise WorkerError("ZIP_SIZE_LIMIT", "ZIP 大小超过限制或文件不存在")
    if output_path.exists():
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True, mode=0o700)

    try:
        with zipfile.ZipFile(zip_path) as archive:
            files = [info for info in archive.infolist() if not info.is_dir()]
            if not files:
                raise WorkerError("ZIP_EMPTY", "ZIP 中没有文件")
            if len(files) > MAX_FILES:
                raise WorkerError("ZIP_FILE_COUNT_LIMIT", "ZIP 文件数量超过限制")
            expanded = sum(info.file_size for info in files)
            compressed = sum(info.compress_size for info in files)
            if expanded > MAX_EXPANDED_BYTES:
                raise WorkerError("ZIP_EXPANDED_SIZE_LIMIT", "ZIP 展开大小超过限制")
            if expanded > 0 and (compressed == 0 or expanded / compressed > MAX_RATIO):
                raise WorkerError("ZIP_RATIO_LIMIT", "ZIP 压缩比超过限制")

            normalized = []
            seen = set()
            for info in files:
                path = safe_member_path(info)
                key = path.as_posix().casefold()
                if key in seen:
                    raise WorkerError("ZIP_DUPLICATE_PATH", "ZIP 包含规范化后重名路径")
                seen.add(key)
                normalized.append((info, path))

            has_root_files = any(len(path.parts) == 1 for _, path in normalized)
            has_nested_files = any(len(path.parts) > 1 for _, path in normalized)
            if has_root_files and has_nested_files:
                raise WorkerError("ZIP_STRUCTURE_INVALID", "ZIP 不得混用根目录病例和多病例目录")

            grouped: dict[str, list[tuple[zipfile.ZipInfo, PurePosixPath]]] = {}
            if has_root_files:
                grouped["single-case"] = normalized
            else:
                for info, path in normalized:
                    grouped.setdefault(path.parts[0], []).append((info, path))

            items = []
            for index, (_source_group, entries) in enumerate(sorted(grouped.items()), start=1):
                report_count = 0
                dicom_count = 0
                item_path = output_path / f"item-{index:04d}"
                item_path.mkdir(mode=0o700)
                for info, path in entries:
                    relative = path if has_root_files else PurePosixPath(*path.parts[1:])
                    if not relative.parts:
                        raise WorkerError("ZIP_STRUCTURE_INVALID", "病例目录包含无效路径")
                    is_report = relative.name.casefold() == "report.txt"
                    is_dicom = relative.suffix.casefold() == ".dcm"
                    if is_report and len(relative.parts) != 1:
                        raise WorkerError("ZIP_REPORT_LOCATION_INVALID", "report.txt 必须位于病例目录根部")
                    if not is_report and not is_dicom:
                        raise WorkerError("UNSUPPORTED_FILE", "ZIP 包含不支持的文件")
                    report_count += int(is_report)
                    dicom_count += int(is_dicom)
                    if report_count > 1:
                        raise WorkerError("ZIP_REPORT_DUPLICATE", "病例包含多个 report.txt")
                    destination = item_path / "report.txt" if is_report else item_path.joinpath(*relative.parts)
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with archive.open(info) as source, destination.open("xb") as target:
                        shutil.copyfileobj(source, target, length=1024 * 1024)
                if dicom_count == 0:
                    raise WorkerError("DICOM_MISSING", "病例目录没有 DICOM 文件")
                items.append({"display_name": f"case-{index:04d}", "path": str(item_path.resolve())})
            return {
                "compressed_size": compressed,
                "expanded_size": expanded,
                "file_count": len(files),
                "items": items,
            }
    except zipfile.BadZipFile as error:
        raise WorkerError("ZIP_INVALID", "ZIP 文件无效") from error
    except Exception:
        shutil.rmtree(output_path, ignore_errors=True)
        raise


def safe_member_path(info: zipfile.ZipInfo) -> PurePosixPath:
    if info.flag_bits & 0x1:
        raise WorkerError("ZIP_ENCRYPTED", "不接受加密 ZIP")
    if info.compress_type not in ALLOWED_COMPRESSION:
        raise WorkerError("ZIP_COMPRESSION_UNSUPPORTED", "ZIP 使用了不支持的压缩方式")
    if stat.S_ISLNK(info.external_attr >> 16):
        raise WorkerError("ZIP_SYMLINK", "ZIP 不允许符号链接")
    name = info.filename.replace("\\", "/")
    path = PurePosixPath(name)
    if not name or name.startswith("/") or re.match(r"^[A-Za-z]:", name) or any(part in ("", ".", "..") for part in path.parts):
        raise WorkerError("ZIP_PATH_INVALID", "ZIP 包含非法路径")
    if len(path.parts) > 16:
        raise WorkerError("ZIP_PATH_DEPTH_LIMIT", "ZIP 目录层级超过限制")
    if path.suffix.casefold() in {".zip", ".rar", ".7z", ".tar", ".gz"}:
        raise WorkerError("ZIP_NESTED_ARCHIVE", "ZIP 不允许嵌套压缩包")
    return path


def process_case(request: dict) -> dict:
    case_path = checked_path(request, "case_path")
    output_path = checked_path(request, "output_path")
    uid_secret = os.environ.get("DICOM_UID_SECRET", "")
    if len(uid_secret.encode("utf8")) < 32:
        raise WorkerError("DICOM_UID_SECRET_INVALID", "DICOM UID 密钥未配置或长度不足")
    if output_path.exists():
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True, mode=0o700)

    try:
        import numpy as np
        import pydicom
        from PIL import Image
        from dicomanonymizer.simpledicomanonymizer import (
            anonymize_dataset,
            dictionary,
            initialize_actions_2024b,
        )
    except ImportError as error:
        raise WorkerError("DEIDENTIFICATION_WORKER_UNAVAILABLE", "DICOM 脱敏依赖不可用") from error

    dicom_paths = sorted(path for path in case_path.rglob("*") if path.is_file() and path.suffix.casefold() == ".dcm")
    if not dicom_paths:
        raise WorkerError("DICOM_MISSING", "病例目录没有 DICOM 文件")
    try:
        datasets = [(path, pydicom.dcmread(path)) for path in dicom_paths]
    except Exception as error:
        raise WorkerError("DICOM_INVALID", "DICOM 文件无法解析") from error

    study_uids = {str(dataset.StudyInstanceUID) for _, dataset in datasets if getattr(dataset, "StudyInstanceUID", None)}
    if len(study_uids) != 1:
        raise WorkerError("MULTIPLE_STUDIES", "一个病例目录必须且只能包含一个 Study")
    study_date = next((str(dataset.StudyDate) for _, dataset in datasets if getattr(dataset, "StudyDate", None)), None)
    if not study_date or not re.fullmatch(r"\d{8}", study_date):
        raise WorkerError("DICOM_STUDY_DATE_MISSING", "DICOM StudyDate 缺失或无效")
    study_date_iso = f"{study_date[0:4]}-{study_date[4:6]}-{study_date[6:8]}"

    dictionary.clear()
    for _, dataset in datasets:
        for element in dataset.iterall():
            if element.VR != "UI" or element.keyword in UID_PRESERVE_KEYWORDS:
                continue
            values = list(element.value) if isinstance(element.value, (list, tuple)) else [element.value]
            for value in values:
                if value:
                    dictionary[str(value)] = deterministic_uid(str(value), uid_secret)

    series_groups: dict[str, list] = {}
    for pair in datasets:
        dataset = pair[1]
        series_uid = str(getattr(dataset, "SeriesInstanceUID", ""))
        if not series_uid:
            raise WorkerError("DICOM_SERIES_UID_MISSING", "DICOM SeriesInstanceUID 缺失")
        series_groups.setdefault(series_uid, []).append(pair)

    ocr_hits = []
    ocr_failed = False
    preview_path = output_path / "preview.png"
    processed_series = []
    body_parts = []

    for series_index, (original_series_uid, pairs) in enumerate(sorted(series_groups.items()), start=1):
        first_dataset = pairs[0][1]
        modality = str(getattr(first_dataset, "Modality", "")).upper()
        if modality not in SUPPORTED_MODALITIES:
            raise WorkerError("DICOM_MODALITY_UNSUPPORTED", "DICOM 模态不在当前支持范围")
        body_parts.append(str(getattr(first_dataset, "BodyPartExamined", "")))
        image, pixel_array = render_first_frame(first_dataset, np, Image)
        if series_index == 1:
            image.save(preview_path, "PNG")
        try:
            hits = run_ocr(image, np)
            ocr_hits.extend(hits)
            if hits:
                redact_first_frame(first_dataset, pixel_array, hits, np)
                if series_index == 1:
                    render_first_frame(first_dataset, np, Image)[0].save(preview_path, "PNG")
        except Exception:
            ocr_failed = True

        output_series_dir = output_path / f"series-{series_index:04d}"
        output_series_dir.mkdir(mode=0o700)
        output_files = []
        frame_count = 0
        for instance_index, (_input_path, dataset) in enumerate(pairs, start=1):
            try:
                anonymize_dataset(dataset, delete_private_tags=True, base_rules_gen=initialize_actions_2024b)
                dataset.PatientName = "ANONYMIZED"
                dataset.PatientID = "ANONYMIZED"
                if "PatientBirthDate" in dataset:
                    dataset.PatientBirthDate = "00010101"
                output_file = output_series_dir / f"instance-{instance_index:06d}.dcm"
                dataset.save_as(output_file, enforce_file_format=True)
            except Exception as error:
                raise WorkerError("DEIDENTIFICATION_FAILED", "DICOM 去标识化失败") from error
            output_files.append(str(output_file.resolve()))
            frame_count += int(getattr(dataset, "NumberOfFrames", 1) or 1)
        window = default_window(first_dataset)
        if modality == "CT" and window is None:
            raise WorkerError("DICOM_WINDOW_MISSING", "CT 序列缺少窗宽窗位")
        processed_series.append({
            "modality": modality,
            "series_uid": deterministic_uid(original_series_uid, uid_secret),
            "frame_count": frame_count,
            "default_window": window,
            "dicom_paths": output_files,
        })

    report_path = case_path / "report.txt"
    masked_report_path = None
    mask_map_path = None
    masked_report = None
    mappings = []
    if report_path.exists():
        try:
            raw_report = report_path.read_text(encoding="utf-8-sig")
        except (UnicodeError, OSError) as error:
            raise WorkerError("REPORT_INVALID", "report.txt 必须是 UTF-8 文本") from error
        if len(raw_report) > 2_000_000:
            raise WorkerError("REPORT_SIZE_LIMIT", "报告文本超过限制")
        masked_report, mappings = mask_report(raw_report)
        masked_report_file = output_path / "masked-report.txt"
        masked_report_file.write_text(masked_report, encoding="utf-8")
        masked_report_path = str(masked_report_file.resolve())
        map_file = output_path / "mask-map.json"
        map_file.write_text(json.dumps(mappings, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        mask_map_path = str(map_file.resolve())

    suggested_system, confidence = classify_system(body_parts, masked_report or "")
    return {
        "review": {
            "masked_report": masked_report,
            "masked_count": len(mappings),
            "ocr_hits": ocr_hits,
            "ocr_failed": ocr_failed,
            "suggested_system_code": suggested_system,
            "classification_confidence": confidence,
        },
        "processed": {
            "study_uid": deterministic_uid(next(iter(study_uids)), uid_secret),
            "study_date": study_date_iso,
            "series": processed_series,
            "masked_report_path": masked_report_path,
            "mask_map_path": mask_map_path,
            "preview_path": str(preview_path.resolve()),
        },
    }


def process_manual(request: dict) -> dict:
    """Process one report and key image entirely inside the quarantine tree."""
    report_path = checked_path(request, "report_path")
    image_path = checked_path(request, "image_path")
    output_path = checked_path(request, "output_path")
    if not report_path.is_file() or report_path.stat().st_size > 2 * 1024 * 1024:
        raise WorkerError("REPORT_SIZE_LIMIT", "报告不存在或超过限制")
    if not image_path.is_file() or image_path.stat().st_size > 50 * 1024 * 1024:
        raise WorkerError("IMAGE_SIZE_LIMIT", "关键影像不存在或超过限制")
    if output_path.exists():
        shutil.rmtree(output_path)
    output_path.mkdir(parents=True, mode=0o700)

    try:
        import numpy as np
        from PIL import Image, ImageDraw, UnidentifiedImageError
    except ImportError as error:
        raise WorkerError("DEIDENTIFICATION_WORKER_UNAVAILABLE", "影像脱敏依赖不可用") from error

    try:
        report = report_path.read_text(encoding="utf-8")
    except (UnicodeError, OSError) as error:
        raise WorkerError("REPORT_INVALID", "报告必须是 UTF-8 文本") from error
    if not report.strip():
        raise WorkerError("REPORT_INVALID", "报告不能为空")
    masked, mappings = mask_report(report)

    try:
        with Image.open(image_path) as opened:
            if opened.format not in {"JPEG", "PNG"} or opened.width * opened.height > 50_000_000:
                raise WorkerError("IMAGE_INVALID", "关键影像格式或尺寸无效")
            image = opened.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise WorkerError("IMAGE_INVALID", "关键影像无法安全解码") from error

    try:
        hits = run_ocr(image, np)
    except Exception as error:
        raise WorkerError("IMAGE_OCR_FAILED", "关键影像 OCR 检查失败") from error
    draw = ImageDraw.Draw(image)
    for hit in hits:
        box = hit.get("box")
        if not isinstance(box, list) or len(box) < 3:
            raise WorkerError("IMAGE_OCR_FAILED", "关键影像 OCR 位置无效")
        try:
            points = [(int(point[0]), int(point[1])) for point in box]
        except (TypeError, ValueError, IndexError) as error:
            raise WorkerError("IMAGE_OCR_FAILED", "关键影像 OCR 位置无效") from error
        if any(x < 0 or y < 0 or x >= image.width or y >= image.height for x, y in points) or len(set(points)) < 3:
            raise WorkerError("IMAGE_OCR_FAILED", "关键影像 OCR 位置无效")
        area = abs(sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1] for i in range(len(points))))
        if area == 0:
            raise WorkerError("IMAGE_OCR_FAILED", "关键影像 OCR 位置无效")
        draw.polygon(points, fill=(0, 0, 0))

    masked_report_path = output_path / "masked-report.txt"
    mask_map_path = output_path / "mask-map.json"
    image_output_path = output_path / "key-image.png"
    masked_report_path.write_text(masked, encoding="utf-8")
    mask_map_path.write_text(json.dumps(mappings, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    clean = Image.new("RGB", image.size)
    clean.paste(image)
    clean.save(image_output_path, format="PNG")
    return {
        "masked_report": masked,
        "masked_count": len(mappings),
        "image_redaction_count": len(hits),
        "masked_report_path": str(masked_report_path.resolve()),
        "mask_map_path": str(mask_map_path.resolve()),
        "image_path": str(image_output_path.resolve()),
    }


def process_text(request: dict) -> dict:
    path = checked_path(request, "input_path")
    output = checked_path(request, "output_path")
    if path.stat().st_size > 13 * 1024 * 1024:
        raise WorkerError("REPORT_SIZE_LIMIT", "文本超过限制")
    fields = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(fields, list) or len(fields) > 52 or not all(isinstance(v, str) for v in fields):
        raise WorkerError("REQUEST_INVALID", "文本请求无效")
    safe, mappings = [], []
    for index, field in enumerate(fields):
        masked, hits = mask_report(field) if field.strip() else (field, [])
        safe.append(masked)
        mappings.extend(dict(hit, field_index=index) for hit in hits)
    (output / "mask-map.json").write_text(json.dumps(mappings, ensure_ascii=False), encoding="utf-8")
    return {"fields": safe, "masked_count": len(mappings)}


def attachment_command(args: list[str]) -> bytes:
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=90, check=True,
                                env={**os.environ, "LC_ALL": "C"})
        return result.stdout
    except (OSError, subprocess.SubprocessError) as error:
        raise WorkerError("ATTACHMENT_CONVERSION_FAILED", "附件无法安全转换") from error


def check_office(path: Path, format_name: str) -> None:
    """Reject active content, external relationships and archive bombs before conversion."""
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            names = [i.filename for i in infos]
            required = "word/document.xml" if format_name == "docx" else "xl/workbook.xml"
            if required not in names or "[Content_Types].xml" not in names or len(names) != len(set(names)):
                raise ValueError("invalid package")
            if len(infos) > 5000 or sum(i.file_size for i in infos) > 100 * 1024 * 1024:
                raise ValueError("archive limits")
            for info in infos:
                safe_member_path(info)
                name = info.filename.lower()
                if info.file_size > 20 * 1024 * 1024 or info.file_size > max(1, info.compress_size) * 100:
                    raise ValueError("entry limits")
                if any(v in name for v in ("vbaproject", "activex", "embeddings/", "externallinks/", "connections.xml")):
                    raise ValueError("active content")
                if name.endswith((".xml", ".rels")):
                    data = archive.read(info)
                    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
                        raise ValueError("entities")
                    root = ET.fromstring(data)
                    for element in root.iter():
                        if element.attrib.get("TargetMode", "").lower() == "external":
                            raise ValueError("external reference")
                        local = element.tag.rsplit("}", 1)[-1]
                        if local in {"instrText", "fldSimple", "f", "ddeLink", "oleObject", "altChunk"}:
                            raise ValueError("active field")
    except (OSError, ValueError, ET.ParseError, zipfile.BadZipFile, WorkerError) as error:
        raise WorkerError("ATTACHMENT_INVALID", "Office 附件包含不支持或不安全的内容") from error


def check_attachment_text(text: str) -> None:
    if len(text.encode("utf-8")) > 2 * 1024 * 1024:
        raise WorkerError("ATTACHMENT_INVALID", "附件文字量超过限制")
    _, hits = mask_report(text) if text.strip() else (text, [])
    if hits or any(suspicious_ocr_text(line) for line in text.splitlines() if line.strip()):
        raise WorkerError("ATTACHMENT_IDENTIFIERS_FOUND", "附件含疑似身份标识，请提交已去标识化版本")


def process_attachment(request: dict) -> dict:
    path = checked_path(request, "input_path")
    output = checked_path(request, "output_path")
    format_name = request.get("format")
    if format_name not in {"jpg", "png", "pdf", "docx", "xlsx"} or not path.is_file() or not 0 < path.stat().st_size <= 50 * 1024 * 1024:
        raise WorkerError("ATTACHMENT_INVALID", "附件格式或大小无效")
    from PIL import Image
    import numpy as np
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    pages = []
    if format_name in {"jpg", "png"}:
        with Image.open(path) as image:
            if image.format != {"jpg": "JPEG", "png": "PNG"}[format_name] or getattr(image, "n_frames", 1) != 1 or image.width * image.height > 50_000_000:
                raise WorkerError("ATTACHMENT_INVALID", "附件影像格式或尺寸无效")
            pages = [path]
    else:
        pdf = path
        if format_name in {"docx", "xlsx"}:
            check_office(path, format_name)
            profile = output / "office-profile"
            profile.mkdir(mode=0o700)
            # A fresh, quarantine-local profile disables macros and link updates.
            (profile / "user").mkdir()
            (profile / "user" / "registrymodifications.xcu").write_text(
                '<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>', encoding="utf-8")
            attachment_command(["soffice", "-env:UserInstallation=" + profile.as_uri(), "--headless", "--norestore", "--convert-to", "pdf", "--outdir", str(output), str(path)])
            pdf = output / (path.stem + ".pdf")
        with pdf.open("rb") as handle:
            if not handle.read(8).startswith(b"%PDF-"):
                raise WorkerError("ATTACHMENT_INVALID", "PDF 格式无效")
        info = attachment_command(["pdfinfo", str(pdf)]).decode("utf-8", errors="replace")
        count = re.search(r"^Pages:\s+(\d+)", info, re.M)
        if not count or not 1 <= int(count.group(1)) <= 100 or re.search(r"^Encrypted:\s+yes", info, re.M):
            raise WorkerError("ATTACHMENT_INVALID", "附件加密或页数超过限制")
        for page in range(1, int(count.group(1)) + 1):
            text = attachment_command(["pdftotext", "-f", str(page), "-l", str(page), str(pdf), "-"]).decode("utf-8", errors="strict")
            check_attachment_text(text)
            prefix = output / f"render-{page}"
            attachment_command(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-scale-to", "2400", "-png", str(pdf), str(prefix)])
            pages.append(prefix.with_suffix(".png"))
    total = 0
    for index, page in enumerate(pages, 1):
        with Image.open(page) as opened:
            if opened.width * opened.height > 50_000_000:
                raise WorkerError("ATTACHMENT_INVALID", "附件图像超过限制")
            image = opened.convert("RGB")
        try:
            hits = run_ocr(image, np)
        except Exception as error:
            raise WorkerError("ATTACHMENT_OCR_FAILED", "附件 OCR 检查失败") from error
        if hits:
            raise WorkerError("ATTACHMENT_IDENTIFIERS_FOUND", "附件含疑似身份标识，请提交已去标识化版本")
        # Rebuild pixel-only images so neither EXIF nor PNG text chunks survive.
        clean = Image.new("RGB", image.size)
        clean.paste(image)
        target = output / f"page-{index}.png"
        clean.save(target, format="PNG")
        total += target.stat().st_size
        if total > 200 * 1024 * 1024:
            raise WorkerError("ATTACHMENT_INVALID", "附件预览超过限制")
    return {"page_count": len(pages)}


def run_ocr(image, np_module) -> list[dict]:
    try:
        from paddleocr import PaddleOCR
    except ImportError as error:
        raise RuntimeError("PaddleOCR unavailable") from error
    # PP-OCRv4 Chinese recognition can SIGILL on Linux CPUs supported by Paddle 2.6.2.
    ocr = PaddleOCR(use_angle_cls=False, lang="ch", ocr_version="PP-OCRv3", show_log=False)
    result = ocr.ocr(np_module.asarray(image), cls=False)
    lines = result[0] if result and isinstance(result[0], list) else []
    hits = []
    for line in lines:
        if not isinstance(line, (list, tuple)) or len(line) < 2:
            continue
        box, recognition = line[0], line[1]
        if not isinstance(recognition, (list, tuple)) or len(recognition) < 2:
            continue
        text, confidence = str(recognition[0]), float(recognition[1])
        if confidence >= 0.80 and suspicious_ocr_text(text):
            hits.append({"text": text[:80], "confidence": confidence, "box": [[int(x), int(y)] for x, y in box]})
    return hits


def suspicious_ocr_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", text)
    return bool(
        re.search(r"(?:患者|姓名|病人|Patient|Name|ID|住院号|门诊号)[：:#]?[^，。]{1,20}", compact, re.I)
        or re.fullmatch(r"[\u4e00-\u9fff]{2,4}(?:先生|女士)?", compact)
    )


def mask_report(text: str) -> tuple[str, list[dict]]:
    try:
        from paddlenlp import Taskflow
    except ImportError as error:
        raise WorkerError("REPORT_DEIDENTIFICATION_FAILED", "PaddleNLP UIE 不可用") from error
    try:
        extractor = Taskflow("information_extraction", schema=["人名"], model="uie-mini")
        result = extractor(text)
    except Exception as error:
        raise WorkerError("REPORT_DEIDENTIFICATION_FAILED", "报告 NER 执行失败") from error
    spans = set()
    try:
        for entity in (result[0].get("人名", []) if result else []):
            start, end = int(entity["start"]), int(entity["end"])
            if 0 <= start < end <= len(text):
                spans.add((start, end))
    except (KeyError, TypeError, ValueError, IndexError) as error:
        raise WorkerError("REPORT_DEIDENTIFICATION_FAILED", "报告 NER 输出无效") from error
    patterns = [
        re.compile(r"(?:患者|姓名|病人)\s*[：:]\s*([\u4e00-\u9fff]{2,4})"),
        re.compile(r"([\u4e00-\u9fff]{2,4})(?:先生|女士|医生)"),
    ]
    for pattern in patterns:
        for match in pattern.finditer(text):
            spans.add(match.span(1))
    merged = merge_spans(spans)
    mappings = [{"original": text[start:end], "start": start, "end": end, "replacement": "某"} for start, end in merged]
    masked = text
    for start, end in reversed(merged):
        masked = masked[:start] + "某" + masked[end:]
    return masked, mappings


def merge_spans(spans) -> list[tuple[int, int]]:
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def render_first_frame(dataset, np_module, image_class):
    try:
        pixels = dataset.pixel_array
    except Exception as error:
        raise WorkerError("DICOM_PIXEL_UNSUPPORTED", "DICOM 首帧像素无法解码") from error
    frames = int(getattr(dataset, "NumberOfFrames", 1) or 1)
    frame = pixels[0] if frames > 1 else pixels
    if frame.ndim == 3 and frame.shape[-1] in (3, 4):
        array = frame[..., :3].astype(np_module.uint8)
        return image_class.fromarray(array, "RGB"), pixels
    array = frame.astype(np_module.float32)
    slope = float(getattr(dataset, "RescaleSlope", 1) or 1)
    intercept = float(getattr(dataset, "RescaleIntercept", 0) or 0)
    array = array * slope + intercept
    window = default_window(dataset)
    if window:
        low = float(window["center"]) - float(window["width"]) / 2
        high = float(window["center"]) + float(window["width"]) / 2
    else:
        low, high = np_module.percentile(array, [1, 99])
    if high <= low:
        high = low + 1
    normalized = np_module.clip((array - low) / (high - low) * 255, 0, 255).astype(np_module.uint8)
    if str(getattr(dataset, "PhotometricInterpretation", "")) == "MONOCHROME1":
        normalized = 255 - normalized
    return image_class.fromarray(normalized, "L"), pixels


def redact_first_frame(dataset, pixels, hits: list[dict], np_module) -> None:
    try:
        if getattr(dataset.file_meta, "TransferSyntaxUID", None) and dataset.file_meta.TransferSyntaxUID.is_compressed:
            dataset.decompress()
            pixels = dataset.pixel_array
        frames = int(getattr(dataset, "NumberOfFrames", 1) or 1)
        target = pixels[0] if frames > 1 else pixels
        height, width = target.shape[0], target.shape[1]
        for hit in hits:
            xs = [point[0] for point in hit["box"]]
            ys = [point[1] for point in hit["box"]]
            x1, x2 = max(0, min(xs)), min(width, max(xs) + 1)
            y1, y2 = max(0, min(ys)), min(height, max(ys) + 1)
            target[y1:y2, x1:x2] = np_module.min(target)
        dataset.PixelData = pixels.tobytes()
        dataset.BurnedInAnnotation = "NO"
    except Exception as error:
        raise WorkerError("CLEAN_PIXEL_DATA_FAILED", "烧录文字清除失败") from error


def default_window(dataset):
    center = first_number(getattr(dataset, "WindowCenter", None))
    width = first_number(getattr(dataset, "WindowWidth", None))
    if center is None or width is None or width <= 0:
        return None
    return {"center": center, "width": width}


def first_number(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)) or value.__class__.__name__ == "MultiValue":
        value = value[0] if value else None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def deterministic_uid(value: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf8"), value.encode("utf8"), hashlib.sha256).digest()[:16]
    return f"2.25.{int.from_bytes(digest, 'big')}"


def classify_system(body_parts: list[str], report: str):
    haystack = " ".join(body_parts).upper() + " " + report
    rules = [
        ("cns", ["BRAIN", "HEAD", "颅脑", "中枢", "脑"]),
        ("headneck", ["NECK", "THYROID", "头颈", "甲状腺"]),
        ("resp", ["CHEST", "LUNG", "THORAX", "胸", "肺"]),
        ("circ", ["HEART", "CARDIAC", "心脏", "心血管"]),
        ("digest", ["ABDOMEN", "LIVER", "PANCREAS", "腹", "肝", "消化"]),
        ("uro", ["KIDNEY", "URINARY", "肾", "泌尿"]),
        ("repro", ["UTERUS", "OVARY", "PROSTATE", "子宫", "卵巢", "前列腺", "生殖"]),
        ("bone", ["BONE", "SPINE", "骨", "脊柱"]),
    ]
    for code, keywords in rules:
        if any(keyword in haystack for keyword in keywords):
            return code, 0.90
    return None, 0.0


def checked_path(request: dict, key: str) -> Path:
    value = request.get(key)
    if not isinstance(value, str) or not value:
        raise WorkerError("REQUEST_INVALID", "脱敏进程请求无效")
    return Path(value).resolve()


def main() -> None:
    output = sys.stdout
    try:
        request = json.loads(sys.stdin.read(1_000_000))
        if not isinstance(request, dict):
            raise WorkerError("REQUEST_INVALID", "脱敏进程请求无效")
        with contextlib.redirect_stdout(sys.stderr):
            if request.get("operation") == "inspect_zip":
                result = inspect_zip(request)
            elif request.get("operation") == "process_case":
                result = process_case(request)
            elif request.get("operation") == "process_manual":
                result = process_manual(request)
            elif request.get("operation") == "process_text":
                result = process_text(request)
            elif request.get("operation") == "process_attachment":
                result = process_attachment(request)
            else:
                raise WorkerError("REQUEST_INVALID", "未知脱敏进程操作")
        output.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")))
    except WorkerError as error:
        output.write(json.dumps({"ok": False, "error": {"code": error.code, "message": error.message}}, ensure_ascii=False))
    except Exception:
        output.write(json.dumps({"ok": False, "error": {"code": "DEIDENTIFICATION_FAILED", "message": "脱敏处理失败"}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
