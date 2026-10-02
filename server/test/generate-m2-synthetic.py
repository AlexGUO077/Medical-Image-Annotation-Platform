"""Ephemeral synthetic DX and 300-slice CT; no clinical source files."""
import json
import sys
from pathlib import Path
import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, CTImageStorage, DigitalXRayImageStorageForPresentation, generate_uid

root = Path(sys.argv[1])
manifest = []
for modality, count, storage in [('DX', 1, DigitalXRayImageStorageForPresentation), ('CT', 300, CTImageStorage)]:
    folder = root / modality
    folder.mkdir()
    study, series = generate_uid(), generate_uid()
    for index in range(count):
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = storage
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        filename = folder / f'{index:03}.dcm'
        ds = FileDataset(str(filename), {}, file_meta=meta, preamble=b'\0' * 128)
        ds.SOPClassUID, ds.SOPInstanceUID = storage, meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
        ds.PatientName, ds.PatientID = 'SYNTHETIC^M2', 'SYNTHETIC-M2'
        ds.StudyDate, ds.Modality, ds.InstanceNumber = '20261002', modality, index + 1
        ds.Rows = ds.Columns = 512
        ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, 'MONOCHROME2'
        ds.BitsAllocated = ds.BitsStored = 16
        ds.HighBit, ds.PixelRepresentation = 15, 0
        ds.PixelSpacing = [0.8, 0.6]
        ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
        ds.ImagePositionPatient = [0, 0, index]
        ds.WindowCenter, ds.WindowWidth = 128, 256
        ds.RescaleIntercept, ds.RescaleSlope = 0, 1
        ds.BurnedInAnnotation = 'NO'
        ds.PixelData = ((np.indices((512, 512)).sum(axis=0) + index) % 256).astype('<u2').tobytes()
        ds.save_as(filename, enforce_file_format=True)
    manifest.append(dict(modality=modality, count=count, study_uid=study, series_uid=series))
(root / 'manifest.json').write_text(json.dumps(manifest))
