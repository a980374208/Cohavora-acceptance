import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const counts = values => Object.entries(values).map(([status, count]) => `${status} ${count}`).join('；');
const tally = rows => rows.reduce((result, row) => ({...result, [row.status]: (result[row.status] ?? 0) + 1}), {});
const scopedStatus = values => values.length > 0 && values.every(value => value === 'PASS') ? 'PASS_SCOPED' : 'PARTIAL';
const number = (value, digits = 3) => {
  assert.ok(Number.isFinite(value), 'Missing recorded measurement');
  return Number(value.toFixed(digits)).toLocaleString('zh-CN', {maximumFractionDigits: digits});
};

/** Read existing terminal results only. This view neither executes nor rejudges tests. */
export async function buildCompletedResults(root) {
  const names = ['functional-media-retest-20261020-01', 'resource-completion-20261020-01', 'resource-completion-20261021-01'];
  const sources = [];
  const reports = [];
  for (const name of names) {
    const json = `reports/product/${name}.json`;
    const bytes = await fs.readFile(path.join(root, json));
    const report = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    sources.push({json, html: json.replace(/\.json$/, '.html'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), updated_at: report.updated_utc, status: report.status});
    reports.push(report);
  }
  const [functional, previous, latest] = reports;
  const rows = [];
  const find = (values, id) => {
    const value = values.find(item => item.id === id);
    assert.ok(value, 'Missing recorded result: ' + id);
    return value;
  };
  const batch = family => {
    const value = functional.latest_batches.find(item => item.family === family);
    assert.ok(value, 'Missing recorded batch: ' + family);
    return value;
  };
  const followup = id => {
    const value = find(latest.followup_results, id);
    assert.equal(value.terminal, true, 'Only terminal attempts belong in the completed view');
    return value;
  };
  const add = (id, category, title, status, measured, boundary, source, field) => rows.push({id, category, title, status, measured, boundary, source, field});
  for (const [family, title] of [['b01-uia', '界面流程与白板文件 UIA'], ['b02-files', '文件传输与上传场景']]) {
    const value = batch(family);
    add(family, '功能与编码', title, value.status, counts(value.observed_status_counts), '10-20 原批次范围；不替代后续主题切换、系统偏好往返和 UI 导出复测。', 0, `latest_batches[family=${family}]`);
  }
  const io = previous.entries.io;
  add('controlled-io', '功能与编码', '受控真实 I/O', io.status, counts(tally(io.checks)), '磁盘满恢复、oplock 打开取消、诊断 sink 进程退出三项；不代表全部设备故障。', 1, 'entries.io.checks');
  const codec = find(latest.entries.reuse.checks, 'codec-matrix-policy');
  add('codec-reuse', '功能与编码', '编码、选层与回退', codec.status, `${codec.cases} 项按影响范围复用`, '复用原输入对应的结果；本轮没有新增编码矩阵，也未覆盖未具备的厂商硬件。', 2, 'entries.reuse.checks[id=codec-matrix-policy]');
  const audio = find(latest.entries.reuse.checks, 'audio-lifetime-direct');
  add('audio-lifetime-reuse', '功能与编码', '音频引用链直接测试', audio.status, `${audio.tests} 项按影响范围复用`, '直接 lifetime 断言；不代替真实独立音源、声学或跨 SDK 音频内容验证。', 2, 'entries.reuse.checks[id=audio-lifetime-direct]');
  const nativeE2ee = functional.current_observations.filter(item => item.plan_mapping.some(mapping => mapping.plan_code === 'P06'));
  assert.ok(nativeE2ee.length > 0);
  const nativeCounts = tally(nativeE2ee.map(item => ({status: item.current_status})));
  add('native-e2ee', '功能与编码', 'Native E2EE 协议、安全与媒体', Object.keys(nativeCounts).every(status => status === 'PASS') ? 'PASS_SCOPED' : 'PARTIAL', counts(nativeCounts), '10-20 当前逐 case 投影；同机进程、性能与安全场景按各自原结果解释，不代替后续跨 SDK 失败项或完整 P06。', 0, 'current_observations[plan_mapping.plan_code=P06]');
  const scope = functional.e2ee_scope_evidence;
  add('native-e2ee-scope', '功能与编码', 'Native 三端、ABBA 与共同 600 秒', scopedStatus([scope.native_three_peer.status, scope.abba_performance.status, scope.common_600_seconds.status]), `三逻辑端 ${scope.native_three_peer.status}；ABBA ${scope.abba_performance.status}；共同 ${scope.common_600_seconds.verified_seconds} 秒 ${scope.common_600_seconds.status}`, 'ABBA 与共同 600 秒引用同一批性能证据，不重复计数；三端为同机三个独立 Native 进程。', 0, 'e2ee_scope_evidence');

  const wgc = find(latest.entries.wgc_lifecycle.checks, 'wgc-3600-100');
  add('wgc-lifecycle', '屏幕、白板与资源', 'WGC 生命周期原长门', wgc.status, `${number(wgc.elapsed_seconds)} 秒；${wgc.cycles} 轮`, '原 3600 秒／100 轮门；不扩展到其他采集后端、设备或显示拓扑。', 2, 'entries.wgc_lifecycle.checks[id=wgc-3600-100]');
  const six = followup('wgc-1800-six-resources');
  const resources = six.resource_analysis;
  add('wgc-six-resources', '屏幕、白板与资源', 'WGC 原 1800 秒六资源门', six.status, `${resources.sample_count} 个资源样本；${counts(tally(Object.values(resources.resource_checks)))}`, '同 run 的原资源分析通过；生成图案与 WDDM 计数不等于主观画质或 DXGI 预算验证。', 2, 'followup_results[id=wgc-1800-six-resources].resource_analysis');
  for (const [id, title] of [['capture-desktop11-dxgi02', 'DXGI 全屏采集'], ['capture-quality-fullscreen-unblocked01', '复杂 WGC 全屏质量'], ['whiteboard-functional-desktop11', '白板协同功能']]) {
    const value = followup(id);
    const checks = value.cells.reduce((sum, cell) => sum + Object.keys(cell.checks ?? {}).length, 0);
    const boundary = id === 'whiteboard-functional-desktop11' ? '三个独立 Coordinator 进程，经真实 SFU 和 Qt 投影、独立 PNG 像素验证；不代表三个物理终端或原 1800 秒协同负载通过。' : '仅实际后端和场景的原采集、接收、质量及清理检查；不覆盖双屏、跨 DPI/GPU 或主观画质。';
    add(id, '屏幕、白板与资源', title, value.status, `${counts(tally(value.cells))}${checks ? `；${checks} 项原检查` : `；${value.cells.length} 个独立场景`}`, boundary, 2, `followup_results[id=${id}]`);
  }
  const annotation = followup('annotation-runtime-04');
  add(annotation.id, '屏幕、白板与资源', '批注 M0 探针', annotation.status, '原 M0 子门通过', '仅自有 ProbeOverlay；完整产品 overlay、真实 IME 候选框、跨 DPI 和主观对齐仍未证明。', 2, 'followup_results[id=annotation-runtime-04]');
  const windows = previous.entries.capture_backends.checks.filter(item => ['wgc-window', 'gdi-window', 'complex-wgc-window', 'complex-gdi-window', 'cost-wgc-window', 'cost-gdi-window'].includes(item.id));
  assert.equal(windows.length, 6);
  add('capture-windows', '屏幕、白板与资源', 'WGC／GDI 窗口场景与成本采集', scopedStatus(windows.map(item => item.status)), counts(tally(windows)), '10-20 六个独立格；一个进程内两个 Native Room。成本数据采集完整不等于满足未声明的成本预算。', 1, 'entries.capture_backends.checks[window cases]');
  const gdi = find(previous.entries.capture_backends.checks, 'gdi-hot-50');
  add(gdi.id, '屏幕、白板与资源', 'GDI 50 轮热切换', gdi.status, gdi.detail, '沿用原功能判据；不授予 WGC 或 GDI 长时资源预算通过。', 1, 'entries.capture_backends.checks[id=gdi-hot-50]');
  const telemetry = followup('telemetry-9000s');
  const long = telemetry.result_summary.long_resource_gate;
  add('telemetry-resource', '屏幕、白板与资源', '遥测原 ≥9000 秒资源门', telemetry.status, `${number(long.duration_s)} 秒；${long.samples} 样本；最大间隔 ${number(long.maximum_gap_s)} 秒；Private Bytes 增长 ${number(long.private_growth_mib)}／${long.limits.private_growth_mib} MiB`, '仅该次资源子门通过；下方 OFF/ON callback P99 性能失败仍保留。', 2, 'followup_results[id=telemetry-9000s].result_summary.long_resource_gate');
  const lifecycle = latest.entries.telemetry_lifecycle.checks;
  const uia = find(lifecycle, 'uia-interference');
  const residual = find(lifecycle, 'residual-growth');
  add('telemetry-lifecycle', '屏幕、白板与资源', '遥测 UIA 干扰及同进程释放', scopedStatus([uia.status, residual.status]), `UIA ${uia.rounds} 轮 ${uia.status}；同进程 ${residual.cycles} 轮 ${residual.status}；Private Bytes 残留增量 ${number(residual.residual_delta.private_bytes / 1048576)} MiB`, '两个独立子门分别判定；不能据此消除性能门失败或推定所有生命周期场景通过。', 2, 'entries.telemetry_lifecycle.checks');

  const network = latest.entries.network_runtime;
  const originalNetwork = network.checks.filter(item => item.id !== 'turn-relay-independent-retry');
  assert.equal(originalNetwork.length, 10, 'Keep the independent TURN retry outside the original ten-case batch');
  add('network-batch', '网络与互通', '网络与认证原十项批次', network.status, counts(tally(originalNetwork)), '原 TURN 失败保留；九项通过与独立 TURN 复测不拼接为一次整批 PASS。', 2, 'entries.network_runtime.checks[excluding turn-relay-independent-retry]');
  const turn = network.turn_retry;
  add('turn-retry', '网络与互通', 'TURN 独立复测', turn.status, `${turn.actual_path.localCandidateTypes}／${turn.actual_path.mediaProtocols}；解码帧 ${turn.decoded_frames_before} → ${turn.decoded_frames_after}`, '只授本次 TURN 实际路径与恢复结果信用；原批次失败不改。', 2, 'entries.network_runtime.turn_retry');
  const audit = latest.entries.network_audit;
  const readback = audit.export_readback;
  add('network-audit', '网络与互通', '网络九成功子集：离线导出回读与独立复盘', audit.status, `回读 ${readback.status}：${readback.files_verified} 文件、${number(readback.metric_rows, 0)} 指标行、${readback.timeline_events} 事件；独立复盘 ${audit.independent_review.status}`, '离线证据审计；九格完整性和关联检查通过，不是新 runtime。原失败、完整门信用 0 和 UI 导出未完成边界保留。', 2, 'entries.network_audit');
  const restart = previous.entries.network_service_restart;
  add('service-restart', '网络与互通', '服务重启与关联证据审计', restart.status, restart.checks.find(item => item.id === 'checkpoint-diagnostic-correlation-audit').detail, '运行与原证据审计限定范围；支持包回读和 UI 导出分别判定。', 1, 'entries.network_service_restart');
  const cpp = latest.entries.official_cpp.latest_projection;
  add('cpp-data', '网络与互通', '官方独立 C++ 数据互通', scopedStatus(cpp.data_cells.map(item => item.status)), counts(cpp.data_counts), '双方向各六格来自独立运行；未证明官方 SDK 进程内退休与恢复。', 2, 'entries.official_cpp.latest_projection.data_cells');
  add('cpp-video', '网络与互通', '官方独立 C++ 受控视频', scopedStatus(cpp.controlled_video_cells.map(item => item.status)), `${counts(cpp.video_counts)}；VP8／H264 × E2EE OFF／ON`, '四个原 60 秒独立格；音频返回内容仍未验证，不能升格为整个 P05 通过。', 2, 'entries.official_cpp.latest_projection.controlled_video_cells');
  const derived = new Map();
  const derivedAttempts = previous.entries.flutter_build.runtime_matrices.flatMap(matrix => matrix.cases).sort((a, b) => Date.parse(a.completed_at_utc) - Date.parse(b.completed_at_utc));
  for (const attempt of derivedAttempts) derived.set(attempt.id, attempt);
  const derivedCases = [...derived.values()];
  add('derived-flutter', '网络与互通', '固定派生 Flutter 协议与业务', scopedStatus(derivedCases.map(item => item.status)), `${counts(tally(derivedCases))}；按唯一 case 取最新终态`, '10-20 派生夹具；原 wrong-slot 失败尝试保留。与下方未修改官方 Flutter 配置分别解释。', 1, 'entries.flutter_build.runtime_matrices[].cases[]');
  const flutter = latest.entries.official_flutter.latest_projection;
  add('flutter-projection', '网络与互通', '固定官方 Flutter 互通逐格结果', 'PARTIAL', counts(flutter.counts), '跨 run 的最新逐格投影；Native 为 explicit_fixture_bindings，完整产品门信用 0；两个失败保留。', 2, 'entries.official_flutter.latest_projection');
  const relay = followup('native-full-relay03');
  add(relay.id, '网络与互通', 'Native 全重连受控 relay', relay.status, `${Object.values(relay.result.checks).filter(value => value === true).length}／${Object.keys(relay.result.checks).length} 项原检查通过`, '仅该独立运行；Flutter 全重连内容失败及 replace-two 失败继续保留。', 2, 'followup_results[id=native-full-relay03]');

  const pair = find(latest.entries.telemetry_performance.checks, 'pair-1');
  const failedRelay = followup('flutter-full-relay03');
  const failedChecks = Object.entries(failedRelay.result.checks).filter(([, value]) => value === false).map(([key]) => key);
  const open = [
    {title: 'P13 OFF/ON 性能', status: pair.status, detail: `首对 callback P99 增幅 ${number(pair.callback_p99_increase_upper_percent, 6)}% ＞ ${pair.limits.callback_p99_increase_percent}%；后两对 NOT_RUN，根因 UNKNOWN。`, field: 'entries.telemetry_performance.checks'},
    {title: 'Flutter 全重连与密钥替换', status: failedRelay.status, detail: `全重连失败检查：${failedChecks.join('、')}；replace-two 原失败保留，外部 KeySet 补丁未应用。`, field: 'entries.official_flutter'},
    {title: '主题、操作计时与 UI 导出', status: 'FAIL', detail: '原桌面尝试未完成主题周期或 UI 导出；系统浅／深偏好往返和会议媒体连续性未完成。', field: 'entries.desktop_runtime.followup_attempts'},
    {title: '白板原 1800 秒协同负载', status: followup('whiteboard-1800-fullscreen02').status, detail: '8 端／4 写者／50 对原门未完成；publisher 提前退出根因 UNKNOWN，不能用功能八格通过替代。', field: 'followup_results[id=whiteboard-1800-fullscreen02]'},
    {title: '官方 C++ 音频与 SDK 进程内退休恢复', status: 'NOT_RUN', detail: '音频返回内容与 SDK 进程内退休恢复尚无通过证据；数据、视频格与进程退出不替代。', field: 'entries.official_cpp'},
    {title: 'P20 Formal 与最终回归', status: 'PAUSED / NOT_RUN', detail: `本阶段 P20 Formal 暂停；最终回归 ${latest.summary.final_regression_status}，完整主门完成数 ${latest.summary.full_plan_gates_completed}。历史授权例外保持原限定运行范围。`, field: 'summary'}
  ];
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.ok(rows.every(row => !['NOT_RUN', 'RUNNING'].includes(row.status)));
  return {schema: 'cohavora-completed-subgate-view-v1', sources, latest_source: 2, updated_at: latest.updated_utc, scope: latest.context.resource_scope, full_plan_gates_completed: latest.summary.full_plan_gates_completed, final_regression_status: latest.summary.final_regression_status, rows, open, cleanup_status: latest.cleanup.status, counting_policy: '只投影已记录的终态与复用结果；各 run、工程检查和子门不相加为验收通过率。'};
}

export function renderCompletedResults(data) {
  const badge = status => `<span class="badge ${status === 'FAIL' ? 'bad' : status === 'PASS' || status === 'PASS_SCOPED' ? 'good' : 'warn'}">${esc(status)}</span>`;
  const sourceLink = (index, field) => `<a href="${esc(data.sources[index].html)}">原报告</a><details><summary>数据字段</summary><p><a href="${esc(data.sources[index].json)}">JSON</a> · <code>${esc(field)}</code></p></details>`;
  const groups = [...new Set(data.rows.map(row => row.category))];
  const timestamp = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium'}).format(new Date(data.updated_at));
  return `<section id="completed-results"><h2>最新已完成子门与实测数据</h2><p>结果快照截至 ${esc(timestamp)} 北京时间；${esc(data.scope)}。以下结果按各次冻结输入解释，保留失败及复用边界。</p><p class="boundary">${esc(data.counting_policy)} 完整主门完成数 ${data.full_plan_gates_completed}；最终回归 ${esc(data.final_regression_status)}。</p>${groups.map(category => `<h3>${esc(category)}</h3><div class="table-wrap"><table><thead><tr><th>测试范围</th><th>已记录结论</th><th>实测值／完成记录</th><th>适用边界</th><th>来源</th></tr></thead><tbody>${data.rows.filter(row => row.category === category).map(row => `<tr id="completed-${esc(row.id)}"><th scope="row">${esc(row.title)}</th><td>${badge(row.status)}</td><td>${esc(row.measured)}</td><td>${esc(row.boundary)}</td><td>${sourceLink(row.source, row.field)}</td></tr>`).join('')}</tbody></table></div>`).join('')}<h3>已结束的失败尝试与尚未闭合范围</h3><div class="table-wrap"><table><thead><tr><th>范围</th><th>状态</th><th>保留的结果与缺口</th><th>来源</th></tr></thead><tbody>${data.open.map(row => `<tr><th scope="row">${esc(row.title)}</th><td>${badge(row.status)}</td><td>${esc(row.detail)}</td><td>${sourceLink(data.latest_source, row.field)}</td></tr>`).join('')}</tbody></table></div><p class="note">测试专用资源清理：${esc(data.cleanup_status)}；共享服务、其他规则与证据保留。此为清理回执，不计作产品测试通过。本次仅更新文档，未启动产品复测。</p></section>`;
}
