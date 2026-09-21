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
            for index, (display_name, entries) in enumerate(sorted(grouped.items()), start=1):
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
                items.append({"display_name": display_name[:120], "path": str(item_path.resolve())})
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


def run_ocr(image, np_module) -> list[dict]:
    try:
        from paddleocr import PaddleOCR
    except ImportError as error:
        raise RuntimeError("PaddleOCR unavailable") from error
    ocr = PaddleOCR(use_angle_cls=False, lang="ch", show_log=False)
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
            else:
                raise WorkerError("REQUEST_INVALID", "未知脱敏进程操作")
        output.write(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")))
    except WorkerError as error:
        output.write(json.dumps({"ok": False, "error": {"code": error.code, "message": error.message}}, ensure_ascii=False))
    except Exception:
        output.write(json.dumps({"ok": False, "error": {"code": "DEIDENTIFICATION_FAILED", "message": "脱敏处理失败"}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
