# VoxCode Relay 手动安装包

该包同时包含公网 Relay 和公司 Mac Connector 两个角色。安装器只写入你通过 `--prefix` 指定的新目录，默认是 `~/.local/lib/voxcode-relay`；若目录已存在会直接退出，不覆盖已有文件。包内已带固定版本的 `ws` 依赖，不需要全局安装依赖。

## 构建

在仓库根目录执行：

```sh
node scripts/build-relay-package.mjs --output dist/voxcode-relay-0.1.0.tar.gz
shasum -a 256 dist/voxcode-relay-0.1.0.tar.gz
```

发布包不包含任何密钥、证书、`.env` 文件或生产数据。

## 安装

把 tar.gz 复制到目标机器后：

```sh
tar -xzf voxcode-relay-0.1.0.tar.gz
cd voxcode-relay-0.1.0
./install.sh --role relay --prefix "$HOME/.local/lib/voxcode-relay"
# 或公司 Mac：
./install.sh --role connector --prefix "$HOME/.local/lib/voxcode-relay"
```

安装要求 Node.js 22 或更高版本。`--skip-deps` 适用于离线安装，普通安装会在包内目录运行 `npm ci --omit=dev --ignore-scripts`，不会全局安装。

编辑生成的 `config/relay.env` 或 `config/connector.env`，填入同一组机器 ID/密钥。密钥只放在配置文件中，不放进命令行、URL 或日志。当前批准链路是手机蜂窝加用户 VPN → vm6 `https://100.100.81.209:9899`；公司 Mac Connector 使用 `wss://100.100.81.209:9899/connector`。详见[统一链路与验收](../../../docs/architecture/vm6-vpn-delivery.md)。Relay 远端监听仍必须配置 TLS，服务器证书 IP SAN 必须包含 `100.100.81.209`；模板默认回环地址需有意改为 `0.0.0.0` 才接收 VPN 网络连接。`121.52.250.201` 属于 bili-xs8，不是此部署。如果9899被其他服务占用或归属未知，停止并通知；已有 VoxCode 进程先确认归属，再按计划更新，禁止盲目杀进程。

## 运行

```sh
bin/start-relay                 # 前台，便于首次验收
bin/start-relay --daemon        # 用户权限后台运行
bin/start-connector             # 前台
bin/start-connector --daemon    # 用户权限后台运行
bin/status
bin/stop                        # 只停止本安装目录记录的 PID
```

首次部署建议前台运行并从另一终端验证健康接口、9899 监听和日志，再改用用户级进程管理器。Linux 可手动将 `systemd/*.service` 复制到 `~/.config/systemd/user/` 后由用户自行执行 `systemctl --user`；安装脚本不会自动注册、启停或修改系统服务。macOS 没有 systemd，应使用 launchd 或前台管理器。

## 角色职责

- Relay：监听 HTTPS/WSS，接收手机 API 并转发到已认证的 Mac Connector。
- Connector：由公司 Mac 主动向 Relay 建立 WSS，固定转发到本机 `127.0.0.1:8787` Bridge。

安装包不包含 Mac Bridge，也不会安装或修改 Codex、灵矽或系统防火墙。回滚时先执行 `bin/stop`，确认进程退出后再删除整个 prefix。
