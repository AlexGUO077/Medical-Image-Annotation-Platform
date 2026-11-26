import base64
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
    lz4_paths = docker('exec', cid, 'find', '/usr/share/elasticsearch', '-type', 'f', '-name', 'lz4-java-*.jar').splitlines()
    assert lz4_paths == ['/usr/share/elasticsearch/lib/lz4-java-1.11.4.jar']
    assert docker('exec', cid, 'sha256sum', *lz4_paths).split()[0] == '58c8e0b813960d2a248e050c353baea73139b48a2ffc55382d42c69707e17325'
    jsoup_paths = docker('exec', cid, 'find', '/usr/share/elasticsearch', '-type', 'f', '-name', 'jsoup-*.jar').splitlines()
    assert jsoup_paths == ['/usr/share/elasticsearch/modules/ingest-attachment/jsoup-1.23.2.jar']
    assert docker('exec', cid, 'sha256sum', *jsoup_paths).split()[0] == 'e9d8c856856680427f096d156f02a414289985c930998fcb519ce5be39b42003'
    for pattern, count, expected_hash in (
        ('jackson-core-2.21.8.jar', 9, '604ef7765013daf5cde192e40bc4c8412c4ca93f4aaf7bf8e9a62fad1e1026bb'),
        ('jackson-databind-2.21.8.jar', 4, 'ad77f2285717e2f34c319d988b7c85783a47d0b33f33a501d1fcbf196e61bbaa'),
        ('guava-*.jar', 5, 'b530942257fb935f8b2cfaa5f8eb5bd59c555fd8e8d01b8ce98912e077ea606c'),
        ('failureaccess-*.jar', 5, 'cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb'),
    ):
        paths = docker('exec', cid, 'find', '/usr/share/elasticsearch/modules', '-type', 'f',
                       '-name', pattern).splitlines()
        assert len(paths) == count
        hashes = docker('exec', cid, 'sha256sum', *paths).splitlines()
        assert all(line.split()[0] == expected_hash for line in hashes)

    with tempfile.TemporaryDirectory(prefix='miap-jackson-check-') as directory:
        def archive(path, name):
            destination = str(Path(directory) / name)
            docker('cp', f'{cid}:{path}', destination)
            return ZipFile(destination)
        with archive(lz4_paths[0], 'lz4.jar') as lz4:
            assert b'version=1.11.4' in lz4.read('META-INF/maven/at.yawk.lz4/lz4-java/pom.properties')
            assert b'Automatic-Module-Name: org.lz4.java' in lz4.read('META-INF/MANIFEST.MF')
        # Exercise the patched classes with the image's JVM and selected native/Java
        # implementation, as well as the safe Java fallback, before checking ES.
        source = Path(directory) / 'DependencySmoke.java'
        source.write_text('''
import java.util.Arrays;
import java.util.Random;
import com.google.common.util.concurrent.SettableFuture;
import net.jpountz.lz4.LZ4Factory;
class DependencySmoke {
    public static void main(String[] args) throws Exception {
        SettableFuture<String> future = SettableFuture.create();
        if (!future.set("synthetic") || !"synthetic".equals(future.get())) {
            throw new AssertionError("Guava future failed");
        }
        for (LZ4Factory factory : new LZ4Factory[] {
                LZ4Factory.fastestInstance(), LZ4Factory.safeInstance() }) {
            for (int length : new int[] {0, 1, 256, 65536}) {
                byte[] data = new byte[length];
                new Random(42).nextBytes(data);
                for (boolean repeated : new boolean[] {false, true}) {
                    if (repeated) Arrays.fill(data, (byte) 7);
                    byte[] compressed = factory.fastCompressor().compress(data);
                    byte[] restored = new byte[length];
                    int size = factory.safeDecompressor().decompress(
                        compressed, 0, compressed.length, restored, 0, length);
                    if (size != length || !Arrays.equals(data, restored)) {
                        throw new AssertionError("LZ4 round-trip failed");
                    }
                }
            }
        }
    }
}
''')
        inference = '/usr/share/elasticsearch/modules/x-pack-inference'
        classpath = ':'.join([lz4_paths[0], f'{inference}/guava-32.0.1-jre.jar', f'{inference}/failureaccess-1.0.3.jar'])
        docker('cp', str(source), f'{cid}:/tmp/DependencySmoke.java')
        docker('exec', cid, '/usr/share/elasticsearch/jdk/bin/java', '-cp', classpath, '/tmp/DependencySmoke.java')
        with archive(jsoup_paths[0], 'jsoup.jar') as jsoup:
            assert b'version=1.23.2' in jsoup.read('META-INF/maven/org.jsoup/jsoup/pom.properties')
        with archive('/usr/share/elasticsearch/modules/x-pack-sql/jackson-core-2.21.8.jar', 'core.jar') as core:
            expected = {n: core.read(n) for n in core.namelist() if not n.endswith('/')}
        for i, path in enumerate((
            '/usr/share/elasticsearch/lib/elasticsearch-x-content-8.19.26.jar',
            '/usr/share/elasticsearch/lib/tools/plugin-cli/elasticsearch-x-content-8.19.26.jar',
        )):
            prefix = 'IMPL-JARS/x-content/jackson-core-2.21.8.jar/'
            with archive(path, f'content-{i}.jar') as nested:
                actual = {n[len(prefix):]: nested.read(n) for n in nested.namelist() if n.startswith(prefix) and not n.endswith('/')}
            assert actual == expected
        def core_entry(name):
            return (name.startswith('com/fasterxml/jackson/core/')
                    or name.startswith('META-INF/maven/com.fasterxml.jackson.core/jackson-core/')
                    or (name.startswith('META-INF/versions/') and '/com/fasterxml/jackson/core/' in name))
        with archive('/usr/share/elasticsearch/bin/elasticsearch-sql-cli-8.19.26.jar', 'sql.jar') as sql_jar:
            actual = {n: sql_jar.read(n) for n in sql_jar.namelist() if core_entry(n) and not n.endswith('/')}
        assert actual == {n: data for n, data in expected.items() if core_entry(n)}
    docker('exec', cid, '/usr/share/elasticsearch/bin/elasticsearch-sql-cli', '--help')

    def request(route, payload=None, method='GET', timeout=35):
        args = ['exec', cid, 'curl', '--silent', '--show-error', '--fail', '--max-time', str(timeout),
                '-X', method, '-H', 'Content-Type: application/json', 'http://127.0.0.1:9200' + route]
        if payload is not None:
            args += ['--data-binary', json.dumps(payload)]
        return json.loads(docker(*args))

    deadline = time.monotonic() + 150
    while True:
        try:
            health = request('/_cluster/health?wait_for_status=yellow&timeout=2s', timeout=5)
            if not health['timed_out'] and health['status'] in ('yellow', 'green'):
                break
        except subprocess.CalledProcessError:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('Isolated Elasticsearch did not become ready')
        time.sleep(2)
    info = request('/')
    assert info['version']['number'] == '8.19.26'
    request('/synthetic-smoke', {'mappings': {'properties': {'label': {'type': 'keyword'}, 'value': {'type': 'integer'}}}}, 'PUT')
    # Flush and read a compressible stored source, exercising the Lucene/ES path.
    document = {'label': 'SYNTHETIC', 'value': 7, 'text': 'synthetic compression smoke ' * 2048}
    request('/synthetic-smoke/_doc/1?refresh=true', document, 'PUT')
    request('/synthetic-smoke/_flush', method='POST')
    assert request('/synthetic-smoke/_doc/1')['_source'] == document
    result = request('/synthetic-smoke/_search', {'query': {'term': {'label': 'SYNTHETIC'}}}, 'POST')
    assert result['hits']['total']['value'] == 1
    sql = request('/_sql?format=json', {'query': 'SELECT value FROM "synthetic-smoke"'}, 'POST')
    assert sql['rows'] == [[7]]
    html = base64.b64encode(b'<html><head><title>Synthetic attachment</title></head><body>MIAP synthetic smoke</body></html>').decode()
    attachment = request('/_ingest/pipeline/_simulate', {
        'pipeline': {'processors': [{'attachment': {'field': 'data', 'remove_binary': True}}]},
        'docs': [{'_source': {'data': html}}],
    }, 'POST')['docs'][0]['doc']['_source']
    assert 'MIAP synthetic smoke' in attachment['attachment']['content']
    assert attachment['attachment']['title'] == 'Synthetic attachment'
    assert 'data' not in attachment
    print('PASS: non-root ES startup, Guava, failureaccess, LZ4, Jackson and jsoup payloads, LZ4 round-trip, flushed source readback, JSON index/search, SQL and HTML attachment extraction')
finally:
    docker('rm', '-f', cid)
