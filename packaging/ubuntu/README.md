---
description: "Build Ubuntu amd64 installers from locked official DeepSeek Harness sources without changing upstream files."
kind: "package-library"
---

# Ubuntu Packaging

English | [中文](README.zh.md)

## Summary

This directory owns an independent Ubuntu amd64 packaging workflow. [upstream.lock.json](upstream.lock.json) selects the official tag, source tree digest and product version. Upstream tracked files must be unchanged before and after the build; the packager rejects a different tag, source tree or dirty checkout. These unsigned installers have no official automatic update or mandatory update configuration.

## Table of Contents

- [Build](#build)
- [Install](#install)
- [Maintenance](#maintenance)
- [Dev Note](#dev-note)

<a id="build"></a>
## Build

Use a Linux x64 build machine with Node.js 22.19+ or 24+, pnpm 11.28.5, Git, tar and the native compiler prerequisites from [development](../../docs/development.md). Network access is needed for upstream sources, npm packages, Electron and interpreter archives. The installed application carries its own Node.js, pnpm and Python.

From the repository root:

```sh
node packaging/ubuntu/build.mjs
```

The default output is `packaging/ubuntu/.cache/`. The packager fetches a separate upstream checkout there, installs its frozen dependencies, runs the official build and release packing commands, prepares the production runtime, and produces `artifacts/deepseek-harness-0.2.1-alpha.2-linux-amd64-unsigned.deb`. A SHA-256 sidecar and `build-record.json` accompany a successful build. Runtime integrity, offline plugin installation, Host startup, renderer serving and Office-to-PDF conversion are checked both before and after Electron packaging.

An existing clean checkout and verified archive cache can be supplied explicitly:

```sh
node packaging/ubuntu/build.mjs --source /root/.cache/dsh-ubuntu/upstream --cache /root/workspace/typescript/deepseek-harness/apps/desktop/.desktop-build/downloads
```

`--check-source` verifies the selected checkout without building. `--output` changes the carrier staging directory. `--cache` selects the shared archive download cache; interpreter archives retain the checksums from the upstream lock. `DSH_UBUNTU_NPM_REGISTRY` changes production dependency resolution. Electron's downloader and electron-builder retain their respective mirror environment options.

<a id="install"></a>
## Install

Install the generated `.deb` with Ubuntu's package manager using an administrator account. The application requires a working graphical desktop and default browser for account authorization. Package-manager installation resolves the declared system dependencies; extracting the archive as an ordinary user does not register a system package or install missing dependencies.

The application executable is `/opt/DeepSeek Harness/deepseek-harness`. Its CLI launcher is `/opt/DeepSeek Harness/resources/runtime/cli/bin/dsh`, which reuses Electron's Node mode and the official profile runner. User profiles and credentials remain in the standard Harness home; packaging does not embed account tokens or API keys.

<a id="maintenance"></a>
## Maintenance

All Ubuntu-owned code lives in this directory and can be moved to a separate repository. Updating upstream means reviewing and updating [upstream.lock.json](upstream.lock.json), then rebuilding and repeating the Ubuntu desktop checks. No root workspace manifest or upstream package source needs a Linux patch. The official preparation helpers are imported from the selected checkout, so an upstream helper change requires review here.

The compiled main bundle receives one syntax-checked adaptation: Linux account documents use the existing web platform value instead of the upstream macOS fallback. A missing, duplicated or changed constructor aborts packaging. [adapt-artifacts.test.mjs](adapt-artifacts.test.mjs) covers supported platform values and upstream drift:

```sh
DSH_UBUNTU_SOURCE=/root/.cache/dsh-ubuntu/upstream node --test packaging/ubuntu/*.test.mjs
```

The carrier uses ordinary application files (`asar: false`), allowing upstream Office discovery to use normal filesystem operations. Relative links expose `dsh/node_modules` to the Electron shell and the sibling runtime directory to the official CLI. Runtime hashes and executable permissions are still generated and verified by upstream APIs; renderer sandboxing remains enabled. The installer is tested on Ubuntu 22.04 amd64; other distributions and architectures need their own qualification. Live account login and model responses require user credentials and are separate from the credential-free packaging checks.

<a id="dev-note"></a>
## Dev Note

Build outputs and download caches are disposable and excluded from Git. The existing official desktop packaging scripts remain authoritative for Windows and macOS; this directory owns Ubuntu delivery only.
