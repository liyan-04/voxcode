# HTTP/IP 与多任务方案补充评审

日期：2026-10-23。用户在方案阶段补充：只有 HTTP + 公网 IP，没有现成 HTTPS；两个并发任务不足。本轮仅调整设计，源码修改、联调与部署继续暂停。

## 网络建议

架构评审者只读核对公开资料，建议同 IP:9899 提供 TLS，无需额外域名或公网端口。使用含 IP SAN 的证书和定向信任；公开 CA 或系统默认信任不是唯一可选方式。私有 CA 的公开信任材料可随签名 App 携带，Mac 连接器配置对应 CA；首次信任不能来自未经认证的 HTTP 下载。

iOS 17+/macOS 14+ 支持以具体 IP 为键的 ATS 例外，键不含端口。定向信任不自动豁免 ATS；可能需要该 IP 的例外以及手动身份校验。例外可允许 HTTP，因此 App 仍需显式拒绝远程明文 URL。不能使用全局接受证书的处理方式。URLSession 和 WKWebView 各自需要验证身份、IP、有效期与拒绝错误证书，不能互相替代验收。

单 IP、单端口不强制独立预览 origin。控制 API 只认可原生保存的 bearer，预览 cookie 只授权指定任务/版本，不能获得控制权限。保持每任务独立 WebView 数据、禁止 Service Worker/外链/任意原生桥。HttpOnly 和路径不是来源隔离，也不是实际授权边界。

如果外部入口必须保持 HTTP，标准加密 VPN 内的 HTTP 是另一条路线，但需要服务器与设备配置。当前仅 TCP9899，不能默认额外 UDP 端口、第三方 VPN 账号或其他出口可用。公网裸 HTTP 会暴露控制凭据、代码和语音，不作为建议基线。

未来恢复部署仍先检查端口，若 9899 被已有服务占用即停止并通知；不能为 TLS 擅自替换已有服务。

Apple 参考：

- [NSExceptionDomains，含具体 IP 例外](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains)
- [NSExceptionAllowsInsecureHTTPLoads](https://developer.apple.com/documentation/bundleresources/information-property-list/nsexceptionallowsinsecurehttploads)
- [手动服务端信任校验](https://developer.apple.com/documentation/foundation/performing-manual-server-trust-authentication)
- [WKWebView 认证挑战](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webview(_:didreceive:completionhandler:))

这是文档依据与建议路线，不是真机或服务器探针结果。

## 多任务建议

移动评审者建议分开表达任务容量与执行并发：至少 20 个未归档任务，默认四个执行名额，可配置 1–8，超额排队。同一任务仅一个活跃 turn，停止中及等待 Codex 授权仍占名额；降低上限不强停在途任务。

手机显示执行中/排队/待处理计数及筛选，任务有短编号以区分重名。待处理入口聚合授权、澄清和失败；模型限流、机器资源不足和执行端离线显示具体原因。单路录音仍固定原任务，不随页面切换迁移。

验收分层：真机管理至少 20 个持久化任务；真实验证四个独立任务并行；调度测试验证配置八路、超额排队和安全释放名额。八路真实模型性能单列实测，不提前承诺速度或资源充分。

主方案已吸收建议。四路默认和八路配置仍为待用户确认的建议，当前代码的两个名额限制未修改。
