import json
import sys
import subprocess
import time
import tempfile
from pathlib import Path
from zipfile import ZipFile

image = sys.argv[1]
platform = sys.argv[2]

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.PIPE)

# Isolated disposable container: no network, published ports, credentials or shared volumes.
cid = docker('run', '-d', '--network', 'none', '--hostname', 'miap-es-smoke', '--add-host', 'miap-es-smoke:127.0.0.1', '--platform', platform,
             '-e', 'discovery.type=single-node', '-e', 'xpack.security.enabled=false',
             '-e', 'ES_JAVA_OPTS=-Xms512m -Xmx512m', image).strip()
try:
    assert docker('inspect', '--format', '{{.Config.User}}', cid).strip() == '1000:0'
    for artifact, count, expected_hash in (
        ('core', 9, '825fa72dfb9e2f8a642322f1390dbac22c30d15ebd6dc6b3772158821ee124eb'),
        ('databind', 4, '075ad94a76c3edf83e1972dc26f476361eb6b9d0e260d93fc11105509bc79cab'),
    ):
        paths = docker('exec', cid, 'find', '/usr/share/elasticsearch/modules', '-type', 'f',
                       '-name', f'jackson-{artifact}-2.18.9.jar').splitlines()
        assert len(paths) == count
        hashes = docker('exec', cid, 'sha256sum', *paths).splitlines()
        assert all(line.split()[0] == expected_hash for line in hashes)

    with tempfile.TemporaryDirectory(prefix='miap-jackson-check-') as directory:
        def archive(path, name):
            destination = str(Path(directory) / name)
            docker('cp', f'{cid}:{path}', destination)
            return ZipFile(destination)
        with archive('/usr/share/elasticsearch/modules/x-pack-sql/jackson-core-2.18.9.jar', 'core.jar') as core:
            expected = {n: core.read(n) for n in core.namelist() if not n.endswith('/')}
        for i, path in enumerate((
            '/usr/share/elasticsearch/lib/elasticsearch-x-content-8.19.21.jar',
            '/usr/share/elasticsearch/lib/tools/plugin-cli/elasticsearch-x-content-8.19.21.jar',
        )):
            prefix = 'IMPL-JARS/x-content/jackson-core-2.18.9.jar/'
            with archive(path, f'content-{i}.jar') as nested:
                actual = {n[len(prefix):]: nested.read(n) for n in nested.namelist() if n.startswith(prefix) and not n.endswith('/')}
            assert actual == expected
        def core_entry(name):
            return (name.startswith('com/fasterxml/jackson/core/')
                    or name.startswith('META-INF/maven/com.fasterxml.jackson.core/jackson-core/')
                    or (name.startswith('META-INF/versions/') and '/com/fasterxml/jackson/core/' in name))
        with archive('/usr/share/elasticsearch/bin/elasticsearch-sql-cli-8.19.21.jar', 'sql.jar') as sql_jar:
            actual = {n: sql_jar.read(n) for n in sql_jar.namelist() if core_entry(n) and not n.endswith('/')}
        assert actual == {n: data for n, data in expected.items() if core_entry(n)}
    docker('exec', cid, '/usr/share/elasticsearch/bin/elasticsearch-sql-cli', '--help')

    def request(route, payload=None, method='GET'):
        args = ['exec', cid, 'curl', '--silent', '--show-error', '--fail', '--max-time', '5',
                '-X', method, '-H', 'Content-Type: application/json', 'http://127.0.0.1:9200' + route]
        if payload is not None:
            args += ['--data-binary', json.dumps(payload)]
        return json.loads(docker(*args))

    deadline = time.monotonic() + 150
    while True:
        try:
            info = request('/')
            break
        except subprocess.CalledProcessError:
            if time.monotonic() >= deadline:
                raise RuntimeError('Isolated Elasticsearch did not become ready')
            time.sleep(2)
    assert info['version']['number'] == '8.19.21'
    request('/synthetic-smoke', {'mappings': {'properties': {'label': {'type': 'keyword'}, 'value': {'type': 'integer'}}}}, 'PUT')
    request('/synthetic-smoke/_doc/1?refresh=true', {'label': 'SYNTHETIC', 'value': 7}, 'PUT')
    result = request('/synthetic-smoke/_search', {'query': {'term': {'label': 'SYNTHETIC'}}}, 'POST')
    assert result['hits']['total']['value'] == 1
    sql = request('/_sql?format=json', {'query': 'SELECT value FROM "synthetic-smoke"'}, 'POST')
    assert sql['rows'] == [[7]]
    print('PASS: non-root ES startup, 13 patched JAR hashes and 3 embedded Core payloads, JSON index/search and SQL query')
finally:
    docker('rm', '-f', cid)
