import importlib.util
from pathlib import Path
import stat
import tempfile
import types
import unittest
import zipfile
from unittest.mock import patch
import sys


SPEC = importlib.util.spec_from_file_location("deid_worker", Path(__file__).with_name("deid_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class ZipInspectionTests(unittest.TestCase):
    def test_extracts_multiple_case_directories(self):
        with tempfile.TemporaryDirectory() as root:
            archive_path = Path(root) / "batch.zip"
            output_path = Path(root) / "out"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("patient-name-a/one.DCM", b"DICOM-A")
                archive.writestr("patient-name-a/REPORT.TXT", "患者：张三")
                archive.writestr("patient-id-b/two.dcm", b"DICOM-B")
            result = worker.inspect_zip({"zip_path": str(archive_path), "output_path": str(output_path)})
            self.assertEqual([item["display_name"] for item in result["items"]], ["case-0001", "case-0002"])
            self.assertNotIn("patient", str(result["items"]))
            self.assertEqual((output_path / "item-0002" / "report.txt").read_text(), "患者：张三")

    def test_rejects_path_traversal(self):
        self.assert_zip_error({"../outside.dcm": b"DICOM"}, "ZIP_PATH_INVALID")

    def test_rejects_symlink(self):
        info = zipfile.ZipInfo("case-a/link.dcm")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.assert_zip_error({info: b"target"}, "ZIP_SYMLINK")

    def test_rejects_high_compression_ratio(self):
        self.assert_zip_error({"case-a/one.dcm": b"0" * 1024 * 1024}, "ZIP_RATIO_LIMIT")

    def test_rejects_unsupported_files(self):
        self.assert_zip_error({"case-a/one.dcm": b"DICOM", "case-a/script.exe": b"MZ"}, "UNSUPPORTED_FILE")

    def test_deterministic_uid_is_stable_and_valid(self):
        first = worker.deterministic_uid("1.2.3", "x" * 32)
        self.assertEqual(first, worker.deterministic_uid("1.2.3", "x" * 32))
        self.assertTrue(first.startswith("2.25."))
        self.assertLessEqual(len(first), 64)

    def assert_zip_error(self, files, code):
        with tempfile.TemporaryDirectory() as root:
            archive_path = Path(root) / "batch.zip"
            output_path = Path(root) / "out"
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, value in files.items():
                    archive.writestr(name, value)
            with self.assertRaises(worker.WorkerError) as raised:
                worker.inspect_zip({"zip_path": str(archive_path), "output_path": str(output_path)})
            self.assertEqual(raised.exception.code, code)


class ManualProcessingTests(unittest.TestCase):
    def fake_image_modules(self, format_name="JPEG"):
        image_module = types.ModuleType("PIL.Image")
        draw_module = types.ModuleType("PIL.ImageDraw")
        pil_module = types.ModuleType("PIL")
        polygons = []

        class FakeImage:
            format = format_name
            width = 10
            height = 10
            size = (10, 10)

            def paste(self, _image):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def convert(self, _mode):
                return self

            def save(self, path, format):
                assert format == "PNG"
                Path(path).write_bytes(b"safe-png")

        image_module.open = lambda _path: FakeImage()
        image_module.new = lambda _mode, _size: FakeImage()
        image_module.DecompressionBombError = ValueError
        pil_module.Image = image_module
        pil_module.ImageDraw = draw_module
        pil_module.UnidentifiedImageError = OSError
        draw_module.Draw = lambda _image: types.SimpleNamespace(polygon=lambda points, fill: polygons.append((points, fill)))
        modules = {"numpy": types.ModuleType("numpy"), "PIL": pil_module,
                   "PIL.Image": image_module, "PIL.ImageDraw": draw_module}
        return modules, polygons

    def test_manual_processing_masks_report_and_redacts_key_image(self):
        with tempfile.TemporaryDirectory() as root:
            report = Path(root) / "report.txt"
            image = Path(root) / "image.upload"
            output = Path(root) / "processed"
            report.write_text("患者：张三", encoding="utf-8")
            image.write_bytes(b"synthetic-image")
            modules, polygons = self.fake_image_modules()
            hit = {"box": [[1, 1], [3, 1], [3, 3], [1, 3]]}
            with patch.dict(sys.modules, modules), patch.object(worker, "mask_report", return_value=("患者：某", [{"original": "张三"}])), \
                    patch.object(worker, "run_ocr", return_value=[hit]):
                result = worker.process_manual({"report_path": str(report), "image_path": str(image), "output_path": str(output)})
            self.assertEqual(result["masked_report"], "患者：某")
            self.assertEqual(result["masked_count"], 1)
            self.assertEqual(result["image_redaction_count"], 1)
            self.assertEqual((output / "key-image.png").read_bytes(), b"safe-png")
            self.assertEqual(polygons[0][1], (0, 0, 0))

    def test_manual_processing_fails_closed_when_ocr_fails(self):
        with tempfile.TemporaryDirectory() as root:
            report = Path(root) / "report.txt"
            image = Path(root) / "image.upload"
            output = Path(root) / "processed"
            report.write_text("synthetic report", encoding="utf-8")
            image.write_bytes(b"synthetic-image")
            modules, _ = self.fake_image_modules()
            with patch.dict(sys.modules, modules), patch.object(worker, "mask_report", return_value=("synthetic report", [])), \
                    patch.object(worker, "run_ocr", side_effect=RuntimeError("OCR unavailable")):
                with self.assertRaises(worker.WorkerError) as raised:
                    worker.process_manual({"report_path": str(report), "image_path": str(image), "output_path": str(output)})
            self.assertEqual(raised.exception.code, "IMAGE_OCR_FAILED")
            self.assertFalse((output / "key-image.png").exists())



class AttachmentProcessingTests(unittest.TestCase):
    def office(self, root, extra):
        path = Path(root) / 'input.docx'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
            for name, text in extra.items(): archive.writestr(name, text)
        return path

    def test_rejects_external_office_links_macros_and_formula_fields(self):
        for extra in [
            {'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>'},
            {'word/vbaProject.bin': 'macro'},
            {'word/field.xml': '<document><instrText>INCLUDEPICTURE</instrText></document>'},
            {'word/field.xml': '<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///etc/passwd">]><doc>&x;</doc>'},
        ]:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as root:
                with self.assertRaises(worker.WorkerError): worker.check_office(self.office(root, extra), 'docx')

    def test_accepts_inert_office_package_and_rejects_mismatched_format(self):
        with tempfile.TemporaryDirectory() as root:
            path = self.office(root, {})
            worker.check_office(path, 'docx')
            with self.assertRaises(worker.WorkerError): worker.check_office(path, 'xlsx')

    def test_text_layer_rejects_identity_and_ner_failure(self):
        with patch.object(worker, 'mask_report', return_value=('某', [{'original': 'synthetic'}])):
            with self.assertRaises(worker.WorkerError): worker.check_attachment_text('synthetic')
        with patch.object(worker, 'mask_report', side_effect=worker.WorkerError('NER_FAILED', 'failed')):
            with self.assertRaises(worker.WorkerError): worker.check_attachment_text('synthetic')

    def test_text_fields_mask_independently_and_keep_mapping_out_of_response(self):
        import json
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'input.json'
            path.write_text(json.dumps(['name', 'age 45']), encoding='utf-8')
            with patch.object(worker, 'mask_report', side_effect=[('某', [{'original': 'name'}]), ('age 45', [])]):
                result = worker.process_text({'input_path': str(path), 'output_path': root})
            self.assertEqual(result, {'fields': ['某', 'age 45'], 'masked_count': 1})
            self.assertIn('name', (Path(root) / 'mask-map.json').read_text())

    def test_manual_invalid_polygon_fails_without_producing_safe_image(self):
        helper = ManualProcessingTests()
        for box in [[[1, 1], [2, 2], [3, 3]], [[-1, 0], [3, 0], [3, 3]], [[11, 1], [15, 1], [15, 5]]]:
            with self.subTest(box=box), tempfile.TemporaryDirectory() as root:
                report, image, output = Path(root)/'report.txt', Path(root)/'image.png', Path(root)/'out'
                report.write_text('synthetic'); image.write_bytes(b'image')
                modules, _ = helper.fake_image_modules()
                with patch.dict(sys.modules, modules), patch.object(worker, 'mask_report', return_value=('safe', [])), patch.object(worker, 'run_ocr', return_value=[{'box': box}]):
                    with self.assertRaises(worker.WorkerError): worker.process_manual({'report_path': str(report), 'image_path': str(image), 'output_path': str(output)})
                self.assertFalse((output/'key-image.png').exists())

if __name__ == "__main__":
    unittest.main()
