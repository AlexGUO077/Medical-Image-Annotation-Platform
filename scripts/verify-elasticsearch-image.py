import json
import sys
import subprocess
import time

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
    paths = docker('exec', cid, 'find', '/usr/share/elasticsearch/modules', '-type', 'f',
                   '-name', 'jackson-databind-2.18.9.jar').splitlines()
    assert len(paths) == 4
    hashes = docker('exec', cid, 'sha256sum', *paths).splitlines()
    assert all(line.split()[0] == 'ead55a0c649b11af6148a0c097323f5438afc5f563e7139681ad8277fff520bf' for line in hashes)

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
    print('PASS: non-root ES startup, all four patched JAR hashes, JSON index/search and SQL query')
finally:
    docker('rm', '-f', cid)
