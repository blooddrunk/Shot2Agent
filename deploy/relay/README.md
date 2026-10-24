# 私人 VPS Relay（M10 开发版）

可选的独立 Linux Worker 见 [M12-V 部署说明](WORKER.md)。它使用另一个服务、持久卷、独立 worker Token 和凭据文件；此处的 Relay 仍不执行 Agent。已有 Windows B Worker 与独立 Local 均继续可用。

前置条件：一台 Linux VPS、Docker Engine 和 Compose v2；一个解析到 VPS 的域名；防火墙只允许 80/443 入站（以及你的管理通道）。Windows A/B 都只向 HTTPS 发起连接，不开放入站端口。此部署不调用模型；模型只在你批准的 B 电脑运行。真实公网 TLS 和双 Windows 验收见 [Remote 使用与验收](../../docs/REMOTE_GUIDE.md)，不能由容器测试替代。

## 首次部署

在 VPS 克隆本 PR 的准确提交，进入 `deploy/relay`。先准备域名配置并构建：

```sh
printf 'RELAY_DOMAIN=relay.example.com\n' > .env
docker compose build relay
mkdir -p secrets
docker compose run --rm --no-deps --user 0 -v "$PWD/secrets:/provision" relay node /app/relay-devices.mjs /provision init pc-a pc-b
docker compose up -d
docker compose ps
```

将域名替换为自己的域名。Caddy 自动申请证书、将 HTTP 跳转到 HTTPS。Relay 仅在内部 Docker 网络监听，无宿主机 API 端口；不要额外添加 `3100:3100`。已有 nginx/Caddy 可替代本示例的 Caddy，但仍须终止有效 HTTPS，并将后端限制在私有网络。健康检查 `/healthz` 只返回存活状态，不含私有信息。

通过已有安全管理通道，分别把 `secrets/pc-a.token` 和 `secrets/pc-b.token` 内容提供给对应电脑的使用者；在 Shot2Agent 设置中填写，不要把 Token 放在 URL、命令参数、截图、问题或日志里。注册文件和 Token 文件为 0600；容器 UID 1000 读取，目录为 0700。不要提交 `secrets` 或 `.env`。部署人员需要管理服务端设备注册表；Windows 普通用户只操作 GUI。

## 更新、轮换与撤销

```sh
docker compose run --rm --no-deps --user 0 -v "$PWD/secrets:/provision" relay node /app/relay-devices.mjs /provision rotate pc-a
```

在 A 的“设备 Token”填入新 `pc-a.token`，保存并测试连接。旧 Token 在后续请求立即失效；不改变设备 ID/owner，因此原队列仍属同一设备。轮换前暂停 B 接收并等当前任务完成，避免中断心跳和结果确认。`revoke pc-a` 撤销设备，`add pc-c` 添加设备；至少保留一个管理中的设备。每次请求重新读取注册文件，不需要重启服务；文件替换是原子的。更改域名或 owner/device ID 会保留但暂停原连接绑定的本地待传队列，不迁移它们。

更新源码前，先完成下面的停机备份，再在同一部署目录 `docker compose build relay && docker compose up -d`。SQLite 模式与旧 Local 数据库隔离；不修改 Local 文件。不要使用 `docker compose down -v` 升级，那个选项会删除卷。

## 一致备份与恢复

停机备份把 SQLite、WAL 和私有 blob 一起保存；不要只复制运行中的主 SQLite 文件。

```sh
mkdir -p backups
chmod 700 backups
docker compose stop relay
docker compose run --rm --no-deps --user 0 -v "$PWD/backups:/backup" relay tar -C /data -czf /backup/data.tar.gz .
tar -czf backups/devices.tar.gz secrets .env
chmod 600 backups/*.tar.gz
docker compose up -d relay
```

备份包含截图、结果和设备凭据，应离线妥善保管。恢复时使用**新的部署目录和新的 Compose project 名称**（`docker compose -p shot-restored ...`），保留原卷用于回退。将本仓库相同提交及 `.env`、`secrets` 恢复到新目录；先 `docker compose -p shot-restored build relay`，在尚未启动 Relay 的新空卷执行：

```sh
docker compose -p shot-restored run --rm --no-deps --user 0 -v "$PWD/backups:/backup:ro" relay tar -C /data -xzf /backup/data.tar.gz
docker compose -p shot-restored up -d
```

确认旧服务已停止，再让新服务绑定 80/443。A/B 点测试连接，观察已有任务/结果及只完成一次的 attempt。失败则停新服务、恢复旧服务；不要让两份服务并行处理同一备份队列。

## 资源边界和诊断

Relay 接受 20 MiB/图、60 MiB/任务（GUI 1–5 图），数据库最多 10,000 个任务，引用的私有文件最多 2 GiB；超限拒绝新写入，不清理活动任务。容器内存 512 MiB、CPU 1、128 PID，日志轮换 2×5 MiB；没有请求头/Token/正文日志。磁盘已满会安全拒绝持久写入。备份后扩容或归档整个已停用的服务数据；M10 不提供自动删除或 Web 历史管理。Caddy 的证书卷也应保留，避免无谓重新签发。

`docker compose ps` 查看健康；`docker compose logs --tail 40 relay` 仅有服务就绪/启动失败码。连接失败先检查域名、证书、防火墙、注册表权限和容器健康。不要用关闭 TLS 校验来排错。容器自动验收命令（需要本机 Docker）：

```sh
docker build -f deploy/relay/Dockerfile -t shot2agent-relay:m10-test .
node scripts/relay-container.mjs shot2agent-relay:m10-test
```

这两条从仓库根目录运行。测试创建独立 Compose project/卷、临时设备 Token 和合成图片，检查去重、重启、结果下载、拒绝匿名访问、Token 热轮换以及停机备份恢复；结束后只清理测试自身的资源。它不证明真实 VPS 的 DNS/TLS 或 Windows Explorer 粘贴。
