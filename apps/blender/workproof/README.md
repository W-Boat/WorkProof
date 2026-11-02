# WorkProof Blender extension

Structure checkpoints additionally commit to object parenting, world transforms,
data identity, and modifier identities/order/type/visibility. Only the
domain-separated `workproof-blender-structure-v1-sha256` digest is transmitted;
the structure, pointer identities and coordinates stay in transient main-thread
memory. The Rust event chain and final artifact hashing still use BLAKE3.
Pointers identify state within one running session, not persistent identities.
This detects same-count edits and same-type modifier reordering but does not
reconstruct a full graph, capture arbitrary modifier parameters, or fingerprint
same-count mesh coordinate changes. Limits are 50000 objects, 200000 modifiers
and 16 MiB serialized structure; exceeding them pauses recording. These are
input limits, not an operating-system memory sandbox. Idle viewport polling
does not traverse this structure. Real Blender/collector Actions acceptance is
required for each implementation revision.

This Blender extension distribution is provided under the GNU General Public
License, version 3 or (at your option) any later version. See `COPYING` for the
full terms. You may use it commercially, modify it, and redistribute it under
those terms; recipients retain the rights the GPL grants them.

Copyright (c) 2026 WorkProof contributors.

The original WorkProof source is also available under the MIT permission grant
in `MIT-LICENSE.txt`; that grant and its copyright notice are preserved. The
Blender extension package selects GPL-3.0-or-later as stated in its manifest.
Do not use the MIT alternative to claim that a distributed Blender API add-on
has been cleared for proprietary distribution.

This archive includes the complete editable Python source and its manifest.
It includes no Blender binaries, Office.js, WPS SDK, third-party Python packages,
or local credentials. It communicates with the separately installed WorkProof
collector using a documented local HTTP API. Licenses for the collector and
other product components must be evaluated separately.

Install using Blender's extension installation from disk (Blender 4.2 or later).
Open View3D > Sidebar > WorkProof and explicitly start recording a saved project.
The extension collects aggregate mesh statistics, undo/redo, saves and sampling
gaps. Visible viewport rotation, pan, zoom and perspective are sampled once per
second on the main thread. Only a cumulative count of changed sampling intervals
is exported, never rotations, positions, camera settings or pixels. Changes during
pause, new viewports and closed viewports do not increment this count. Multiple
movements within an interval may be missed or combined; the count is not an exact
number of gestures or evidence of human authorship. Full modifier parameters are
not collected. Export
saves the current `.blend` and creates a `.blend.wproof` alongside it.

A valid signature establishes integrity and file binding, not human identity,
trusted time or the absence of AI. This package has not been submitted to, or
approved by, the Blender Extensions platform. Platform publication has further
requirements beyond the license manifest.

Sources:
- https://github.com/W-Boat/WorkProof/tree/codex/workproof-mvp/apps/blender/workproof
- https://www.blender.org/about/license/
- https://extensions.blender.org/terms-of-service/
- GPLv3 text: https://www.gnu.org/licenses/gpl-3.0.txt


### 可选的对象关系补充

开始记录前勾选“导出对象关系与修改器顺序”，会在工程旁另外生成 `.wgraph`。它只包含本次会话内的数字标识、对象父子关系与修改器顺序，不含对象名称、坐标或网格内容；该关系本身可能揭示作品组织方式，请按需分享。默认关闭，不改变原有摘要采集方式。开启后每次结构快照通过本机 Rust 引擎计算版本化 BLAKE3 摘要，并绑定到对应事件；只有服务器确认事件已写入，快照才进入补充文件。旧版 SHA-256 结构摘要不能还原成此文件。

每会话最多 128 个快照、每快照 10000 个节点、合计 50000 个节点，文件最多 8 MiB。超过限制会暂停并提示，不静默删除快照。用 `workproof-engine inspect-evolution FILE.wproof FILE.wgraph` 可检查完整或选择性披露证书中的已披露快照；选择性证书须包含补充文件引用的全部事件。检查不覆盖未披露的历史，也不认证身份、真实时间或人类创作。

节点标识只用于同一录制会话内比较。对象优先使用 Blender 提供的 `ID.session_uid`，不可用时按相邻快照中仍存在的运行时地址延续；修改器按所属对象与相邻快照中仍存在的地址延续。已观测到离开的节点标识会退役，新的标识单调分配、不重复使用。两次采样之间发生、且未被观察到的删除重建，在地址降级或修改器路径下可能无法区分，因此不把标识当作持续身份凭据。结构深度最多 256 层，容量或结构错误会暂停采集，已有且成功提交的记录仍可导出。

为避免普通编辑很快耗尽结构补充容量，只有匿名节点的父子关系、类型或顺序发生变化时，`mesh` 事件才另外保存图快照；开始和继续记录仍明确保存快照。只修改坐标、顶点内容等但匿名节点结构未变时，事件继续绑定原有 SHA-256 私有结构摘要，不增加图快照或请求图摘要 RPC。快照容量只在新图成功进入待提交队列后预留；网络重试继续使用同一份节点与摘要，不重新采集。

对象节点按本次会话的匿名数字标识排序，同层 `order` 只提供稳定的显示顺序，不表示 Blender Outliner 的完整排列，也不根据对象名称派生关系。修改器的 `order` 仍按宿主中的实际修改器顺序记录。对象改名不会单独生成新的关系图；其采集事件仍走原有摘要路径。
