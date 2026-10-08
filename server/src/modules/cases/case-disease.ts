import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export async function assertCaseDisease(manager: Pick<EntityManager, 'query'>, id: string | null, system: string, message = '疾病标签缺失、失效或不属于当前系统') {
    const names:Record<string,string>={cns:'中枢神经系统',headneck:'头颈',resp:'呼吸',circ:'循环',digest:'消化',uro:'泌尿',repro:'生殖',bone:'骨骼'};
    const [node]=await manager.query(`SELECT n.id FROM taxonomy_nodes n JOIN taxonomy_nodes p ON p.id=n.parent_id
      LEFT JOIN taxonomy_nodes g ON g.id=p.parent_id LEFT JOIN taxonomy_nodes r ON r.id=g.parent_id
      WHERE n.id=$1 AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND g.deleted_at IS NULL
        AND ((n.level=3 AND p.level=2 AND g.level=1 AND g.name=$2)
          OR (n.level=4 AND p.level=3 AND g.level=2 AND r.level=1 AND r.deleted_at IS NULL AND r.name=$2))
      FOR SHARE OF n,p`,[id,names[system]]);
    if (!node) throw new BadRequestException(message);
}
