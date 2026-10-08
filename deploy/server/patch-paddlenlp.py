"""D-44: keep optional package installation out of the inference import path.

No dependency constraint is overridden. PaddleNLP does not declare pip as a
runtime requirement, and our OCR/NER dependencies are installed at image build.
Calling its optional installer still imports pip before any package mutation.
"""
import hashlib
from importlib.metadata import distribution

package = distribution('paddlenlp')
assert package.version == '2.8.1', 'Re-review patch for a different PaddleNLP release'
path = package.locate_file('paddlenlp/utils/import_utils.py')
original = path.read_bytes()
assert hashlib.sha256(original).hexdigest() == '96b102847914ffa2cead556dacc623611875edb30bae41ae90e6c785f0cd39b3', 'Unexpected PaddleNLP source'
source = original.decode()
assert source.count('\nimport pip\n') == 1
source = source.replace('\nimport pip\n', '\n', 1)
before = '    module_name = module_name or package_name\n'
assert source.count(before) == 2
source = source.replace(before, '    import pip  # Optional installer only; inference does not need pip.\n\n' + before, 1)
compile(source, str(path), 'exec')
path.write_text(source)
