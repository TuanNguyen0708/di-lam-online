# ĐI LÀM ONLINE — Công sở bất ổn

Đi làm đã mệt, lên live còn mệt hơn!

Vertical slice chạy được: văn phòng 3D stylized bằng Three.js (7 khu vực, nhân vật có khung xương + biểu cảm, NPC tự hoạt động, VFX, âm thanh tổng hợp), nhân viên riêng cho từng người xem, sếp có HP, 16 lệnh comment, Drama Meter, chuỗi HR/drama, vote, vòng 5 phút, simulator và dashboard Game Master. Sân khấu dọc dành riêng cho OBS. **Không phải toàn bộ roadmap bốn tuần đã hoàn thiện.**

## Chạy ngay trên Windows

Yêu cầu Node.js >=22.18 và pnpm 10.34.5. Không cần Docker để chơi thử.

```powershell
cd "D:\Z. TuanND\live-stream\di-lam-online"
pnpm.cmd install
pnpm.cmd dev
```

Trong terminal không bị chặn ExecutionPolicy có thể dùng `pnpm dev` như bình thường. `pnpm dev` tự tạo `.env` với token ngẫu nhiên, không ghi đè token đã có.

1. Mở dashboard: `http://localhost:5174`.
2. Lấy `ADMIN_TOKEN` từ `.env`, dán vào **Quyền Game Master → Mở quyền điều khiển**. Token chỉ lưu ở sessionStorage của tab, không đưa vào link stage.
3. Bấm **Chạy demo 10 nhân viên**. Demo tự gửi các lệnh mỗi 1,4 giây, luôn được gắn nhãn simulator; đóng dashboard sẽ dừng auto demo.
4. Bấm **Tung drama** để mở bình chọn ngay. Dùng `vote dinhcong` hoặc `vote lamviec`.
5. Thử comment bằng simulator. `ID nhân viên`, không phải tên hiển thị, quyết định danh tính.

API dùng cổng **3101**, web dev **5174**; không chiếm cổng 3000 của `di-chua-online`. Nếu thay PORT, cập nhật proxy trong `apps/game-web/vite.config.ts` cùng lúc. Mặc định chỉ bind loopback.

## Phát livestream an toàn

Chạy `BAT-LIVE.bat` hoặc:

```powershell
pnpm.cmd run setup
pnpm.cmd build
pnpm.cmd start
```

- Dashboard production: `http://localhost:3101`.
- OBS Browser Source / TikTok LIVE Studio Link: `http://lvh.me:3101/?view=stage` (hoặc `http://127.0.0.1:3101/?view=stage`).
- Width **1080**, height **1920**. Văn phòng 3D chiếm **75% chiều cao sân khấu**; drama và hướng dẫn lệnh được thu gọn. Stage tự co theo tỷ lệ 9:16, không có nút admin. Không chừa khoảng trống lớn phía dưới; bố trí comment TikTok bằng OBS khi cần.
- Bật tăng tốc đồ họa / WebGL 2 trong Chrome hoặc OBS. Nhân viên có tên riêng hiển thị bằng HTML. Mọi nhân viên trong snapshot (tối đa 50 người tương tác gần nhất, `LIMITS.visible`) có mặt cùng lúc — không chia tầng; 12 người đầu ngồi bàn, những người còn lại làm việc đứng và nhận bàn khi có bàn trống. Gõ đúng lệnh là nhân vật của chính người đó thực hiện (ưu tiên hơn cảnh nền; lệnh gõ dồn sẽ xếp hàng tối đa 3); lệnh bị từ chối (cooldown, hết năng lượng) thì nhân vật nói lý do.
- Bản production không hot reload, nên chỉnh source không làm mất trạng thái sân khấu. Không build/restart server trong khi đang live. Backend dừng thì stage hiển thị mất kết nối và tự nối lại khi server trở lại.
- Âm thanh **mặc định tắt**. Bật ở dashboard (*Hiệu ứng sân khấu → Âm thanh*) hoặc thêm `&sound=1` vào link stage. Toàn bộ SFX và nhạc nền được tổng hợp bằng Web Audio (không dùng file âm thanh bên ngoài). Trình duyệt thường chỉ phát sau thao tác người dùng; OBS Browser Source có thể cho phép autoplay nhưng **chưa được kiểm chứng** trong repo này. Chưa tích hợp TTS.
- Tham số stage khác: `&cam=follow` (camera theo dõi nhân vật vừa hành động), `&quality=auto|high|medium|low`, `&debug=1` (FPS, draw calls, bộ nhớ).
- Nhập tài khoản đang LIVE tại dashboard. Không đưa token vào OBS, không nhập mật khẩu/cookie TikTok.

**TikTok adapter vẫn là thử nghiệm**: tái sử dụng cách xử lý của repo gốc với `tiktok-live-connector@2.5.0`, `content` của proto v3, `user.id` ổn định, `enableExtendedGiftInfo:false`; không phát lại initial chat. Cumulative gift streak được tính phần tăng thêm và bỏ final trùng. Ưu tiên `groupId`/`repeatId`; nếu nhà cung cấp không gửi ID streak, fallback không phân biệt được hai chuỗi quà chồng nhau của cùng người/cùng loại. Adapter thử reconnect tối đa 5 lần với backoff; kết thúc LIVE hoặc bấm ngắt sẽ hủy reconnect. Kết nối thật phụ thuộc tài khoản, vùng, giao thức và dịch vụ ký của connector. Simulator chạy độc lập, **không có cam kết đã xác minh LIVE thật**. Xác minh điều khoản và quyền sử dụng dữ liệu trước khi đưa vào vận hành.

## Gameplay

| Comment | Hành động | Năng lượng | Cooldown |
| --- | --- | --- | --- |
| `damsep` | Chạy đến đấm sếp, tăng drama | 12 | 5 giây |
| `dapban` | Rung bàn, tăng combo | 8 | 3 giây |
| `tangluong` | Xin tăng lương ảo; cần 80 XP để được duyệt | 15 | 30 giây |
| `nghiviec` | Rời sân khấu, giữ hồ sơ | 0 | — |
| `bocphot` | Tung bằng chứng sếp ăn vụng | 10 | 12 giây |
| `vote dinhcong` / `vote lamviec` | Một phiếu mỗi danh tính, đổi ý được | 0 | Chỉ giai đoạn vote |
| `cafe` | +25 năng lượng | 0 | 15 giây |
| `lamviec` | +12 XP, +30 lương ảo | 5 | 5 giây |
| `cuu` | +quan hệ, tiếp năng lượng đồng nghiệp ít năng lượng nhất | 8 | 10 giây |
| `tat` | Tát đồng nghiệp vừa hoạt động gần nhất (+6 drama) | 6 | 6 giây |
| `nem` | Ném tập tài liệu về phía sếp (+5 drama) | 6 | 6 giây |
| `cai` | Cãi nhau tay đôi, đồng nghiệp kéo tới hóng (+7 drama) | 5 | 8 giây |
| `ngu` | Ngủ gật tại bàn, +15 năng lượng (+2 drama) | 0 | 20 giây |
| `nhay` | Khiêu vũ giữa văn phòng (−6 drama) | 4 | 10 giây |
| `tanghoa` | Tặng hoa đồng nghiệp, +5 năng lượng cho người nhận (−8 drama) | 5 | 10 giây |

**Drama Meter (server-authoritative, 0–100%)**: các lệnh gây chuyện cộng điểm, lệnh tích cực trừ điểm; tự giảm ~0,6%/giây. Mốc 25% → nhân viên tụ tập hóng chuyện; 50% → trưởng phòng ra can thiệp; 75% → giám đốc nổi giận; 100% → cả văn phòng hỗn loạn (báo động, chạy loạn, giấy bay), sau đó giảm nhanh 4%/giây đến dưới 25%. Mỗi mốc chỉ kích hoạt lại khi meter đã xuống thấp hơn mốc 10 điểm.

**Quà**: x1–9 tặng hoa + giấy màu; x10–29 tiệc sinh nhật bất ngờ; ≥x30 diễn tập báo cháy. Quà vẫn chỉ tạo hiệu ứng, không đổi chỉ số. Follow: thang máy mở, nhân viên vẫy tay chào. Comment không phải lệnh của nhân viên đang ở trong phòng: nhân vật nói một câu thoại tiếng Việt soạn sẵn (không hiển thị nội dung comment thô).

- Vòng: làm việc → sếp gây chuyện → vote → đại chiến → kết quả, mỗi đoạn 60 giây. Đồng hồ dừng khi pause; downtime không tự cộng XP. Sát thương cao hơn trong đại chiến; phe đình công thắng vote thì cả phòng được buff và tự phản công theo nhịp 5 giây.
- Chuỗi: 5 lần đập bàn → HR cảnh cáo → đồng nghiệp dùng `cuu` → sếp nổi giận → vote đình công → boss fight → thưởng cả phòng.
- 4 kịch bản luân phiên. Boss xuống 0 HP chỉ thưởng đúng một lần/vòng. Mỗi 5 giây nhân viên có mặt nhận ít lương, XP và hồi năng lượng.
- 6 chức vụ dựa trên XP; phiên bản này chức vụ là tiến trình và nhãn hiển thị, **chưa có kỹ năng riêng cho từng chức vụ/bầu cử CEO**. Quan hệ hiện là chỉ số cứu đồng nghiệp, chưa có hệ thống bạn bè/phe phái.
- Mỗi 500 tim tiếp 10 năng lượng cho cả phòng. Follow hiện thông báo chào đón. **Quà chỉ tạo hiệu ứng (hoa, tiệc sinh nhật, diễn tập báo cháy), không sát thương, XP, chức vụ hay lợi thế bình chọn.** Mọi lương/vật phẩm là tiền ảo, không mua bán/đổi tiền thật.

## Trợ lý giọng nói & tự động (panel "Trợ lý giọng nói & tự động" trên dashboard)

Cài đặt do server giữ và lưu cùng trạng thái phòng (reset phiên vẫn giữ cài đặt). Tham khảo luồng của `di-chua-online`.

**Vào phòng**: không có chấm công hay lệnh `join`. Người xem vào LIVE (sự kiện TikTok `member`) là xuất hiện ngay trong văn phòng — tại bàn nếu còn bàn, không thì đứng làm việc — kèm lời chào. Comment trước khi sự kiện vào phòng tới cũng đưa người đó vào phòng. Ai không gõ lệnh nào trong 15 phút thì tự rời phòng (TikTok không báo khi người xem thoát LIVE); comment lại là quay vào.

| Cài đặt | Mặc định | Tác dụng |
|---|---|---|
| Nhân viên ảo (NPC) | Bật | 5 đồng nghiệp ảo, có nhãn **NPC** và được đếm riêng (`3/3 NV +5 NPC`). Sếp và Trưởng phòng luôn có mặt. |
| Tự đọc trên sân khấu | Bật | Chỉ trang `/?view=stage` phát tiếng (thêm `&voice=0` để tắt ở một nguồn). Nếu trình duyệt chặn tự phát, sân khấu hiện nút bấm để bật. |
| Chào người mới | Bật | Mỗi người được chào một lần mỗi phiên, tối đa 3 tên mỗi câu, cách nhau ≥ 4 giây. Mẫu câu chỉnh được (`{names}` bắt buộc, `{company}` tùy chọn). |
| Cảm ơn quà / follow | Bật | Cảm ơn quà được đọc trước các câu khác, mỗi người tối đa 1 lần / 30 giây; follow 1 lần mỗi phiên. |
| Nhắc chia sẻ | 10 phút | 0 = tắt; kèm cảm ơn những người vừa tương tác. |
| Giọng / tốc độ / tên công ty | Nữ · 1.0x | Tên công ty hiện trên sân khấu và trong lời chào. Có ô **Đọc ngay** và các nút **Nghe thử**. |

Giọng đọc dùng **Microsoft Edge neural TTS** (`msedge-tts`, giọng `vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`), dự phòng Google Translate TTS — **cần internet và gửi câu đọc (gồm tên người xem) tới các dịch vụ đó**. `GET /api/tts/:id` chỉ đọc các câu do chính server tạo (không phải proxy TTS mở). API quản trị: `POST /api/admin/settings`, `POST /api/admin/speak` (`{ text }` hoặc `{ sample: 'greet' | 'gift' | 'follow' | 'share' }`).

## PostgreSQL + Redis / BullMQ

Mặc định URL để trống = **memory**: restart sẽ mất hồ sơ. Chọn durable mode trước buổi live có tính thành tích.

```powershell
pnpm.cmd run setup
docker compose up -d postgres redis
```

Trong `.env`, lấy mật khẩu đã sinh ở `POSTGRES_PASSWORD` rồi điền cả hai URL:

```dotenv
DATABASE_URL=postgresql://office:YOUR_POSTGRES_PASSWORD@127.0.0.1:5434/office
REDIS_URL=redis://127.0.0.1:6381
```

Restart API. Không cấu hình nửa chừng: có một URL mà thiếu URL còn lại thì server báo lỗi. Không tự fallback memory khi database lỗi.

- PostgreSQL tự tạo `game_rooms` (snapshot JSONB chứa player/stats/role/cooldown/vote/dedupe) và `game_events` (metadata sự kiện, không lưu raw comment). Snapshot và nhật ký cùng transaction; database lỗi thì rollback game trong bộ nhớ, không xác nhận thưởng chưa lưu.
- Redis/BullMQ nhận input với một worker/room, retry tối đa 3 lần, bỏ sự kiện quá 2 phút. Snapshot/dedupe phục hồi sau restart; job và event có cửa sổ giữ 10 phút/tối đa 20.000 ID, **không bảo đảm exactly-once vô thời hạn**. Event audit dọn quá 7 ngày khi khởi động.
- PostgreSQL advisory lock ngăn hai API cùng điều khiển một room. Không chạy nhiều replica của cùng room; đây là single-room MVP. Tick lưu mỗi giây; tối đa khoảng một tick chưa commit có thể mất khi kill process. Game pause và cooldown được giữ trong snapshot.
- Snapshot gộp là lựa chọn MVP để tránh dựng 9 bảng chưa cần. Tách players/stats/session/leaderboard khi cần truy vấn lịch sử và phân tích đa phòng. Hiện không có migration framework, không có bảng thành tích liên phiên độc lập.
- Volume Docker giữ dữ liệu; đừng dùng `docker compose down -v` nếu muốn giữ thành tích. Đổi mật khẩu `.env` không tự đổi mật khẩu của volume PostgreSQL đã tạo.

Chạy toàn bộ bản build trong Docker:

```powershell
docker compose --profile live up -d --build
```

Dashboard và stage ở cổng 3101. Không chạy đồng thời API local và container cho cùng room. Cổng DB/Redis chỉ expose trên `127.0.0.1`. Cấu hình hiện dành cho một máy Windows, chưa harden để public Internet; cần TLS, chính sách origin đúng domain, quản lý secret và reverse proxy trước khi public.

## Kiến trúc và kiểm thử

```text
apps/game-web/                 React + Vite, dashboard, Three.js OfficeScene
apps/game-web/src/game/engine3d/
  world.ts       Văn phòng 3D: 12 bàn, phòng giám đốc, pantry, phòng họp, lounge, góc photocopy, thang máy + bảng nội quy
  character.ts   Nhân vật procedural (khung xương 13 khớp, biểu cảm, đạo cụ) + animator blend locomotion/sit/action + look-at
  clips.ts       ~40 clip keyframe (đấm, tát, đập bàn, ném, cãi, uống, gõ phím, ngủ gục, nhảy, ngã…) có sự kiện đồng bộ âm thanh/VFX
  director.ts    AI hành vi (generator ưu tiên, ngắt được), biên đạo hành động, chuỗi sự kiện, phản ứng Drama Meter/phase
  nav.ts         Lưới điều hướng A* + làm mượt đường đi
  vfx.ts         Particle 1 draw call (atlas vẽ bằng code) + giấy bay vật lý (InstancedMesh) + vũng cà phê
  audio.ts       SFX + nhạc nền tổng hợp Web Audio, suy giảm theo khoảng cách
  presentation.ts Camera (tổng quan/theo dõi/focus/rung) + lớp nhãn HTML (tên, bong bóng thoại, chữ comic)
apps/game-api/src/engine.ts     Luật game đồng bộ, server-authoritative
apps/game-api/src/tiktok*.ts    Adapter + normalizer riêng, test được không cần live
apps/game-api/src/store.ts      PostgreSQL snapshot transaction + room lock
apps/game-api/src/game.service.ts  Serial writer + BullMQ + clock
packages/shared/               Types, command config, parser và validation
scripts/simulate.mjs            Load simulator giới hạn nhịp gửi
tests/                         node:test + assert; không thêm test framework
postman/specs/office.yaml       REST contract
postman/collections/            Collection sinh từ contract và smoke assertions
```

Luồng: TikTok/simulator → validate/normalize → dedupe → cooldown/năng lượng → engine → persist → publish snapshot → Three.js. Socket chỉ render; client không được cộng XP hoặc gửi boss damage. Public `game:state` gửi 5 lần/giây và khi connect/reconnect, tối đa 50 nhân vật + 15 effect. Giao thức MVP dùng snapshot thay vì triển khai thêm 10 delta-event có thể lệch khi reconnect. Admin socket `admin:pause`, `admin:resume`, `admin:trigger-drama` dùng `handshake.auth.token`. Các mutation HTTP đều yêu cầu Bearer token và rate limit 120 request/giây/IP. API contract mô tả mã lỗi; gameplay từ chối trả HTTP 200 với `ok:false`.

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd build
# API phải đang chạy; test tạo một nhân viên riêng, không reset phòng
pnpm.cmd test:api
pnpm.cmd simulate 50 1000
# Hoặc phòng đông: pnpm.cmd simulate 1000 5000
postman spec lint postman/specs/office.yaml --issueType=syntax
postman collection run "postman/collections/Di Lam Online" --no-report-events -i "api/Read process health and storage mode" -i "api/Get a snapshot, at most 50 employees and 15 recent effects"
```

Load script in số action hợp lệ/từ chối, HTTP error và p95 thời gian xác nhận; không giả lập độ trễ TikTok và không đo FPS. Cooldown từ chối là bình thường. Cap 2.000 hồ sơ/room, 2.000 input chờ; 50 sprite, 15 animation đồng thời. Danh sách hiển thị ưu tiên người vừa hành động. Chưa kiểm chứng thực tế 1.000 viewer trên phần cứng livestream của bạn. Tên hiển thị bỏ control/markup/URL và giới hạn chiều dài; không hiển thị raw comment. **Chưa có bộ lọc từ tục theo ngữ cảnh tiếng Việt**; cần bổ sung danh sách/moderation trước public live.

## Tài nguyên và phạm vi tiếp theo

Nội thất và nhân vật 3D tự dựng bằng Three.js, font đóng gói cục bộ; không copy ảnh/3D/âm thanh của Đi Chùa Online hoặc các ảnh tham khảo chưa rõ giấy phép. Lưu ý package connector được cài khai báo `AGPL-3.0-only`; kiểm tra nghĩa vụ giấy phép của dependency trước khi phân phối/chạy dịch vụ. Chưa chọn giấy phép cho source mới thay bạn.

Chưa có: TTS/âm thanh, sprite-sheet walk/cry/resign hoàn chỉnh, AI boss, bạn bè/phe phái, bầu cử CEO, cửa hàng trang phục, bảng xếp hạng ngày, multi-room, tự đăng nhập TikTok hay đảm bảo được cấp quyền phát LIVE. Animation hiện là sprite procedural + tween và hiệu ứng nhóm có giới hạn, đủ để thử cảm giác chơi vertical slice trước khi đầu tư asset chính thức.
