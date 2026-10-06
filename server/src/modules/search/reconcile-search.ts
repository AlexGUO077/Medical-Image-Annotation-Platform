import '../../config/environment';
import { AppDataSource } from '../../database/data-source';
import { ElasticService } from './elastic.service';
import { SearchSyncService } from './search-sync.service';
async function main(){
 try{await AppDataSource.initialize();await new SearchSyncService(AppDataSource,new ElasticService()).runOnce(true);console.log('Published-case search index reconciled from PostgreSQL.');}
 finally{if(AppDataSource.isInitialized)await AppDataSource.destroy();}
}
void main().catch(()=>{console.error('Search reconciliation failed; PostgreSQL remains unchanged.');process.exitCode=1;});
