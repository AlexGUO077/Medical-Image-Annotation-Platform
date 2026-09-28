# Optional local conversion smoke; requires Pillow, NumPy, LibreOffice and Poppler.
import importlib.util, tempfile, zipfile, struct
from pathlib import Path
from unittest.mock import patch
from PIL import Image
spec=importlib.util.spec_from_file_location('worker', Path(__file__).with_name('deid_worker.py'))
w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
def pdf(path):
    stream=b'BT /F1 16 Tf 30 100 Td (SYNTHETIC TEST DOCUMENT) Tj ET'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    data=b'%PDF-1.4\n'; offsets=[0]
    for i,obj in enumerate(objects,1): offsets.append(len(data)); data+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    start=len(data); data+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{v:010d} 00000 n \n'.encode() for v in offsets[1:])+f'trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n{start}\n%%EOF'.encode();path.write_bytes(data)
def office(path, format):
    main='word/document.xml' if format=='docx' else 'xl/workbook.xml'
    content='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml' if format=='docx' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('[Content_Types].xml',f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/{main}" ContentType="{content}"/>'+('<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' if format=='xlsx' else '')+'</Types>')
        z.writestr('_rels/.rels',f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{main}"/></Relationships>')
        if format=='docx': z.writestr(main,'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC TEST DOCUMENT</w:t></w:r></w:p></w:body></w:document>')
        else:
            z.writestr(main,'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>')
            z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
            z.writestr('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SYNTHETIC TEST DOCUMENT</t></is></c></row></sheetData></worksheet>')
with tempfile.TemporaryDirectory(prefix='wp05-formats-') as root:
    root=Path(root)
    for fmt in ['jpg','png','pdf','docx','xlsx']:
        src=root/f'input.{fmt}'
        if fmt in ['jpg','png']: Image.new('RGB',(640,400),'white').save(src,icc_profile=b'SYNTHETIC_PRIVATE_ICC',exif=b'Exif\0\0SYNTHETIC_PRIVATE_EXIF')
        elif fmt=='pdf': pdf(src)
        else: office(src,fmt)
        with patch.object(w,'mask_report',return_value=('safe',[])), patch.object(w,'run_ocr',return_value=[]):
            result=w.process_attachment({'input_path':str(src),'output_path':str(root/f'out-{fmt}'),'format':fmt})
        assert result['page_count']==1
        out=root/f'out-{fmt}'/'page-1.png'
        with Image.open(out) as img: assert not img.info.get('icc_profile') and not img.info.get('exif')
        assert b'SYNTHETIC_PRIVATE' not in out.read_bytes()
        print('PASS real decode/conversion/metadata stripping:',fmt)
    for fmt in ['jpg','png']:
        report=root/'report.txt'; report.write_text('synthetic report')
        with patch.object(w,'mask_report',return_value=('safe',[])), patch.object(w,'run_ocr',return_value=[]):
            w.process_manual({'report_path':str(report),'image_path':str(root/f'input.{fmt}'),'output_path':str(root/f'manual-{fmt}')})
        assert b'SYNTHETIC_PRIVATE' not in (root/f'manual-{fmt}'/'key-image.png').read_bytes()
        print('PASS manual metadata stripping:',fmt)
print('Conversion smoke uses real Pillow/LibreOffice/Poppler; OCR and NER mocked separately.')
