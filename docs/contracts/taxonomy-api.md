# WP-03 标签树与征象管理接口契约

本契约对应源开发手册 §4.2、§5.2、§6.3、需求基线 WP-03，以及已批准的 [D-28](../decisions/D-28-taxonomy-management.md)。当前数据均为合成示例，不作为医学判断依据。

## 通用规则

- 所有接口均要求 Bearer access token，并沿用认证模块的账号停用、过期、首次改密和管理员 2FA 检查。
- `GET /api/taxonomy/tree` 允许已认证的管理员和业务人员读取；其余本契约接口仅允许管理员调用，并在服务端执行角色校验。
- 所有查询和写操作只处理 `deleted_at IS NULL` 的记录。成功写操作与审计日志在同一事务内提交。
- 八大系统一级根节点固定且只读；层级结构固定为“系统 → 部位/类别 → 疾病 → 分型/分期”。
- 管理列表使用 `page/pageSize`，默认 `1/20`，`pageSize` 最大为 100。树接口因返回完整层级结构不分页。
- 成功响应字段使用数据库契约中的 snake_case；错误统一为 `{ "code": "HTTP_4xx", "message": "..." }`。

## 读取接口

### GET /api/taxonomy/tree

返回完整四级树及征象定义。只返回活跃节点和征象，均按名称稳定排序。

```json
{
  "tree": [{
    "id": "uuid",
    "parent_id": null,
    "level": 1,
    "name": "呼吸",
    "synonyms": [],
    "icd": null,
    "children": []
  }],
  "sign_tags": [{
    "id": "uuid",
    "name": "合成示例征象-resp",
    "system_code": "resp",
    "definition": "仅用于合成数据开发验证，不作为医学判断依据。"
  }]
}
```

第 3 级疾病节点另含 `sign_tags`，表示所属一级系统当前可用的征象。源手册只定义 `sign_tags.system_code`，未定义疾病征象关联表，因此不新增更细粒度关系。`taxonomy_nodes.synonyms` 是当前唯一同义词来源；接口不得自行生成征象同义词。

### GET /api/taxonomy/sign-tags

仅管理员。查询参数：`page`、`pageSize`、可选 `system_code`、可选 `keyword`。`keyword` 对名称执行大小写不敏感的包含匹配。

```json
{
  "items": [{
    "id": "uuid",
    "name": "合成示例征象-resp",
    "system_code": "resp",
    "definition": "仅用于合成数据开发验证，不作为医学判断依据。"
  }],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

## 标签节点写接口

### POST /api/taxonomy/nodes

仅管理员。创建第 2～4 级节点；`level` 由父节点推导，客户端不得提交。

```json
{
  "parent_id": "uuid",
  "name": "合成示例疾病",
  "synonyms": ["合成示例别名"],
  "icd": null
}
```

成功返回 `201` 和完整节点对象（`children: []`）。父节点必须存在且最高只能为第 3 级。

### PUT /api/taxonomy/nodes/{id}

仅管理员。完整替换可编辑字段；不接受 `parent_id` 或 `level`，因此不能移动节点或改变层级。

```json
{
  "name": "合成示例疾病修订",
  "synonyms": ["合成示例别名"],
  "icd": null
}
```

成功返回 `200` 和更新后的完整节点对象。一级根节点不可修改。

### DELETE /api/taxonomy/nodes/{id}

仅管理员。成功时软删除未被引用的第 2～4 级叶节点，返回：

```json
{ "id": "uuid", "deleted": true }
```

一级根节点、存在活跃子节点、被 `cases.disease_tag_id` 引用或被 `annotation_objects.part_id` 引用的节点不得删除。

## 征象写接口

### POST /api/taxonomy/sign-tags

仅管理员。

```json
{
  "name": "合成示例征象",
  "system_code": "resp",
  "definition": "仅用于合成数据开发验证，不作为医学判断依据。"
}
```

成功返回 `201` 和完整征象对象。

### PUT /api/taxonomy/sign-tags/{id}

仅管理员。请求体与创建相同，完整替换名称、所属系统和定义；成功返回更新后的完整征象对象。

### DELETE /api/taxonomy/sign-tags/{id}

仅管理员。未被 `annotation_tags.sign_tag_id` 引用时软删除，成功返回：

```json
{ "id": "uuid", "deleted": true }
```

## 校验与错误

| 状态 | `code` | 触发条件 |
| --- | --- | --- |
| 400 | `HTTP_400` | 请求体、UUID、分页、系统编码、名称、同义词或定义格式无效；父节点为第 4 级 |
| 401 | `HTTP_401` | 缺少、过期或无效认证信息 |
| 403 | `HTTP_403` | 非管理员调用管理接口；修改或删除一级根节点 |
| 404 | `HTTP_404` | 目标节点、父节点或征象不存在或已软删除 |
| 409 | `HTTP_409` | 活跃名称唯一约束冲突；删除仍有子节点或已被业务数据引用的记录 |

名称和定义去除首尾空白后不能为空；同义词必须是字符串数组，逐项去除首尾空白、移除空值并去重。`system_code` 仅允许既有八大系统编码。ICD 可为空，不强制唯一。
