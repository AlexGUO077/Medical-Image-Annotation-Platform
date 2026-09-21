import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile


SPEC = importlib.util.spec_from_file_location("deid_worker", Path(__file__).with_name("deid_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class ZipInspectionTests(unittest.TestCase):
    def test_extracts_multiple_case_directories(self):
        with tempfile.TemporaryDirectory() as root:
            archive_path = Path(root) / "batch.zip"
            output_path = Path(root) / "out"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("case-a/one.DCM", b"DICOM-A")
                archive.writestr("case-a/REPORT.TXT", "患者：张三")
                archive.writestr("case-b/two.dcm", b"DICOM-B")
            result = worker.inspect_zip({"zip_path": str(archive_path), "output_path": str(output_path)})
            self.assertEqual([item["display_name"] for item in result["items"]], ["case-a", "case-b"])
            self.assertEqual((output_path / "item-0001" / "report.txt").read_text(), "患者：张三")

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


if __name__ == "__main__":
    unittest.main()
