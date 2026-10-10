---
description: "从锁定的 DeepSeek Harness 官方源码构建 Ubuntu amd64 安装包，不改动上游文件。"
kind: "package-library"
---

# Ubuntu 打包

[English](README.md) | 中文

## 概述

本目录维护独立的 Ubuntu amd64 打包流程。[upstream.lock.json](upstream.lock.json) 指定官方 tag、源码树摘要和产品版本。构建前后，上游所有已跟踪文件必须保持原样；tag 或源码树不匹配、工作区有改动时，打包器会拒绝执行。这些未签名安装包不配置官方自动更新或强制更新。

## 目录

- [构建](#build)
- [安装](#install)
- [维护](#maintenance)
- [开发说明](#dev-note)

<a id="build"></a>
## 构建

构建机器须为 Linux x64，具备 Node.js 22.19+ 或 24+、pnpm 11.28.5、Git、tar，以及[开发指南](../../docs/development.zh.md)中的原生编译依赖。获取上游源码、npm 包、Electron 和解释器归档需要网络连接。安装后的应用自带 Node.js、pnpm 和 Python。

在仓库根目录执行：

```sh
node packaging/ubuntu/build.mjs
```

默认输出目录为 `packaging/ubuntu/.cache/`。打包器在其中获取独立的上游检出，按锁文件安装依赖，执行官方构建和发布打包命令，准备生产运行时，然后生成 `artifacts/deepseek-harness-0.2.1-alpha.2-linux-amd64-unsigned.deb`。成功构建同时生成 SHA-256 校验文件和 `build-record.json`。Electron 打包前后均检查运行时完整性、离线插件安装、Host 启动、前端资源服务和 Office 转 PDF。

可以显式指定已有的干净检出和经过校验的归档缓存：

```sh
node packaging/ubuntu/build.mjs --source /root/.cache/dsh-ubuntu/upstream --cache /root/workspace/typescript/deepseek-harness/apps/desktop/.desktop-build/downloads
```

`--check-source` 只验证指定检出，不执行构建。`--output` 修改应用组装目录。`--cache` 选择共享的归档下载缓存；解释器归档仍按上游锁文件校验。`DSH_UBUNTU_NPM_REGISTRY` 修改生产依赖使用的注册表。Electron 下载器和 electron-builder 保留各自的镜像环境变量选项。

<a id="install"></a>
## 安装

使用管理员账号，通过 Ubuntu 包管理器安装生成的 `.deb`。应用需要正常运行的图形桌面，以及用于账号授权的默认浏览器。包管理器安装会解析声明的系统依赖；以普通用户解压归档不会登记系统软件包，也不会安装缺失的依赖。

应用程序路径为 `/opt/DeepSeek Harness/deepseek-harness`。CLI 启动脚本位于 `/opt/DeepSeek Harness/resources/runtime/cli/bin/dsh`，复用 Electron 的 Node 模式和官方 profile 启动器。用户 profile 和凭证保存在标准 Harness 用户目录；安装包不包含账号令牌或 API 密钥。

<a id="maintenance"></a>
## 维护

Ubuntu 专属代码全部位于本目录，可以迁移到独立仓库。更新上游时，审核并修改 [upstream.lock.json](upstream.lock.json)，然后重新构建并验证 Ubuntu 桌面运行。无需为 Linux 修改根工作区清单或上游包源码。官方准备函数从指定检出导入，因此上游函数变化需要在本目录审核适配。

编译后的主进程文件只接受一处基于语法解析的适配：Linux 账号页面使用现有的 Web 平台值，替代上游的 macOS 默认值。构造函数缺失、重复或发生变化时，打包会中止。[adapt-artifacts.test.mjs](adapt-artifacts.test.mjs) 验证支持的平台值和上游变化：

```sh
DSH_UBUNTU_SOURCE=/root/.cache/dsh-ubuntu/upstream node --test packaging/ubuntu/*.test.mjs
```

应用使用普通文件目录（`asar: false`），让上游 Office 发现逻辑直接执行正常的文件系统操作。相对路径链接向 Electron 外壳提供 `dsh/node_modules`，向官方 CLI 提供相邻的运行时目录。运行时文件哈希和可执行权限仍由上游函数生成并校验；渲染进程沙箱保持启用。安装包在 Ubuntu 22.04 amd64 上验证；其他发行版和架构需要单独验证。实际账号登录和模型响应需要用户凭证，不属于无凭证打包检查。

<a id="dev-note"></a>
## 开发说明

构建产物和下载缓存均可重新生成，并排除在 Git 之外。现有官方桌面打包脚本继续维护 Windows 和 macOS；本目录只维护 Ubuntu 分发。
