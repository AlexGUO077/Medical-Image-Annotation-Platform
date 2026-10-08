# 本地合成部署与恢复

依据源 Word §8、[D-43](../docs/decisions/D-43-synthetic-deployment-backup.md)、[D-44](../docs/decisions/D-44-worker-container-security-compatibility.md)及[部署契约](../docs/contracts/deployment-backup.md)。当前仅本机 synthetic 演练；部署包不安装定时任务，不默认连接异地或真实数据环境。当前验收状态见 [STATUS](../docs/STATUS.md)。

## 新实例

需要 Docker Compose v2、Python 3.9+、OpenSSL。后端使用 Linux amd64/Python 3.11；Apple Silicon 通过 Docker 模拟运行，性能不作为云端容量证据。ES 在 Apple Silicon 应由同一 Dockerfile 构建本机架构，不关闭其沙箱。配置使用七个服务，只有 nginx 发布到回环地址；禁止与根目录开发 Compose 混用。

以下命令在仓库根执行。实例名和端口必须未占用。帧预算由负责人明确设置，脚本没有默认额度；示例的变量须先按本次测试范围赋值。所有秘密自动写入 Git 忽略的私有目录，不粘贴到聊天、PR 或日志。

```sh
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-local" init \
  --project miap-synthetic-local --http-port 18080 --https-port 18443 \
  --window "$FRAME_WINDOW" --rates "$FRAME_CR" "$FRAME_DX" "$FRAME_CT" "$FRAME_MR" "$FRAME_US"
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-local" build postgres orthanc minio redis elasticsearch server nginx
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-local" up
```

访问 `https://localhost:18443`。临时证书仅供测试，验证时显式信任该实例的 `certs/fullchain.pem`；它不是公网可信证书。首个管理员的随机交接密码在私有 `.env` 的 `SEED_ADMIN_PASSWORD` 中；登录后沿用首次改密及 2FA 流程。`up` 只对该实例做迁移、最小角色和私有桶初始化，不覆盖已有管理员密码。

运行 server 不接收数据库 owner、MinIO root 或 ES elastic 密码。一次性初始化容器使用 owner，日常数据库账号继承已有 `miap_app`；MinIO 仅可访问两个项目桶，ES 仅发布索引权限。不要用 owner 账号替换应用账号来处理权限错误。

## 同批备份和新实例恢复

```sh
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-local" backup \
  --destination "$PWD/backups/synthetic-local"
```

脚本先停 server，再停 Orthanc/MinIO；失败时尝试恢复原先正在运行的服务。只有文件校验和服务恢复均成功后，才公布完整批次路径。每个完整批次含 PG custom dump、两个数据卷 tar、校验清单及恢复密钥指纹，不含密钥本身。PG 保留最近 30 份，旧批次影像/对象不会自动删除；被清理 PG 的批次不再可完整恢复。备份介质和密钥必须分开保管。

恢复必须新建独立实例，使用不同项目名/端口；从原实例私有配置读取 MFA、映射和 UID 密钥，其他秘密重新生成。指纹不匹配、坏备份、路径穿越/链接条目、已有目标资源均拒绝恢复。

```sh
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-restore" init \
  --project miap-synthetic-restore --http-port 18081 --https-port 18444 \
  --window "$FRAME_WINDOW" --rates "$FRAME_CR" "$FRAME_DX" "$FRAME_CT" "$FRAME_MR" "$FRAME_US" \
  --keys-from "$PWD/.credentials/synthetic-local"
python3 deploy/manage.py --instance "$PWD/.credentials/synthetic-restore" restore \
  --source "$COMPLETE_BATCH"
```

还原只启动新目标；在业务入口启动前拒绝任何非 synthetic 病例。Redis 票据不恢复，ES 从 PG 对账重建。恢复命令成功后仍须通过账号鉴权打开至少三例影像及附件，并验证映射可解密，才能记录本次演练成功。`test-restore.cjs` 是空数据库专用合成夹具，不打入运行镜像；`seed` 在空实例建立三例，`verify` 在原实例或恢复实例验证 HTTPS 预览和最小权限。执行前将脚本复制到测试 server 的 `/app/server/test-restore.cjs`，公开测试证书复制为 `/tmp/wp16-test-ca.pem`；不得用于用户数据实例。

```sh
python3 -m unittest discover -s deploy -p 'test_*.py' -v
# 使用此实例的 Compose project / env-file / deploy/compose.yml 参数：
# docker compose ... cp deploy/test-restore.cjs server:/app/server/test-restore.cjs
# docker compose ... cp <实例>/certs/fullchain.pem server:/tmp/wp16-test-ca.pem
# docker compose ... exec -T server node test-restore.cjs seed
# 恢复实例仅使用 verify，不再次 seed。
```

故障时命令返回非零，不打印可能包含凭据的命令或底层输出。保留 `.partial-*` 以便运维检查，不将其同步或用于恢复；旧备份不因失败删除。先核对该实例的容器健康状态和私有配置，再处理失败；不要对已有卷强制恢复。

## 待具体部署目标确认后的运维配置

真实 Linux 主机/域名/联系邮箱未提供，因此本批不签发公网证书、不运行异地传输、不安装 cron。后续部署需将 nginx 域名、CORS、301 目标及宿主端口改为该主机的域名和 80/443，并重新检查入口、证书和恢复链路。

证书采用手册规定的 certbot webroot：将 `/.well-known/acme-challenge/` 对应目录作为 certbot 的 `--webroot -w`，首次按实际域名和邮箱执行 `certbot certonly --webroot`；续期使用 `certbot renew` 的 deploy hook 更新 TLS 卷内证书、保持 nginx UID 101 可读的最小权限，并先 `nginx -t` 再 reload。启用前运行 `certbot renew --dry-run`，记录真实签发及续期结果；不能把本地自签验证计入。

确认异地主机、SSH 身份和已核验的 known_hosts 后，可对备份命令增加 `--rsync-target user@host:/absolute/directory`。脚本仅传完整批次，启用 BatchMode 和 StrictHostKeyChecking，不删除远端文件，同步失败返回失败。Linux cron 使用部署账号执行每日备份命令、单独保存受控运行结果；每月新建临时实例恢复并打开三例。实际时间、目标及保留介质由负责人配置，本批不擅自预填。

回滚代码使用原镜像/配置版本；数据库和对象恢复只进入新实例，检查通过后再由负责人决定切换入口。演练完成后的清理仅针对对应 `miap-synthetic-*` 项目，不操作根目录开发实例或共享卷。
