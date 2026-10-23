import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {refreshB14Disposition} from './refresh-b14-disposition.mjs';

const norm = value => String(value).replaceAll('\\', '/').toLowerCase();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const number = value => { assert.ok(Number.isFinite(value), 'Missing recorded measurement'); return value; };
const fixed = value => number(value).toFixed(6).replace('-', '−');
const range = values => `${fixed(Math.min(...values))}～${Math.min(...values) < 0 && Math.max(...values) > 0 ? '＋' : ''}${fixed(Math.max(...values))}`;
const at = (object, field) => field.split('.').reduce((value, key) => value?.[key], object);
const unique = values => [...new Set(values)];

/** Update existing metric rows from completed, comparable runs. Never executes acceptance. */
export async function refreshCompleted(root, data, {writeEvidence = true} = {}) {
  const changes = [], sources = [];
  data.portableFiles ??= {};
  const originalCards = structuredClone(data.highlights);
  const register = (original, portable, bytes) => {
    const receipt = {original_path: original, portable_path: portable, sha256: hash(bytes), bytes: bytes.length, status: 'COMPLETED_RESULT_SOURCE'};
    data.portableFiles[norm(original)] = receipt;
    data.portableFiles[norm(portable)] = receipt;
    if (!sources.some(item => item.path === portable)) sources.push({path: portable, sha256: receipt.sha256, original_path: original});
    return receipt;
  };
  const report = async relative => {
    const bytes = await fs.readFile(path.join(root, relative));
    register(relative, relative, bytes);
    const html = relative.replace(/\.json$/, '.html');
    register(html, html, await fs.readFile(path.join(root, html)));
    return parse(bytes);
  };
  const freeze = async (original, name, expected) => {
    const relative = `data/completed-evidence/${name}`;
    let bytes;
    try { bytes = await fs.readFile(path.join(root, relative)); }
    catch (error) { if (error.code !== 'ENOENT' || !writeEvidence) throw error; bytes = await fs.readFile(original); }
    if (expected) assert.equal(hash(bytes), expected, 'Frozen evidence changed: ' + original);
    if (writeEvidence) {
      await fs.mkdir(path.dirname(path.join(root, relative)), {recursive: true});
      await fs.writeFile(path.join(root, relative), bytes);
    }
    const receipt = register(original, relative, bytes);
    return {value: parse(bytes), relative, receipt, bytes};
  };
  const evidence = (reportData, key) => {
    const entry = reportData.evidence_files[key];
    assert.ok(entry?.absolute_path && entry.sha256, 'Missing bound evidence: ' + key);
    return entry;
  };
  const evidenceMatching = (reportData, pattern) => {
    const matches = Object.entries(reportData.evidence_files).filter(([key]) => pattern.test(key));
    assert.equal(matches.length, 1, 'Ambiguous evidence: ' + pattern);
    return matches[0][1];
  };
  const freezeEntry = (entry, name) => freeze(entry.absolute_path, name, entry.sha256);
  const card = id => { const value = data.highlights.find(item => item.id === id); assert.ok(value, id); return value; };
  const update = (highlight, index, value, basis, source, field) => {
    const row = highlight.metrics[index];
    assert.ok(row, highlight.id + ' metric ' + index);
    changes.push({id: highlight.id, metric: row.name, metric_index: index, previous_value: row.value, value, source, field});
    row.value = value;
    row.basis = basis;
  };
  const addSources = (highlight, values) => { highlight.sources = unique([...highlight.sources, ...values]); };
  const addProfile = (profile) => {
    data.testEnvironments.profiles = [...data.testEnvironments.profiles.filter(item => item.id !== profile.id), profile];
    return profile.id;
  };
  const resourceReport = 'reports/product/resource-completion-20261021-01.json';
  const functionalReport = 'reports/product/functional-media-retest-20261020-01.json';
  const b14Report = 'reports/b14/b14-clipboard-readmission-20261019-01.json';
  const resource = await report(resourceReport);
  const functional = await report(functionalReport);
  const b14 = await report(b14Report);
  const followup = id => {
    const value = resource.followup_results.find(item => item.id === id);
    assert.ok(value?.terminal === true && value.status === 'PASS', 'Incomplete follow-up: ' + id);
    return value;
  };

  // Native ABBA and explicit common-window observation are the same frozen run.
  const performance = functional.e2ee_scope_evidence.abba_performance;
  assert.equal(performance.status, 'PASS');
  const e2eeRaw = await freeze(performance.evidence_path, 'native-e2ee-abba-20261020-result.json', performance.evidence_sha256);
  const e = e2eeRaw.value, eh = card('highlight-e2ee');
  assert.equal(e.status, 'PASS');
  assert.equal(e.performance_status, 'PASS');
  assert.equal(e.observation.status, 'PASS');
  assert.deepEqual(e.order, ['off', 'on', 'on', 'off']);
  assert.equal(e.observation.verified_seconds, 600);
  const comparisons = Object.values(e.comparison);
  const metricValues = [
    range(comparisons.map(item => item.cpu_delta_pp)),
    Number(Math.max(...comparisons.map(item => item.private_memory_delta_mib)).toFixed(6)),
    range(comparisons.map(item => item.decoded_fps_loss_percent)),
    `${Math.max(...e.trials.slice(0, 4).flatMap(trial => Object.values(trial.metrics).map(item => number(item.pcm_gap_p95_upper_ms))))} / ${e.trials.slice(0, 4).flatMap(trial => Object.values(trial.metrics)).reduce((sum, item) => sum + number(item.pcm_intervals_over_100ms), 0)}`,
    range(comparisons.map(item => item.observations.audio_jitter_buffer_delay_p95_delta_ms)),
    `${e.observation.common_available_seconds} / ${e.observation.verified_seconds}`
  ];
  const eFields = ['comparison.*.cpu_delta_pp', 'comparison.*.private_memory_delta_mib (maximum)', 'comparison.*.decoded_fps_loss_percent', 'trials[0..3].metrics.*.pcm_gap_p95_upper_ms / pcm_intervals_over_100ms', 'comparison.*.observations.audio_jitter_buffer_delay_p95_delta_ms', 'observation.common_available_seconds / verified_seconds'];
  metricValues.forEach((value, index) => update(eh, index, value, `${e2eeRaw.relative}: ${eFields[index]}；2026-10-20 同机三 Native 完成运行`, e2eeRaw.relative, eFields[index]));
  Object.assign(eh, {
    date: '2026-10-20（Native ABBA 与共同600秒）',
    status: 'PASS（Native 限定性能负载）',
    summary: '2026-10-20 在同一三 Native 负载下完成 OFF/ON/ON/OFF 对照；CPU、私有内存和解码帧率符合事前预算，并取得共同600秒逐轨观察 PASS。',
    scope: `${e.load}。每轮${e.trial_seconds}秒，最后一端入会后预热${e.warmup_seconds_after_last_join}秒，共同测量窗口${e.steady_window_seconds}秒；各客户端两轮On/Off的逐轮P95分别平均。三端为同机三个独立进程。`,
    limitations: ['仅授予该次Native ABBA负载及共同600秒范围；不代替完整E2EE验收、Flutter内容对应或跨物理机器互通。', 'PCM间隔及jitter-buffer delay仅观察，后者不是嘴到耳延迟；负差值按测量波动解释，不宣称加密提高性能。', '未覆盖摄像头负载、长期稳定性、物理延迟或最终E2EE完成。']
  });
  addSources(eh, [functionalReport, functionalReport.replace('.json', '.html'), e2eeRaw.relative]);
  eh.environmentIds = [addProfile({id: 'env-e2ee-abba-20261020', label: 'Native E2EE ABBA：2026-10-20', server: functional.environment + ' 该次最终结果未单列云厂商、SFU版本或服务指纹，保留未记录。', client: 'Windows RelWithDebInfo；同机三个独立Native产品进程。CPU、RAM、GPU型号未在该性能result中单列；不沿用10-01机器配置。', load: e.load + '；OFF/ON/ON/OFF及共同600秒逐轨观察。', boundary: '以该次工具/launcher指纹及各trial冻结结果为准；同机逻辑端不等于三台物理电脑。', sources: [{path: e2eeRaw.relative, basis: 'load、trials、tool_sha256、launcher_sha256与observation'}, {path: functionalReport, basis: 'environment、configuration、e2ee_scope_evidence'}]})];

  // Replace only the four local WGC rows and the two completed 1800s resource rows.
  const wgcRaw = await freezeEntry(evidence(resource, 'wgc'), 'wgc-3600-100-20261021-result.json');
  const w = wgcRaw.value, wh = card('highlight-screen-share');
  assert.equal(w.status, 'PASS');
  assert.equal(w.cycles, 100);
  update(wh, 1, `${w.cycles} / ${w.elapsed_seconds}`, `${wgcRaw.relative}: cycles、elapsed_seconds；${w.started_utc} 至 ${w.finished_utc}`, wgcRaw.relative, 'cycles / elapsed_seconds');
  update(wh, 2, `${w.first_stopped.handles} → ${w.last_stopped.handles}`, `${wgcRaw.relative}: first_stopped.handles、last_stopped.handles；同进程停止态`, wgcRaw.relative, 'first_stopped.handles / last_stopped.handles');
  update(wh, 3, (number(w.last_stopped.private_bytes) - number(w.first_stopped.private_bytes)) / 1048576, `${wgcRaw.relative}: (last_stopped.private_bytes-first_stopped.private_bytes)/1048576；与原行相同首末停止态口径，不改为warm-window差`, wgcRaw.relative, '(last_stopped.private_bytes-first_stopped.private_bytes)/1048576');
  const six = followup('wgc-1800-six-resources');
  const sixRaw = await freezeEntry(evidenceMatching(resource, /^followup_wgc_1800_six_resources_analyzer_/), 'wgc-1800-20261021-resource-analysis.json');
  const sixRunner = await freezeEntry(evidenceMatching(resource, /^followup_wgc_1800_six_resources_summary_json_/), 'wgc-1800-20261021-summary.json');
  assert.equal(sixRaw.value.status, 'PASS');
  assert.equal(sixRaw.value.run_id, six.run_id);
  const resources = sixRaw.value.resource_checks;
  update(wh, 5, number(resources.private_bytes.growth) / 1048576, `${sixRaw.relative}: resource_checks.private_bytes.growth/1048576；同run六资源分析PASS`, sixRaw.relative, 'resource_checks.private_bytes.growth/1048576');
  update(wh, 6, number(resources.cpu_pct.growth), `${sixRaw.relative}: resource_checks.cpu_pct.growth；首末60秒窗中位数差`, sixRaw.relative, 'resource_checks.cpu_pct.growth');
  wh.date = 'WGC生命周期及1800秒资源：2026-10-21；B07/B08最终15项及GDI／2K成本：原2026-10-02／09-29';
  wh.status = 'PASS（各完成子门／原历史范围）';
  wh.summary = 'WGC已更新为2026-10-21完成的同进程一小时／100轮和独立1800秒六资源门。原15项最终回归、GDI帧率与2K成本仍保留各自原执行结果和日期。';
  wh.scope = '局部WGC生命周期与真实共享1800秒六资源是独立运行；原B07/B08十五项、GDI及2K成本数值未被未完成的新性能尝试覆盖。';
  wh.metrics[0].basis += '；保留2026-10-02原完成记录，本轮未重跑同一15项批次';
  wh.metrics[4].basis += '；保留2026-10-02原值';
  wh.metrics[7].basis += '；保留原日期，不采用未完成的新2K性能尝试';
  wh.limitations = ['WGC局部一小时／100轮不覆盖完整会议或B14 Formal；1800秒六资源只授同一run范围。', `本轮1800秒最低／中位／最高解码FPS为${sixRaw.value.decoded_fps.minimum}／${sixRaw.value.decoded_fps.median}／${sixRaw.value.decoded_fps.maximum}；生成图案及WDDM计数不等于主观画质或DXGI预算验证。`, '原GDI帧率与2K成本保留原日期及预算边界；CPU core-percent不等于整机CPU百分比，未设成本预算不声明性能通过。', '新2K性能未完成，未覆盖该历史数值；其他显示设备、跨DPI／GPU及人工画质缺口保留。'];
  addSources(wh, [resourceReport, resourceReport.replace('.json', '.html'), wgcRaw.relative, sixRaw.relative, sixRunner.relative]);
  wh.environmentIds = ['env-screen-share', addProfile({id: 'env-wgc-20261021', label: 'WGC生命周期／1800秒六资源：2026-10-21', server: '一小时／100轮为本地采集，不依赖SFU；独立1800秒共享使用本轮2核2GiB／3Mbps服务机。云厂商及SFU版本未在这两个result单列。', client: 'Windows RelWithDebInfo；生命周期test_desktop_capture_runtime.exe，PID ' + w.pid + '。1800秒run=' + six.run_id + '；CPU、RAM、GPU型号未在所引结果单列。', load: '两个独立WGC运行：同进程100轮／至少3600秒；生成图案连续共享1800秒及同run六资源分析。', boundary: '不套用历史B07/B08机器型号，不把局部生命周期与实服共享拼成完整会议门。', sources: [{path: wgcRaw.relative, basis: 'hashes、pid、cycles、elapsed_seconds'}, {path: sixRaw.relative, basis: 'run_id、resource_checks、boundary'}, {path: resourceReport, basis: 'context.resource_scope与followup_results'}]})];

  // The three original paired-performance rows retain their original date and values.
  const telemetry = followup('telemetry-9000s');
  const telemetryRaw = await freezeEntry(evidenceMatching(resource, /^followup_telemetry_9000s_window_/), 'telemetry-9000s-20261021-result.json');
  const telemetryIndex = await freezeEntry(evidenceMatching(resource, /^followup_telemetry_9000s_index_/), 'telemetry-9000s-20261021-index.json');
  const t = telemetry.result_summary.long_resource_gate, th = card('highlight-b15');
  assert.equal(t.status, 'PASS');
  assert.equal(telemetryRaw.value.status, 'PASS');
  const rawGate = telemetryRaw.value.long_resource_gate;
  assert.ok(rawGate, 'Missing original telemetry long gate');
  assert.equal(rawGate.duration_s, t.duration_s);
  assert.equal(rawGate.private_growth_mib, t.private_growth_mib);
  update(th, 4, number(rawGate.duration_s), `${telemetryRaw.relative}: long_resource_gate.duration_s；${t.samples}样本、最大间隔${t.maximum_gap_s}秒、预热${t.warmup_s}秒；原9000秒门`, telemetryRaw.relative, 'long_resource_gate.duration_s');
  update(th, 5, number(rawGate.private_growth_mib), `${telemetryRaw.relative}: long_resource_gate.private_growth_mib；退会后相对入会前${t.release_private_delta_mib}MiB≤64MiB`, telemetryRaw.relative, 'long_resource_gate.private_growth_mib');
  th.date = '三对OFF/ON：原2026-10-01／10-02；9000秒资源：2026-10-20至10-21';
  th.status = 'PASS（原配对范围／最新资源子门）';
  th.summary = '原三组OFF/ON配对性能数值按2026-10-01／10-02完成结果保留；长资源两行更新为最新完成的9030.448秒运行。两组数据来自不同冻结输入，分别解释。';
  th.scope = '原三组性能配对沿用原f153e339fe58aad7023e18ba89bfc4daa4714a13及原夹具身份；9000秒资源子门采用2026-10-20／21独立RelWithDebInfo运行，不将其视为新三对性能PASS。';
  th.metrics.slice(0, 4).forEach(row => { row.basis += '；保留原2026-10-01／10-02已完成结果，本轮未以未完成配对替换'; });
  th.limitations = ['三组性能配对和9000秒资源来自各自完成运行，不拼接为当前整批通过；未完成的新性能配对不覆盖原三组数值。', 'native callback计时不包含decoder自身计算，p99负增量不证明整条解码链提升。', '9000秒资源子门不等于B14八小时／100轮完整会议生命周期；各自输入与版本边界保留。'];
  addSources(th, [resourceReport, resourceReport.replace('.json', '.html'), telemetryRaw.relative, telemetryIndex.relative]);
  th.environmentIds = ['env-b15', addProfile({id: 'env-telemetry-9000s-20261021', label: '遥测9000秒资源子门：2026-10-20／21', server: resource.context.resource_scope + ' 该资源结果未单列云厂商与SFU版本。', client: `Windows RelWithDebInfo uia_entry_fixture.exe；EXE SHA256=${telemetry.binary_identity.binary_sha256}；PDB ${telemetry.binary_identity.pdb_guid}／age${telemetry.binary_identity.pdb_age}。CPU、RAM、GPU型号未单列。`, load: '独立原生媒体／UI／持久化9030秒资源门，预热300秒；不是三组OFF/ON性能。', boundary: '仅绑定本次长资源运行，不沿用历史配对机器配置。', sources: [{path: resourceReport, basis: 'context.resource_scope、followup_results[id=telemetry-9000s].binary_identity'}, {path: telemetryRaw.relative, basis: 'long_resource_gate及summary'}, {path: telemetryIndex.relative, basis: '独立完成资源门索引'}]})];

  // Keep M5's three historical engineering rows and replace B12's same-scope rows only.
  const whiteboard = followup('whiteboard-functional-desktop11');
  const wbIndex = await freezeEntry(evidenceMatching(resource, /^followup_whiteboard_functional_desktop11_result_/), 'whiteboard-b12-20261021-index.json');
  const wbLeave = await freezeEntry(evidenceMatching(resource, /^followup_whiteboard_functional_desktop11_child_0_/), 'whiteboard-b12-20261021-collaboration-and-leave.json');
  const wbDisconnect = await freezeEntry(evidenceMatching(resource, /^followup_whiteboard_functional_desktop11_child_1_/), 'whiteboard-b12-20261021-authority-disconnect.json');
  const wb = wbLeave.value, bh = card('highlight-whiteboard');
  assert.equal(wbIndex.value.status, 'PASS');
  assert.equal(wbIndex.value.independent_cases, 8);
  assert.ok(whiteboard.cells.length === 8 && whiteboard.cells.every(item => item.status === 'PASS'));
  const exports = Object.values(wb.cases.export.exports);
  assert.equal(exports.length, 3);
  assert.equal(new Set(exports.map(item => item.pixel_sha256)).size, 1);
  assert.ok(Object.values(wb.lifecycle).every(item => item.exit_code === 0 && item.retirement?.cleanup_pending === 0 && item.retirement?.rooms_alive === 0));
  update(bh, 3, '3 / 8（8/8 PASS）', `${wbIndex.relative}: independent_cases=8；两个独立房间运行共8个case均PASS，三独立Coordinator进程`, wbIndex.relative, 'independent_cases / rooms[].status');
  update(bh, 4, `${wb.input_png.width}×${wb.input_png.height}；三端全像素 SHA256 一致`, `${wbLeave.relative}: cases.export.exports.*.pixel_sha256；${wb.cases.export.independent_decoder}；三端${exports[0].pixel_sha256}`, wbLeave.relative, 'input_png.width / height; cases.export.exports.*.pixel_sha256');
  update(bh, 5, 'Room 弱引用=0；shutdown pending=0；进程 exit=0', `${wbLeave.relative}: lifecycle.*.retirement.rooms_alive=0、cleanup_pending=0、exit_code=0；异常authority仅按预期终止解释，不声明native drain`, wbLeave.relative, 'lifecycle.*.retirement / exit_code');
  bh.date = 'M5：原2026-09-22；B12：2026-10-21';
  bh.status = 'PASS_SCOPED（原M5）／PASS（最新B12功能范围）';
  bh.summary = 'M5三项Debug/offscreen工程指标保持原2026-09-22结果；B12更新为2026-10-21完成的8项实服协同功能、三端导出像素一致及正常退出清理。';
  bh.scope = 'B12为同机三个独立Coordinator进程，经真实SFU、公用命令与不可变Qt投影，覆盖同时编辑、图片、迟加入、同步、重连、导出和authority退场；原M5及新B12分别解释。';
  bh.limitations = ['M5的0.2652ms保留原Debug合成QPainter口径；没有以新的未完成性能测试覆盖，不代表实际4K落笔或跨端可见延迟。', '本轮B12只授予8格功能、导出和正常退出范围；异常authority预期终止不声明native drain。', '三独立进程不等于三台物理终端，也不替代8端／4写者／50对的1800秒协同负载。'];
  addSources(bh, [resourceReport, resourceReport.replace('.json', '.html'), wbIndex.relative, wbLeave.relative, wbDisconnect.relative]);
  bh.environmentIds = ['env-whiteboard-m5', addProfile({id: 'env-whiteboard-b12-20261021', label: 'B12白板协同功能：2026-10-21', server: resource.context.resource_scope + ` 独立服务image=${wb.server_before.image}，binary=${wb.server_before.binary}；云厂商及版本号未单列。`, client: `Windows RelWithDebInfo，三个独立Coordinator进程；EXE SHA256=${wbIndex.value.binary_identity.binary_sha256}，PDB age=${wbIndex.value.binary_identity.pdb_age}；CPU、RAM、GPU型号未单列。`, load: '两个独立房间运行，共8格功能；320×180导出及Pillow RGB独立像素回读。', boundary: '不同于M5 Debug/offscreen；不借用10-02机器配置，不代表完整长负载。', sources: [{path: wbIndex.relative, basis: 'binary_identity、configuration、rooms、scope'}, {path: wbLeave.relative, basis: 'server_before、input_png、cases.export、lifecycle'}, {path: resourceReport, basis: 'context.resource_scope'}]})];

  // Latest complete Formal: explicit scoped projection of this run's immutable final receipts.
  const formal = b14.formal;
  const sourceName = b14.completed_source;
  const scopedRaw = await freeze(path.join(root, sourceName), path.basename(sourceName), b14.completed_source_sha256);
  const scoped = scopedRaw.value;
  assert.equal(scoped.schema, 'cohavora_b14_formal_completed_scoped_v1');
  const r = scoped.external_review;
  assert.equal(r.run_id, formal.run_id);assert.equal(r.mode, 'Formal');
  assert.equal(r.verdict, formal.raw_verdict);assert.equal(formal.status, 'FAIL');
  assert.equal(r.cycles.length, 100);assert.equal(formal.exception, null);
  const raw = {...scopedRaw, value: r};
  const uia = {value: scoped.uia_result, relative: raw.relative, bytes: Buffer.from(JSON.stringify(scoped.uia_result))};
  const plan = {value: scoped.plan, relative: raw.relative};
  const limits = {value: scoped.limits, relative: raw.relative};
  const b = card('highlight-b14');
  const totalChecks = r.cycles.reduce((sum, cycle) => sum + Object.keys(cycle.checks).length, 0);
  const passedChecks = r.cycles.reduce((sum, cycle) => sum + Object.values(cycle.checks).filter(status => status === 'PASS').length, 0);
  const passedCycles = r.cycles.filter(cycle => cycle.verdict === 'PASS').length;
  update(b, 0, `${r.cycles.length} / 100（${passedCycles} PASS；跨周期资源门FAIL）`, `${raw.relative}: external_review.cycles / cycle_counts；逐轮通过不替代跨周期资源门`, raw.relative, 'external_review.cycles / cycle_counts');
  update(b, 1, number(r.duration_seconds), `${raw.relative}: external_review.duration_seconds；产品关闭前存活${formal.product_live_seconds}秒另列`, raw.relative, 'external_review.duration_seconds');
  update(b, 2, number(r.resource_growth.private_bytes.growth) / 1048576, `${raw.relative}: external_review.resource_growth.private_bytes.growth/1048576；原64MiB门FAIL，根因UNKNOWN`, raw.relative, 'external_review.resource_growth.private_bytes.growth/1048576');
  update(b, 3, `${Object.keys(r.cycles[0].checks).length} 类 × ${r.cycles.length} 轮（${passedChecks}/${totalChecks} PASS）`, `${raw.relative}: external_review.cycles[*].checks；${Object.keys(r.final_checks).length}项final_checks全部true；Private跨周期增长独立FAIL`, raw.relative, 'external_review.cycles[*].checks / final_checks');
  update(b, 4, number(r.windows_crash_events), `${raw.relative}: external_review.windows_crash_events；产品exit0，runner/owner因Formal资源门FAIL退出1`, raw.relative, 'external_review.windows_crash_events');
  update(b, 5, number(r.resource_growth.wddm_bytes.growth) / 1048576, `${raw.relative}: external_review.resource_growth.wddm_bytes.growth/1048576，原32MiB门PASS`, raw.relative, 'external_review.resource_growth.wddm_bytes.growth/1048576');
  Object.assign(b, {status: formal.status, date: `${r.started_utc} — ${r.finished_utc}`,
    summary: `最新完整Formal同一产品进程完成100周期／${r.duration_seconds}秒；3200/3200逐轮检查PASS、11/11最终检查true。唯一跨周期Private Bytes增长95.869140625MiB＞原64MiB，原判定FAIL。`,
    scope: `仅run_id=${r.run_id}；无授权例外，未改变原门限；问题定位与修复仍active，不称整组或目标完成。`,
    limitations: ['Private增长为末10与首10释放窗中位数差，根因UNKNOWN；不把增长直接认定为已确认泄漏根因，也不扣除估计保留量。', '产品正常退出0、crash0；runner及owner因Formal失败exit1，服务/任务与进程默认TokenOwner恢复PASS。独立owner OS退出码未独立观测，不新增gate。', 'GPU队列可读性和release_eligible保留原限制，scheduler packets不等于硬件队列深度；原DEFERRED不变。', '首帧缺项与未触发重连保持UNKNOWN，计时仅OBSERVATION_ONLY。'],
    failureAnalysis: {title: '唯一失败：跨周期Private Bytes增长', summary: '完整Formal FAIL；逐轮检查与最终检查通过，资源增长门独立失败。', explanation: '末10轮与首10轮释放窗Private Bytes中位数差100526080字节（95.869140625MiB），超过原67108864字节（64MiB）门限。', conclusion: '根因UNKNOWN；继续定位与修复，不签整组、目标完成或生产就绪。', basis: `${raw.relative}: external_review.resource_growth.private_bytes`, details: '无本run用户例外；历史NIC例外仅在旧run归档。统计不抵扣原FAIL。', receipt: b14Report}});
  b.sources = [b14Report, b14Report.replace('.json', '.html'), raw.relative];
  b.environmentIds = [addProfile({id: 'env-b14-formal-20261023', label: 'B14完整Formal：2026-10-23／Private增长FAIL', server: `阿里云ECS：${plan.value.server_cpu}vCPU／${plan.value.server_memory_gib}GiB／${plan.value.server_bandwidth_mbps}Mbps；direct配置SHA=${plan.value.collector_media_route.server_config_sha256}。`, client: `Windows RelWithDebInfo Cohavora.exe；同一产品PID${uia.value.product_first_live.pid}，出生ticks原字符串保留；型号/Windows版本未单列。`, load: `${plan.value.load.video_publishers}路${plan.value.load.width}×${plan.value.load.height}@${plan.value.load.fps}fps ${plan.value.load.video_codec}，每路${plan.value.load.video_bps_each}bps，音频${plan.value.load.audio_bps}bps，simulcast=false、E2EE关闭；共享${plan.value.share_seconds}秒，日志每侧${plan.value.log_pair_seconds}秒。`, boundary: '仅该冻结run；Private增长门FAIL、根因UNKNOWN；不外推摄像头独立专项、其他host、物理声光或VS诊断。', sources: [{path: raw.relative, basis: 'plan、uia_result、external_review、owner_execution、cleanup及原始source_receipts'}]})];

  const summary = structuredClone(data.b14CycleSummary);
  assert.ok(summary.metrics?.length && summary.first_frame_and_action_timing?.length, 'Missing original B14 summary schema');
  const scalar = (cycle, row) => {
    const field = row.source_field.replace(/^(?:external_review\.)?cycles\[\*\]\./, '');
    const value = number(at(cycle, field));
    return row.id === 'telemetry_queue_peak_mib' ? value / 1048576 : value;
  };
  summary.run_id = r.run_id;
  summary.created_utc = r.reviewed_utc;
  summary.source_path = raw.relative;
  summary.source_sha256 = raw.receipt.sha256;
  summary.raw_verdict = r.verdict;
  summary.overall_verdict = formal.status;
  summary.raw_cycle_counts = r.cycle_counts;
  summary.effective_cycle_counts = formal.effective_cycle_counts;
  summary.exception = formal.exception;
  summary.cycle_count = r.cycles.length;
  summary.overall_resource_growth = r.resource_growth;
  summary.final_checks = r.final_checks;
  summary.derivation_method.scope = `仅同一Formal run=${r.run_id}的${r.cycles.length}个逐轮scalar等权统计；逐轮最大值与分桶上界语义保持，不混合其他run。`;
  summary.process = {pid: uia.value.product_first_live.pid, start_ticks: uia.bytes.toString('utf8').match(/"start_ticks"\s*:\s*"?(\d+)/)?.[1] ?? 'UNKNOWN', product_live_seconds_before_close: uia.value.product_live_elapsed_seconds_before_close, required_seconds: uia.value.product_lifetime_floor_required_seconds, uia_started_utc: uia.value.started_utc, uia_finished_utc: uia.value.finished_utc, uia_duration_seconds: r.duration_seconds, source: uia.relative};
  const backends = unique(r.cycles.flatMap(cycle => cycle.details.backend_observed));
  const reconnectMaximum = Math.max(...r.cycles.map(cycle => number(cycle.details.revision_1_to_terminal.native_metric_summary['reconnect.episodes'].maximum)));
  summary.procedure_parameters = {sources: [plan.relative, limits.relative, uia.relative, raw.relative], same_product_process_100_cycles: true, explicit_microphone_unmute: plan.value.explicit_microphone_unmute, share_seconds: plan.value.share_seconds, log_pair_seconds_per_side: plan.value.log_pair_seconds, fixed_remote_publishers: plan.value.load, backend_observed: backends, network_reconnect_episodes_per_cycle_maximum: reconnectMaximum, order_boundary: '仅由同run冻结plan及最终external-review归纳，不从现行脚本补造逐项点击时序。', steps_supported_by_final_evidence: ['同一产品进程依次完成100轮入会／离会，各轮保留cycle_id及独立检查。', `显式取消麦克风静音；固定${plan.value.load.video_publishers}路${plan.value.load.width}×${plan.value.load.height}@${plan.value.load.fps}fps ${plan.value.load.video_codec}远端负载；上下行音频及RTP／解码连续性逐轮检查。`, `每轮屏幕共享计划${plan.value.share_seconds}秒，实际backend为${backends.join('／')}；独立接收端验证交付及原生buffer释放。`, `停止共享后观测资源，并执行日志OFF／ON每侧计划${plan.value.log_pair_seconds}秒的配对窗口。`, '每轮离会后验证settled release、native cleanup、资源／遥测／诊断／归档和support bundle，之后进入下一轮。']};
  summary.procedure_note = `同run ${r.run_id}；实际backend=${backends.join('/')}，共享计划${plan.value.share_seconds}秒、日志每侧${plan.value.log_pair_seconds}秒；${r.cycles.length}轮，逐轮${passedCycles} PASS；跨周期Private增长FAIL，无用户例外。计时未留存项不补造，不套用其他run。`;
  summary.metrics = summary.metrics.map(row => {
    const values = r.cycles.map(cycle => scalar(cycle, row));
    const sorted = [...values].sort((a, b) => a - b);
    return {...row, source: raw.relative, source_field: row.source_field.startsWith('external_review.') ? row.source_field : 'external_review.' + row.source_field, n: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, p50: sorted[Math.ceil(0.50 * values.length) - 1], p95: sorted[Math.ceil(0.95 * values.length) - 1], max: sorted.at(-1)};
  });
  summary.per_cycle = r.cycles.map(cycle => ({cycle: cycle.cycle, cycle_id: cycle.cycle_id, ...Object.fromEntries(summary.metrics.map(row => [row.id, scalar(cycle, row)]))}));
  summary.check_counts = Object.fromEntries(unique(r.cycles.flatMap(cycle => Object.keys(cycle.checks))).map(key => [key, {pass: r.cycles.filter(cycle => cycle.checks[key] === 'PASS').length, total: r.cycles.length}]));
  summary.first_frame_and_action_timing = summary.first_frame_and_action_timing.map(row => {
    const result = {...row, status: 'UNKNOWN', source: raw.relative, n: 0, mean: null, p50: null, p95: null, max: null};
    if (row.id.startsWith('reconnect_')) {
      const metric = row.id.replace('reconnect_', '').replace('_first', '');
      const key = `reconnect.${metric}.first`;
      const entries = r.cycles.map(cycle => cycle.details.revision_1_to_terminal.native_metric_summary[key]);
      result.availability_reason = reconnectMaximum === 0 ? 'NOT_TRIGGERED' : 'NOT_RETAINED';
      result.reason = reconnectMaximum === 0 ? '本run的100轮reconnect.episodes.maximum均为0，未触发网络故障重连；逐轮重新入会不是网络重连，无首帧恢复耗时样本。' : '原结果没有同口径逐轮恢复耗时，不从其他run补造。';
      result.valid_samples_total = entries.reduce((sum, entry) => sum + number(entry.valid_samples), 0);
      assert.equal(result.valid_samples_total, 0, 'Recorded reconnect timing needs an explicit measurement contract');
      result.availability_totals = entries.reduce((totals, entry) => { for (const [key, count] of Object.entries(entry.availability)) totals[key] = (totals[key] ?? 0) + count; return totals; }, {});
    } else {
      result.reason = '本run最终JSON没有保留与本行统一起终点相符的100轮耗时样本；不由PASS、帧数或其他run倒推，UNKNOWN不记作0毫秒。';
    }
    return result;
  });
  const timingRaw = await freeze(path.join(root, scoped.timing_source.path), path.basename(scoped.timing_source.path), scoped.timing_source.sha256);
  const timing = timingRaw.value;
  assert.equal(timing.run_id, r.run_id);
  assert.equal(timing.status, 'OBSERVATION_ONLY');
  assert.equal(timing.release_gate_issued, false);
  assert.equal(timing.definition_version, data.timingMeasurements.definition_version);
  assert.equal(timing.samples.length, 300);
  assert.ok(timing.samples.every(sample => sample.valid && sample.run_id === r.run_id));
  summary.timing_source_path = timingRaw.relative;
  summary.timing_source_sha256 = timingRaw.receipt.sha256;
  summary.timing_definition_version = timing.definition_version;
  const timingNames = {join_ready: '入会操作耗时', leave_complete: '离会操作耗时', ui_first_paint: 'UI首绘耗时（meeting页面）'};
  summary.recorded_timing_statistics = timing.summaries.map(row => ({
    id: row.metric + ':' + row.outcome,
    name: timingNames[row.metric] + (row.outcome === 'degraded_success' ? '（降级成功）' : '（普通成功）'),
    note: '同run／' + row.scene + '；' + row.outcome,
    metric: row.metric, scene: row.scene, outcome: row.outcome,
    n: row.valid_success_count, mean: row.mean_ms, p50: row.p50_ms, p95: row.p95_ms, max: row.max_ms,
    unit: 'ms', original_limit: null, source_field: 'summaries[' + row.metric + '/' + row.scene + '/' + row.outcome + ']'
  }));
  for (const row of summary.first_frame_and_action_timing.filter(row => row.definition_id)) {
    const recorded = summary.recorded_timing_statistics.find(item => item.metric === row.definition_id && item.outcome === 'success');
    assert.ok(recorded, 'Missing completed timing bucket: ' + row.definition_id);
    Object.assign(row, {status: 'RECORDED', availability_reason: 'RECORDED', source: timingRaw.relative,
      n: recorded.n, mean: recorded.mean, p50: recorded.p50, p95: recorded.p95, max: recorded.max,
      degraded_success_n: summary.recorded_timing_statistics.find(item => item.metric === row.definition_id && item.outcome === 'degraded_success')?.n ?? 0,
      reason: row.definition_id === 'join_ready'
        ? `同run已留存${r.cycles.length}轮入会操作；按实际success/degraded_success分桶，未出现的桶不补样本。`
        : row.definition_id === 'ui_first_paint'
          ? '同run已留存100轮meeting页面有效首绘后的Qt event-loop观察点；不代表应用启动首屏、settings页面或显示器呈现。'
          : '同run已留存100轮离会终态；关联native cleanup完成及返回会前页面。'
    });
  }
  const idle = timing.idle_memory;
  assert.equal(idle.status, 'OBSERVATION_ONLY');
  assert.equal(idle.release_gate_issued, false);
  assert.equal(idle.windows.length, 101);
  assert.ok(idle.windows.every(window => window.status === 'RECORDED'));
  summary.idle_memory_definition_version = idle.definition_version;
  summary.recorded_idle_memory_statistics = idle.summaries.map(row => ({
    ...row, id: row.scene + ':' + row.metric,
    valid_windows: idle.windows.filter(window => window.scene === row.scene).length
  }));
  const memory = data.memoryUsageSummary;
  const idleRow = (original, scene) => {
    const metric = original.id.endsWith('working_set') ? 'working_set_bytes' : 'private_bytes';
    const recorded = summary.recorded_idle_memory_statistics.find(row => row.scene === scene && row.metric === metric);
    assert.ok(recorded?.status === 'RECORDED', 'Missing completed idle-memory scene: ' + scene);
    return {...original, id: scene === 'initial_home_idle' ? original.id : original.id.replace('idle_', 'post_leave_'),
      phase: scene === 'initial_home_idle' ? '软件常态（首次入会前空闲）' : '软件常态（离会后空闲）',
      scene, status: 'RECORDED_MEAN', mean_bytes: recorded.mean_bytes, mean_mib: recorded.mean_mib,
      valid_samples: recorded.valid_samples, valid_windows: recorded.valid_windows,
      window: scene === 'initial_home_idle'
        ? `同run首次入会前${recorded.valid_windows}个空闲窗口、${recorded.valid_samples}个有效样本；剔除前5秒预热，不与离会后合并。`
        : `同run${recorded.valid_windows}个离会后空闲窗口、${recorded.valid_samples}个有效样本；每窗剔除前5秒，按有效样本等权。`,
      source: timingRaw.relative, source_field: 'idle_memory.summaries[' + scene + '/' + metric + ']'
    };
  };
  const initialRows = memory.rows.filter(row => row.id.startsWith('idle_'));
  memory.post_leave_rows = initialRows.map(row => idleRow(row, 'post_leave_home_idle'));
  memory.rows = memory.rows.map(row => row.id.startsWith('idle_') ? idleRow(row, 'initial_home_idle') : row);
  memory.b14_run_id = r.run_id;
  memory.timing_source_path = timingRaw.relative;
  memory.source_sha256 = timingRaw.receipt.sha256;
  memory.created_at = r.reviewed_utc;
  memory.method.source = '空闲均值取同run ui-timing-review中的有效绝对占用样本，initial_home_idle与post_leave_home_idle分组；会议均值仍独立复用原B11的300个稳态资源样本，不混入B14。';
  memory.sources = [...memory.sources.filter(source => source.path !== timingRaw.relative), {path: timingRaw.relative, sha256: timingRaw.receipt.sha256, bytes: timingRaw.receipt.bytes}];
  memory.limitations = ['初始空闲与100轮离会后空闲均来自同一完成Formal，分别统计；不外推为所有会前或会议状态。', '该B14会议状态的绝对占用均值仍未导出；独立B11会议数据不与该run合并，增长、峰值及释放窗中位数不能替代占用均值。', '均值仅为OBSERVATION_ONLY，原结果没有独立占用门限，不新增性能PASS。'];
  addSources(b, [timingRaw.relative]);
  b.limitations[b.limitations.length - 1] = '入会、离会及meeting首绘已接入同run计时回执，仅为耗时观测；摄像头／共享首帧缺口与未触发的网络重连分别保留。';
  summary.limitations = ['原Formal判定FAIL：唯一跨周期Private Bytes增长95.869140625MiB＞原64MiB，根因UNKNOWN；无本run例外。', '所有20项统计来自同run100轮，未混入其他运行；缺失的首帧／操作耗时不编造为0。', '每轮重新入会不代表故障重连；本run重连episodes逐轮maximum为0。', '共享后端为' + backends.join('／') + '，不扩展为其他采集后端或物理设备验收。'];
  summary.limitations.push('入会／离会／meeting首绘另取同run ui-timing-review；P50使用中位数，P95使用最近秩法；普通/降级成功按实际分桶分别统计，不签发独立性能PASS。');
  data.b14CycleSummary = summary;
  changes.push({id: b.id, metric: '100-cycle summary', source: raw.relative, field: 'cycles[*].details', value: {run_id: summary.run_id, metrics: summary.metrics.length, cycles: summary.cycle_count}});

  // Guard the original layout and all untouched metric names, units and limits.
  assert.deepEqual(data.highlights.map(item => item.id), originalCards.map(item => item.id));
  for (const original of originalCards) {
    const current = card(original.id);
    assert.equal(current.metrics.length, original.metrics.length);
    current.metrics.forEach((row, index) => {
      assert.equal(row.name, original.metrics[index].name);
      assert.deepEqual(row.unit, original.metrics[index].unit);
      assert.deepEqual(row.limit, original.metrics[index].limit);
    });
  }
  data.completedRefresh = {schema: 'cohavora-same-column-completed-refresh-v1', revised_at: '2026-10-21', policy: '仅替换原5卡中已完成且同口径的指标；未执行、仅尝试或未完成部分不更新；原门限及未更新指标保持', changes, sources, product_runtime: 'NOT_RUN; document refresh only', excluded: ['B14完整Formal FAIL；P19资格READY独立保留，目标仍active', 'resource-completion batches: PARTIAL is not a completed full gate', 'new 2K performance and incomplete OFF/ON pairs', 'M5 engineering measurements remain original']};
  await refreshB14Disposition(root, data);
  return data;
}
