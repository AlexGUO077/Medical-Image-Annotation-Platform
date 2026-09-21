"""Synthetic DICOM integration check; run inside the Python 3.11 worker environment."""

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage, generate_uid


SPEC = importlib.util.spec_from_file_location("deid_worker", Path(__file__).with_name("deid_worker.py"))
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class SyntheticDicomIntegrationTest(unittest.TestCase):
    def test_deidentifies_tags_private_data_and_uids_while_retaining_viewing_fields(self):
        with tempfile.TemporaryDirectory() as root:
            case_path = Path(root) / "case"
            output_path = Path(root) / "processed"
            case_path.mkdir()
            original_study_uid = generate_uid()
            original_series_uid = generate_uid()
            self.write_dicom(case_path / "image.dcm", original_study_uid, original_series_uid)
            os.environ["DICOM_UID_SECRET"] = "synthetic-worker-secret-value-32-bytes"
            original_ocr = worker.run_ocr
            worker.run_ocr = lambda _image, _numpy: []
            try:
                result = worker.process_case({"case_path": str(case_path), "output_path": str(output_path)})
            finally:
                worker.run_ocr = original_ocr

            output_file = Path(result["processed"]["series"][0]["dicom_paths"][0])
            dataset = pydicom.dcmread(output_file)
            self.assertNotEqual(str(dataset.PatientName), "Synthetic Patient")
            self.assertNotEqual(str(dataset.PatientID), "SYN-001")
            self.assertNotEqual(str(dataset.PatientBirthDate), "19900101")
            self.assertEqual(float(dataset.WindowCenter), 40.0)
            self.assertEqual(float(dataset.WindowWidth), 400.0)
            self.assertEqual(str(dataset.PixelSpacing), "[0.7, 0.7]")
            self.assertFalse(any(element.tag.is_private for element in dataset.iterall()))
            self.assertNotEqual(result["processed"]["study_uid"], original_study_uid)
            self.assertNotEqual(result["processed"]["series"][0]["series_uid"], original_series_uid)
            self.assertTrue(Path(result["processed"]["preview_path"]).is_file())

    def write_dicom(self, path, study_uid, series_uid):
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = SecondaryCaptureImageStorage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        dataset = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
        dataset.is_little_endian = True
        dataset.is_implicit_VR = False
        dataset.SOPClassUID = SecondaryCaptureImageStorage
        dataset.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        dataset.StudyInstanceUID = study_uid
        dataset.SeriesInstanceUID = series_uid
        dataset.PatientName = "Synthetic Patient"
        dataset.PatientID = "SYN-001"
        dataset.PatientBirthDate = "19900101"
        dataset.StudyDate = "20260921"
        dataset.Modality = "CT"
        dataset.BodyPartExamined = "CHEST"
        dataset.Rows = 16
        dataset.Columns = 16
        dataset.SamplesPerPixel = 1
        dataset.PhotometricInterpretation = "MONOCHROME2"
        dataset.PixelRepresentation = 0
        dataset.BitsAllocated = 16
        dataset.BitsStored = 12
        dataset.HighBit = 11
        dataset.RescaleSlope = 1
        dataset.RescaleIntercept = -1024
        dataset.WindowCenter = 40
        dataset.WindowWidth = 400
        dataset.PixelSpacing = [0.7, 0.7]
        dataset.PixelData = np.arange(256, dtype=np.uint16).reshape(16, 16).tobytes()
        dataset.add_new((0x0011, 0x0010), "LO", "SYNTHETIC_PRIVATE_CREATOR")
        dataset.add_new((0x0011, 0x1001), "LO", "Synthetic private identifier")
        dataset.save_as(path, enforce_file_format=True)


if __name__ == "__main__":
    unittest.main()
