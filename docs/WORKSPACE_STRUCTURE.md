# Workspace Structure

## Mục tiêu
- Root chỉ còn các nhóm có vai trò rõ ràng: `active`, `runtime`, `legacy`, `artifacts`.
- Deploy chuẩn 2-layer phải dễ nhận ra và không bị lẫn với compose/script cũ.
- Cleanup phải ưu tiên an toàn vận hành hơn là dọn cho sạch bằng mọi giá.

## Top-level layout hiện tại
- `deploy/`: compose + env mẫu + script cho stack 2-layer đang dùng.
- `ops/`: entrypoint triển khai local/server.
- `docs/`: tài liệu vận hành.
- `.localagent-data/`: runtime data root hiện đang được container local mount.
- `OmniRoute/`, `openclaw/`, `open-webui/`, `claude-code/`: source active, được track trực tiếp bởi root repo `AILocal`.
- `OmniRoute-merge/`: merge sandbox/experimental clone, hiện không thuộc deploy path.
- `legacy/unified-stack/`: legacy one-layer stack gồm compose/config/state/script cũ.
- `legacy/quarantine/`: dữ liệu thô không nên nằm ở root active.
- `artifacts/images/`: tar image + tar data snapshot.
- `artifacts/backups/`: backup/snapshot lịch sử.

## Những gì đã được tái cấu trúc
1. Gom toàn bộ unified-stack cũ từ root vào `legacy/unified-stack/` để giữ nguyên bundle tương đối đầy đủ nhưng không lẫn với stack đang chạy.
2. Gom backup và image tar vào `artifacts/` thay vì để chiếm root.
3. Chuyển `autocheck/` vào `legacy/quarantine/` vì đây không phải source/runtime vận hành và chứa raw capture nhạy cảm.
4. Xóa generated output đã xác nhận an toàn:
   - `OmniRoute/.next`
   - `OmniRoute/node_modules`
   - `OmniRoute/app/.next`
   - `OmniRoute/app/node_modules`
   - `OmniRoute/logs`
   - `OmniRoute/app/logs`
   - `OmniRoute/*.tgz` build outputs
   - `OmniRoute-merge/node_modules`
   - `OmniRoute-merge/logs`
   - `.DS_Store`, orphan `manifest.json`

## Risk Guardrails
- Không di chuyển `deploy/`, `ops/`, `docs/`, `.localagent-data/` vì đây là contract của stack đang chạy.
- Không biến `OmniRoute/`, `openclaw/`, `open-webui/`, `claude-code/` trở lại thành nested repo/submodule nếu mục tiêu vẫn là root repo track full source.
- Không di chuyển `OmniRoute-merge/` vì repo này đang có local modification; chỉ dọn generated output.
- Legacy data không bị xóa mù quáng; chỉ cô lập sang `legacy/` hoặc `artifacts/`.
- Runtime đang chạy được xác nhận mount từ `.localagent-data/`, không mount các thư mục root legacy vừa được dời đi.

## Acceptance Criteria
- Root không còn chứa lẫn compose/config/state của stack cũ với stack 2-layer hiện tại.
- `ops/agent.sh deploy local` và `deploy/scripts/stack.sh` vẫn dùng đúng `deploy/layer1-platform` và `deploy/layer2-apps`.
- Container localagent đang chạy vẫn healthy sau cleanup.
- Legacy script/data vẫn còn để tra cứu hoặc rollback thủ công, nhưng không còn cạnh tranh với đường đi active.
- Generated output lớn, không phải source thật, đã được dọn khỏi repo con để giảm noise và dung lượng.

## Kiểm tra nhanh sau thay đổi
```bash
bash ops/audit_workspace.sh
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

## Dọn tiếp trong tương lai
- Chỉ xóa `artifacts/` sau khi xác nhận không cần rollback/restore.
- Nếu muốn sạch hơn nữa, bước tiếp theo hợp lý là đánh dấu rõ `OmniRoute-merge/` là experimental hoặc di chuyển nó sau khi local edits được xử lý xong.
- Không tái đưa compose/config của stack cũ ra root.
