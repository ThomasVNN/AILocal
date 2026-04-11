# Legacy Area

- `legacy/unified-stack/`: stack cũ kiểu one-layer, gồm compose/config/state/script lịch sử.
- `legacy/quarantine/`: dữ liệu thô hoặc nhạy cảm không thuộc deploy/runtime chuẩn.

Quy tắc:
- Không dùng khu vực này làm điểm vào mặc định.
- Nếu cần tra cứu hoặc rollback thủ công, đọc `docs/WORKSPACE_STRUCTURE.md` trước.
