// Local synthetic bootstrap only. The runtime never receives the elastic administrator password.
import '../../config/environment';
import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { requiredEnv } from '../../config/environment';
async function main(){
 if(!requiredEnv('POSTGRES_DB').includes('synthetic')||!['127.0.0.1','localhost'].includes(requiredEnv('ELASTICSEARCH_HOST')))throw Error('Requires local synthetic environment');
 const file=process.env.MIAP_ENV_FILE??resolve(process.cwd(),'../.env.local');
 await readFile(file,'utf8');
 const username=process.env.SEARCH_ELASTIC_USERNAME??'miap_search';
 if(!/^[a-zA-Z0-9_-]+$/.test(username)||username==='elastic')throw Error('Invalid service account');
 const password=process.env.SEARCH_ELASTIC_PASSWORD??randomBytes(32).toString('base64url');
 const headers={Authorization:`Basic ${Buffer.from(`elastic:${requiredEnv('ELASTIC_PASSWORD')}`).toString('base64')}`,'Content-Type':'application/json'};
 for(const [path,body] of [
  ['role/miap_published',{cluster:[],indices:[{names:['miap-published-*'],privileges:['create_index','view_index_metadata','read','write']}]}],
  [`user/${username}`,{password,roles:['miap_published']}],
 ] as const){
  const response=await fetch(`http://${requiredEnv('ELASTICSEARCH_HOST')}:${requiredEnv('ELASTICSEARCH_PORT')}/_security/${path}`,{method:'PUT',headers,redirect:'error',signal:AbortSignal.timeout(10_000),body:JSON.stringify(body)});
  if(!response.ok)throw Error('Service account provisioning failed');
 }
 const additions=[];
 if(!process.env.SEARCH_ELASTIC_USERNAME)additions.push(`SEARCH_ELASTIC_USERNAME=${username}`);
 if(!process.env.SEARCH_ELASTIC_PASSWORD)additions.push(`SEARCH_ELASTIC_PASSWORD=${password}`);
 if(!process.env.SEARCH_ELASTIC_INDEX)additions.push('SEARCH_ELASTIC_INDEX=miap-published-v1');
 if(additions.length)await appendFile(file,`\n${additions.join('\n')}\n`,{mode:0o600});
 console.log('Local synthetic search service account provisioned; credentials remain in the ignored environment file.');
}
void main().catch(()=>{console.error('Search service account provisioning failed; check local configuration.');process.exitCode=1;});
