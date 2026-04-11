# Project Operations Optimization Plan

_Last reviewed: 2026-04-11_

## 1. Mục tiêu

Plan này bao phủ toàn bộ workspace `LocalAgent` theo 6 trục:

- vận hành workspace và contributor experience
- build
- test
- deploy local
- deploy server
- verify/test trên server

Mục tiêu cuối:

- người mới vào hiểu được repo nào làm gì, repo nào được deploy
- có một contract vận hành duy nhất
- build/test/deploy có stage rõ ràng trước khi chạm server
- partial deploy, rollback, backup/restore có đường đi chính thức

## 2. Current State Matrix

| Thành phần | Vai trò hiện tại | Toolchain/build | Test/CI hiện tại | Có trong deploy path |
| --- | --- | --- | --- | --- |
| `OmniRoute/` | control plane + API plane trung tâm | Node/NPM, image build local/server | CI riêng khá đầy đủ | Có |
| `openclaw/` | gateway + CLI + UI control | Node + PNPM + Bun + Docker multi-stage | CI riêng rất dày | Có |
| `open-webui/` | chat frontend + backend Python | Node + Python | CI riêng nhưng chủ yếu format/build, một số workflow bị disable | Có, nhưng runtime dùng image upstream |
| `claude-code/` | repo tham chiếu/phát triển | Bun | không nằm trong system deploy hiện tại | Không |
| `deploy/` + `ops/` | orchestration hệ thống | shell + docker compose | healthcheck/smoke test stack | Có |

Các facts quan trọng:

- root README liệt kê `OmniRoute/`, `openclaw/`, `open-webui/`, `claude-code/` là source active ở [README.md](/Users/thont/Local/POC/LocalAgent/README.md#L20)
- nhưng runtime path thật chỉ gồm `OmniRoute`, `open-webui`, `openclaw`; `claude-code` không nằm trên deploy path ở [SYSTEM_ARCHITECTURE.md](/Users/thont/Local/POC/LocalAgent/docs/SYSTEM_ARCHITECTURE.md#L24)
- `ops/agent.sh` hiện chỉ có 2 command system-level: `deploy local` và `deploy server` ở [agent.sh](/Users/thont/Local/POC/LocalAgent/ops/agent.sh#L8)
- `open-webui` đang được deploy bằng image upstream GHCR chứ không build từ source local ở [docker-compose.yml](/Users/thont/Local/POC/LocalAgent/deploy/layer2-apps/docker-compose.yml#L60)

## 3. Findings

### P0. Workspace chưa có một orchestration layer thống nhất cho toàn project

Hiện tại root chỉ có operational surface cho deploy, chưa có build/test/status/backup contract ở tầng hệ thống:

- `ops/agent.sh` chỉ route `deploy local` và `deploy server` ở [agent.sh](/Users/thont/Local/POC/LocalAgent/ops/agent.sh#L8)
- docs CI/CD hiện mô tả deploy flow, không mô tả system-level build/test orchestration cho các repo con ở [CICD.md](/Users/thont/Local/POC/LocalAgent/docs/CICD.md#L93)

Hệ quả:

- muốn đóng góp an toàn, contributor phải tự biết repo nào cần lint/test/build riêng
- không có một command thống nhất kiểu `build all`, `test all`, `verify server`
- review thay đổi liên-repo rất khó kiểm soát

### P0. Deploy gate đang xảy ra sau rollout, không phải trước rollout

`ops/deploy_local.sh` và `ops/deploy_server.sh` đều theo mô hình:

1. build image
2. rollout/restart
3. healthcheck
4. smoke test

Thay vì:

1. preflight
2. test/build
3. package artifact
4. deploy
5. verify

Evidence:

- local deploy build rồi up stack rồi mới healthcheck/smoke ở [deploy_local.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_local.sh#L186)
- server deploy build OmniRoute, sync, restart remote rồi mới healthcheck/smoke ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L24)

Đây là gap lớn nhất nếu muốn deploy an toàn lên server.

### P0. Deploy vẫn coupling trực tiếp vào app internals

System deploy hiện không chỉ quản lý container mà còn mutate internal state của app:

- OmniRoute SQLite
- OpenWebUI Postgres
- OpenWebUI Redis
- OpenClaw config/model defaults

trong [bootstrap_app_clients.sh](/Users/thont/Local/POC/LocalAgent/deploy/scripts/bootstrap_app_clients.sh#L78), [bootstrap_app_clients.sh](/Users/thont/Local/POC/LocalAgent/deploy/scripts/bootstrap_app_clients.sh#L135), [bootstrap_app_clients.sh](/Users/thont/Local/POC/LocalAgent/deploy/scripts/bootstrap_app_clients.sh#L169), [bootstrap_app_clients.sh](/Users/thont/Local/POC/LocalAgent/deploy/scripts/bootstrap_app_clients.sh#L188).

Điều này làm deploy khó học, khó nâng cấp, và khó rollback.

### P1. Toolchain của project đang phân mảnh nhưng chưa có bootstrap chuẩn

Workspace hiện có ít nhất 4 kiểu toolchain:

- OmniRoute: Node/NPM ở [package.json](/Users/thont/Local/POC/LocalAgent/OmniRoute/package.json#L48)
- OpenClaw: PNPM ở [package.json](/Users/thont/Local/POC/LocalAgent/openclaw/package.json#L1428)
- Claude Code: Bun ở [package.json](/Users/thont/Local/POC/LocalAgent/claude-code/package.json#L91)
- OpenWebUI: Node frontend + Python backend, Python `>=3.11,<3.13` ở [pyproject.toml](/Users/thont/Local/POC/LocalAgent/open-webui/pyproject.toml#L121)

Trong khi đó máy hiện tại:

- có `node v22.22.2`, `npm 10.9.7`, `bun 1.3.9`, `docker 29.0.1`
- không có `pnpm`
- chỉ có `Python 3.9.6`

Điều này chứng minh onboarding hiện chưa có toolchain bootstrap contract đủ tốt.

### P1. Ranh giới giữa source active và runtime active còn gây nhầm lẫn

Workspace hiện nói `open-webui/` là source active ở [README.md](/Users/thont/Local/POC/LocalAgent/README.md#L20), nhưng runtime lại dùng image upstream GHCR ở [docker-compose.yml](/Users/thont/Local/POC/LocalAgent/deploy/layer2-apps/docker-compose.yml#L60).

`claude-code/` còn nằm trong source active ở [README.md](/Users/thont/Local/POC/LocalAgent/README.md#L20), nhưng lại không nằm trên deploy path ở [SYSTEM_ARCHITECTURE.md](/Users/thont/Local/POC/LocalAgent/docs/SYSTEM_ARCHITECTURE.md#L34).

Người mới rất dễ hỏi:

- repo nào sửa sẽ ảnh hưởng runtime?
- repo nào chỉ để tham chiếu?
- repo nào build local? repo nào kéo image upstream?

### P1. Local/server deploy không đối xứng

Local build OmniRoute và OpenClaw ở [deploy_local.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_local.sh#L186), nhưng server deploy chỉ build OmniRoute ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L24). Trong khi runtime layer lại restart thêm `open-webui` và `openclaw-gateway` ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L50).

Điều này tạo ra rollout model khó đoán:

- sửa `openclaw/` nhưng không có đường server ship chính thức
- sửa `open-webui/` source local nhưng runtime vẫn lấy image upstream

### P1. Server deploy hiện chưa đạt chuẩn artifact pipeline

Server flow đang dựa vào password SSH và host cụ thể:

- `SERVER_REMOTE` hard-code ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L6)
- `SERVER_SSH_PASS` required ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L10)
- `sshpass` + disable host key checking ở [deploy_server.sh](/Users/thont/Local/POC/LocalAgent/ops/deploy_server.sh#L17)

Đây là emergency flow, không nên là baseline lâu dài.

### P1. OpenWebUI vendored source có CI active hạn chế so với vai trò hệ thống

Trong `open-webui/.github/workflows/`, active workflows hiện thấy chủ yếu là:

- frontend format/build/test ở [format-build-frontend.yaml](/Users/thont/Local/POC/LocalAgent/open-webui/.github/workflows/format-build-frontend.yaml#L1)
- backend format ở [format-backend.yaml](/Users/thont/Local/POC/LocalAgent/open-webui/.github/workflows/format-backend.yaml#L1)

Nhưng có các workflow bị disable:

- [integration-test.disabled](/Users/thont/Local/POC/LocalAgent/open-webui/.github/workflows/integration-test.disabled)
- [lint-backend.disabled](/Users/thont/Local/POC/LocalAgent/open-webui/.github/workflows/lint-backend.disabled)
- [lint-frontend.disabled](/Users/thont/Local/POC/LocalAgent/open-webui/.github/workflows/lint-frontend.disabled)

Nếu tiếp tục duy trì fork `open-webui/` trong workspace, cần xác định rõ:

- chỉ vendor để tham chiếu
- hay thực sự fork và carry patch

### P2. Backup/restore vẫn chưa là contract cấp hệ thống

Stack guide mới chỉ mô tả:

- Postgres backup định kỳ
- snapshot file data bằng tar

ở [STACK_GUIDE.md](/Users/thont/Local/POC/LocalAgent/deploy/STACK_GUIDE.md#L114)

Nhưng chưa có:

- manifest snapshot
- restore theo scope
- verify sau restore
- RPO/RTO target

### P2. Workspace footprint lớn, thiếu clean bootstrap cho contributor

Audit hiện tại cho thấy footprint lớn:

- `OmniRoute`: khoảng `1.5G`
- `.localagent-data`: khoảng `1.0G`
- `openclaw`: khoảng `767M`
- `open-webui`: khoảng `421M`
- `claude-code`: khoảng `261M`

Điều này không phải bug runtime, nhưng là friction lớn cho người mới nếu không có lệnh bootstrap/clean/cache policy chuẩn.

## 4. Target Operating Model

### 4.1 Một CLI hệ thống duy nhất

Tạo một command surface duy nhất cho toàn project, ví dụ:

```text
bin/la
```

Command groups:

```bash
la doctor
la bootstrap toolchain
la bootstrap workspace

la build omniroute
la build openclaw
la build all

la test omniroute
la test openclaw
la test open-webui
la test system
la test changed

la stack up local
la stack down local
la stack verify local

la deploy server omniroute
la deploy server openclaw
la deploy server all
la verify server

la backup create all
la backup restore <snapshot>
```

`ops/agent.sh` nên được giữ như wrapper legacy trong ngắn hạn, nhưng không còn là interface chính.

### 4.2 Ownership matrix rõ ràng

Chuẩn hóa trạng thái từng repo:

| Repo | Ownership label | Trạng thái mong muốn |
| --- | --- | --- |
| `OmniRoute/` | `runtime-source` | build và deploy chính thức |
| `openclaw/` | `runtime-source` | build và deploy chính thức |
| `open-webui/` | chọn 1 trong 2: `runtime-source` hoặc `vendor-reference` | không để lửng |
| `claude-code/` | `reference-only` hoặc `experimental` | tách khỏi runtime docs |

Nếu `open-webui` vẫn deploy bằng image upstream, nên ghi rõ:

- source local chỉ để patch/reference
- deploy path lấy image đã pin tag/digest

### 4.3 Toolchain bootstrap thống nhất

Thêm một bootstrap contract, ví dụ:

- `mise.toml` hoặc `.tool-versions`
- `scripts/bootstrap-tools.sh`
- `docs/DEV_ENV.md`

Target versions:

- Node 22
- PNPM 10.x
- Bun 1.3.x
- Python 3.11 hoặc 3.12
- Docker/Buildx

`la doctor` cần fail sớm nếu thiếu:

- `pnpm`
- Python đúng major/minor
- Docker daemon
- `ssh`/`rsync`

## 5. Build Plan

### 5.1 Tách build theo layer

Có 3 lớp build khác nhau, không nên trộn:

1. repo build
2. image build
3. stack deploy

Contract đề xuất:

```bash
la build repo omniroute
la build repo openclaw
la build image omniroute --platform linux/arm64
la build image omniroute --platform linux/amd64
la build image openclaw --platform linux/arm64
la build image openclaw --platform linux/amd64
```

### 5.2 Chuẩn hóa artifact

Server deploy không nên phụ thuộc vào build trực tiếp từ laptop rồi `docker save` thủ công mãi mãi.

Target artifact model:

- image tag có version/commit SHA
- manifest file ghi:
  - image name
  - git SHA
  - build time
  - target arch
- optional SBOM và digest file

### 5.3 Hướng tối ưu build

#### OmniRoute

Hiện Dockerfile đã có một số tối ưu đúng hướng:

- memory cap build ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/OmniRoute/Dockerfile#L5)
- giảm parallelism Next build ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/OmniRoute/Dockerfile#L9)
- retry npm fetch ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/OmniRoute/Dockerfile#L13)

Việc nên làm tiếp:

- pin base image digest
- tách `npm ci` cache rõ hơn theo lockfile
- thêm image smoke test sau build

#### OpenClaw

Dockerfile hiện mạnh nhưng rất phức tạp:

- bun bootstrap retry ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/openclaw/Dockerfile#L46)
- pnpm cache mount ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/openclaw/Dockerfile#L72)
- A2UI fallback cho cross-build ở [Dockerfile](/Users/thont/Local/POC/LocalAgent/openclaw/Dockerfile#L88)

Việc nên làm tiếp:

- tách build profile `dev`, `ci`, `release`
- thêm lightweight image smoke stage
- chuẩn hóa extension build policy cho runtime image

#### OpenWebUI

Nếu vẫn dùng image upstream ở runtime, không nên bắt contributor nghĩ rằng phải build repo này cho system deploy.

Nên chọn một trong hai:

1. bỏ local source khỏi active contributor path của system repo
2. hoặc pin fork và build image riêng như các app khác

Không nên giữ trạng thái nửa vời.

## 6. Test Plan

### 6.1 Test pyramid cấp hệ thống

Tách test thành 5 lớp:

1. `repo-fast`
2. `repo-full`
3. `image-smoke`
4. `stack-local`
5. `server-postdeploy`

### 6.2 Repo-fast

Chạy nhanh, bắt buộc trước mọi build/deploy:

- OmniRoute:
  - `npm run lint`
  - `npm run test:unit`
  - `npm run typecheck:core`
- OpenClaw:
  - `pnpm check`
  - `pnpm test:unit:fast`
- OpenWebUI:
  - `npm run check`
  - `npm run test:frontend`
  - backend lint tối thiểu nếu còn giữ fork

### 6.3 Repo-full

Chạy ở CI hoặc trước server deploy lớn:

- OmniRoute:
  - `npm run test:integration`
  - `npm run test:e2e`
- OpenClaw:
  - `pnpm test`
  - `pnpm test:e2e`
  - subset `test:docker:*` phù hợp system
- OpenWebUI:
  - frontend build
  - backend smoke/import checks

### 6.4 Image-smoke

Sau mỗi image build:

- boot container
- hit `/healthz` hoặc `/`
- assert binary/process start thành công

Đây là lớp còn thiếu rõ trong system repo hiện tại.

### 6.5 Stack-local

Giữ lại `healthcheck.sh` và `smoke_stack.sh`, nhưng đổi vị trí trong pipeline:

```text
repo-fast -> image-build -> image-smoke -> stack-local -> optional deploy
```

Không phải:

```text
build -> deploy -> pray -> smoke
```

### 6.6 Server-postdeploy

Tạo một bộ verify riêng cho server:

```bash
la verify server --mode postdeploy
```

Nó nên gồm:

1. routing/TLS check
2. container health
3. OmniRoute `/v1/models`
4. OpenWebUI -> OmniRoute network path
5. OpenClaw -> OmniRoute network path
6. synthetic chat request
7. log scan 5 phút gần nhất
8. rollback decision

## 7. Local Deploy Plan

### 7.1 Giữ local deploy dễ nhưng tách mode

Thêm 3 mode:

- `la stack up local --mode init`
- `la stack up local --mode dev`
- `la stack up local --mode full`

Ý nghĩa:

- `init`: generate env, data dirs, TLS, first boot
- `dev`: chỉ rebuild/restart service đang đổi
- `full`: full refresh khi cần

### 7.2 Bỏ stop-all làm default

`DEPLOY_LOCAL_STOP_FIRST=1` không nên là default của developer loop.

Target:

- default là rolling update service cần đổi
- stop-all chỉ dùng khi explicit `--clean` hoặc `--free-memory`

### 7.3 Hỗ trợ partial local deploy chính thức

Commands đề xuất:

```bash
la build image omniroute --local
la stack restart local omniroute

la build image openclaw --local
la stack restart local openclaw

la stack verify local
```

### 7.4 Dev UX cho người mới

`la doctor` nên kiểm tra:

- `/etc/hosts`
- Docker running
- env file tồn tại
- toolchain đúng version
- CA trust path

`la quickstart` có thể:

- tạo env local
- bootstrap data dir
- in list URLs local

## 8. Server Deploy Plan

### 8.1 Chuẩn hóa pipeline server

Server deploy nên chuyển sang pipeline này:

1. preflight
2. repo-fast tests
3. build artifacts/images
4. image smoke
5. upload/sync artifact
6. remote pre-deploy backup
7. deploy selected service
8. post-deploy verify
9. rollback nếu fail

### 8.2 Thay password SSH bằng key-based deploy

Baseline mới:

- SSH key only
- host key pinning
- remote inventory trong env/config, không hard-code trong script

### 8.3 Artifact-driven deploy

Thay vì script laptop-centric:

- build image + manifest
- push registry hoặc upload tar artifact có checksum
- server chỉ pull/load artifact đã được verify

### 8.4 Partial server deploy chính thức

Commands đề xuất:

```bash
la deploy server omniroute
la deploy server openclaw
la deploy server openwebui
la deploy server all
```

Rules:

- `omniroute` deploy không restart `platform`
- `openclaw` deploy có đường build artifact riêng
- `openwebui` deploy chỉ có nếu chọn fork-build path; nếu vẫn dùng upstream image thì command này chỉ update pinned image tag

### 8.5 Pre-deploy backup bắt buộc

Trước mỗi server deploy:

- snapshot config
- Postgres backup
- OmniRoute SQLite copy
- optional OpenClaw config/workspace snapshot

`la deploy server ...` phải gọi backup tự động hoặc fail nếu backup policy bị disable trái phép.

## 9. Server Test Plan

### 9.1 Smoke test tối thiểu trên server

Giữ logic hiện tại nhưng nâng thành contract rõ:

- HTTPS route healthy
- OmniRoute API catalog healthy
- provider trung tâm active
- OpenWebUI không dùng bootstrap key
- OpenClaw trỏ đúng OmniRoute
- chat path end-to-end thành công

### 9.2 Synthetic transaction

Thêm 2 synthetic checks:

1. `GET /v1/models`
2. `POST /v1/chat/completions`

Mỗi deploy server phải lưu:

- request id
- model dùng để smoke
- latency
- result

### 9.3 Log-based verification

Sau deploy server, scan:

- Traefik 4xx/5xx spike
- OmniRoute startup errors
- OpenWebUI upstream auth errors
- OpenClaw auth/proxy errors

### 9.4 Rollback contract

Nếu `la verify server` fail:

1. restore last good image tag
2. restore config snapshot nếu cần
3. rerun health + smoke

Rollback không nên là thao tác manual nhớ lệnh.

## 10. Backup, Restore, Data Safety

### 10.1 Backup scopes

Định nghĩa 4 scope:

- `platform-db`
- `platform-object-storage`
- `app-state`
- `full-stack`

### 10.2 Snapshot manifest

Mỗi snapshot cần có:

- timestamp
- hostname/environment
- included scopes
- OmniRoute/OpenClaw image tags
- schema hints

### 10.3 Restore contract

Commands:

```bash
la backup create full-stack
la backup list
la backup restore <snapshot> --scope full-stack
la backup verify <snapshot>
```

### 10.4 Cache policy

Redis phải được phân loại rõ:

- phần nào là cache có thể rebuild
- phần nào là runtime config cần resync

Nếu chọn coi Redis là disposable cache, phải có `bootstrap/reconcile` không phụ thuộc vào thao tác DB-hack giòn dễ gãy.

## 11. Phased Roadmap

### Phase 0. Baseline và contract

Deliverables:

- tài liệu ownership matrix
- tài liệu commands chuẩn
- `la doctor`
- `la bootstrap toolchain`

Acceptance:

- contributor mới biết repo nào là runtime-source, repo nào là reference-only
- máy mới có thể tự kiểm tra thiếu `pnpm`, Python 3.11+, Docker

### Phase 1. System CLI

Deliverables:

- `bin/la`
- wrapper cho build/test/stack/deploy/backup
- `ops/agent.sh` chuyển thành legacy wrapper

Acceptance:

- mọi thao tác hệ thống đi qua một CLI duy nhất

### Phase 2. Build/Test gates

Deliverables:

- `la test repo-fast`
- `la test repo-full`
- `la build image`
- `la test image-smoke`

Acceptance:

- server deploy không còn bắt đầu từ trạng thái "chưa test gì"

### Phase 3. Local deploy refactor

Deliverables:

- mode `init/dev/full`
- partial restart per service
- stop-all không còn là default

Acceptance:

- sửa OmniRoute/OpenClaw có thể redeploy local từng phần

### Phase 4. Server deploy refactor

Deliverables:

- SSH key flow
- artifact manifest
- pre-deploy backup
- partial server deploy

Acceptance:

- deploy server không còn phụ thuộc password SSH và host hard-code

### Phase 5. Backup/restore

Deliverables:

- snapshot manifest
- restore command
- verify restore command

Acceptance:

- có thể full restore và partial restore theo runbook

### Phase 6. System CI

Deliverables:

- root-level CI manifest cho changed repos
- repo-fast gates trước merge
- optional nightly local-stack smoke hoặc remote staging verify

Acceptance:

- thay đổi liên repo được kiểm soát ở tầng system, không chỉ ở repo con

## 12. Đề xuất thứ tự làm

Nếu làm theo giá trị cao nhất trước, tôi đề xuất:

1. chuẩn hóa ownership + toolchain bootstrap
2. dựng `la` CLI hệ thống
3. đưa preflight/test/build gates lên trước deploy
4. refactor local deploy sang partial/dev mode
5. refactor server deploy sang artifact + key-based SSH
6. hoàn thiện backup/restore và post-deploy verify

## 13. Acceptance Criteria cuối cùng

- người mới clone workspace có thể chạy `la doctor` và biết thiếu gì trong dưới 5 phút
- contributor có thể build/test từng repo và build/test ở tầng system bằng command thống nhất
- local deploy có mode dev và partial restart chính thức
- server deploy có preflight, artifact, verify, rollback
- backup/restore có manifest và runbook
- không còn phụ thuộc chủ yếu vào tri thức ngầm nằm trong nhiều shell script rời rạc
