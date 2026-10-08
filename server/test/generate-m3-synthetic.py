"""Small DX/CT import fixtures for the business chain, not the 300-frame benchmark."""
from pathlib import Path
import sys
import zipfile

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, DigitalXRayImageStorageForPresentation, ExplicitVRLittleEndian, generate_uid

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
for modality, count, storage in [('DX', 1, DigitalXRayImageStorageForPresentation), ('CT', 3, CTImageStorage)]:
    study, series = generate_uid(), generate_uid()
    with zipfile.ZipFile(root / (modality + '.zip'), 'w', compression=zipfile.ZIP_STORED) as archive:
        for index in range(count):
            meta = FileMetaDataset()
            meta.MediaStorageSOPClassUID = storage
            meta.MediaStorageSOPInstanceUID = generate_uid()
            meta.TransferSyntaxUID = ExplicitVRLittleEndian
            filename = root / (modality + str(index) + '.dcm')
            ds = FileDataset(str(filename), {}, file_meta=meta, preamble=b'\0' * 128)
            ds.SOPClassUID, ds.SOPInstanceUID = storage, meta.MediaStorageSOPInstanceUID
            ds.StudyInstanceUID, ds.SeriesInstanceUID = study, series
            ds.PatientName, ds.PatientID = 'SYNTHETIC^M3', 'SYNTHETIC-M3'
            ds.StudyDate, ds.Modality, ds.InstanceNumber = '20261008', modality, index + 1
            ds.Rows = ds.Columns = 512
            ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, 'MONOCHROME2'
            ds.BitsAllocated = ds.BitsStored = 16
            ds.HighBit, ds.PixelRepresentation = 15, 0
            ds.PixelSpacing = [0.8, 0.6]
            ds.ImageOrientationPatient, ds.ImagePositionPatient = [1, 0, 0, 0, 1, 0], [0, 0, index]
            ds.WindowCenter, ds.WindowWidth = 128, 256
            ds.RescaleIntercept, ds.RescaleSlope = 0, 1
            ds.BurnedInAnnotation = 'NO'
            ds.PixelData = ((np.indices((512, 512)).sum(axis=0) + index) % 256).astype('<u2').tobytes()
            ds.save_as(filename, enforce_file_format=True)
            archive.write(filename, filename.name)
            filename.unlink()
        archive.writestr('report.txt', '患者：张三。肺内结节。仅用于合成闭环验证。')
