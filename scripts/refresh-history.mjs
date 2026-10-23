import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const norm = value => value.replaceAll('\\', '/').toLowerCase();

/** Update existing history slots; preserve unrun scopes in the frozen input. */
export async function refreshHistory(root, data, {writeEvidence = true} = {}) {
  const read = async name => parse(await fs.readFile(path.join(root, 'data/completed-evidence', name)));
  const sources = names => names.map(name => {
    const portable = 'data/completed-evidence/' + name;
    const original = path.join(root, portable).replaceAll('\\', '/');
    data.portableFiles[norm(original)] = {portable_path: portable, status: 'COMPLETED_SAME_SCOPE_SOURCE'};
    return original;
  });
  const update = (id, values, names, scope, limits) => {
    const record = data.historicalRecords.find(row => row.id === id);
    assert.ok(record, 'Missing original history slot ' + id);
    assert.equal(record.metrics.length, values.length);
    record.metrics.forEach((metric, i) => { metric.value = values[i]; metric.basis = '最新已完成同范围结果；' + names.join('、'); });
    record.date = '2026-10-21（北京时间）';
    record.evidence_scope = scope;
    record.validity = '仅授予所列冻结输入及已完成子门的信用，不等于完整产品验收通过。';
    record.sources = sources(names);
    if (limits) record.limitations = limits;
    data.completedRefresh.history_updated.push(id);
    return record;
  };
  data.completedRefresh.history_updated = [];
  const e2eeName = 'native-e2ee-abba-20261020-result.json';
  const e2ee = await read(e2eeName);
  assert.equal(e2ee.status, 'PASS');
  const roles = ['publisher', 'receiver'];
  const e2eeValues = roles.flatMap(role => {
    const row = e2ee.comparison[role];
    return [row.private_memory_delta_mib, row.decoded_fps_loss_percent, row.observations.audio_jitter_buffer_delay_p95_delta_ms];
  });
  const h132 = update('H132', e2eeValues, [e2eeName], '同机三Native H264窗口共享＋麦克风；OFF/ON/ON/OFF及共同600秒逐轨观察已完成。');
  h132.date = '2026-10-20';
  h132.environmentIds = data.highlights.find(row => row.id === 'highlight-e2ee').environmentIds;

  const gdiOriginal = 'E:/vsSource/WebRTC/live-kit-test-local/out/resource-completion-20261020-01/capture-gdi-hot-50-01/';
  const gdiNames = ['gdi-hot-50-20261021-summary.json', 'gdi-hot-50-20261021-events.log'];
  for (const [i, source] of ['summary.json', 'events.log'].entries()) {
    const target = path.join(root, 'data/completed-evidence', gdiNames[i]);
    if (writeEvidence) {
      const bytes = await fs.readFile(gdiOriginal + source);
      if (i === 0) assert.equal(hash(bytes), 'bea24ecdcff826075c7ec7586cb88b332cdb3ef527f5c1f9c16363e487d06ff7');
      await fs.writeFile(target, bytes);
    }
    const bytes = await fs.readFile(target);
    data.completedRefresh.sources.push({path: 'data/completed-evidence/' + gdiNames[i], sha256: hash(bytes), bytes: bytes.length});
  }
  const gdi = await read(gdiNames[0]);
  assert.equal(gdi.status, 'PASS');
  assert.equal(gdi.exit_code, 0);
  const events = (await fs.readFile(path.join(root, 'data/completed-evidence', gdiNames[1]), 'utf8')).split(/\r?\n/).filter(line => line.includes('[QUALITY_RUNTIME] {')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  const stages = Array.from({length: 5}, (_, i) => events.find(event => event.stage === i));
  assert.ok(stages.every(stage => stage?.fps_checked && stage.same_track));
  update('H150', [0, ...stages.map(stage => stage.decoded_fps)], gdiNames, 'GDI真实捕获50次热切、原70%～120% FPS门、signal/full恢复及停止释放；短功能门，不授予长时资源信用。', ['目标30 FPS一档实测约25 FPS，满足原21～36门，不声称稳定精确30 FPS。', '本轮soak_seconds=0，resource_gate=NOT_APPLICABLE，不替代1800秒资源门。']);
  const screen = data.highlights.find(row => row.id === 'highlight-screen-share');
  const previous = screen.metrics[4].value;
  screen.metrics[4].value = stages.slice(0, 3).map(stage => stage.decoded_fps.toFixed(6)).join(' / ');
  screen.metrics[4].basis = '2026-10-21 GDI50已完成运行：' + gdiNames[1] + ' stage0..2 decoded_fps；原70%～120%门，非稳定精确30FPS。';
  screen.date = 'WGC生命周期、1800秒资源及GDI50：2026-10-21；15项整批及2K成本保留原日期';
  screen.summary = 'WGC更新为已完成的一小时／100轮和独立1800秒六资源门，GDI更新为已完成50次热切的帧率；原15项整批及2K成本保持各自原日期和结果。';
  screen.scope = '局部WGC生命周期、1800秒资源与GDI50为独立完成子门；不拼接成新的15项整批或完整会议验收。';
  screen.sources.push(...sources(gdiNames));
  screen.limitations = screen.limitations.map(item => item.replace('原GDI帧率与2K成本保留原日期及预算边界', 'GDI50保持原FPS门，2K成本保留原日期及预算边界'));
  const gdiEnvironment = 'env-gdi-50-20261021';
  data.testEnvironments.profiles.push({id: gdiEnvironment, label: 'GDI50热切：2026-10-21', server: '实服SFU image/binary指纹见同run summary；云厂商及实例硬件未在该结果单列。', client: 'Windows RelWithDebInfo test_screen_share_runtime.exe；冻结EXE SHA256=' + gdi.binary_sha256 + '；客户端硬件未在该结果单列。', load: '生成图案窗口真实GDI捕获，50次热切及signal/full恢复，原FPS门；soak_seconds=0。', boundary: '仅短功能和FPS门，不授予长时资源或物理画质信用。', sources: [{path: 'data/completed-evidence/' + gdiNames[0], basis: 'binary_identity、server、process_identity及status'}, {path: 'data/completed-evidence/' + gdiNames[1], basis: 'QUALITY_RUNTIME各档decoded_fps及热切恢复结果'}]});
  screen.environmentIds.push(gdiEnvironment);
  data.historicalRecords.find(row => row.id === 'H150').environmentIds = [gdiEnvironment];
  data.completedRefresh.changes.push({id: screen.id, metric: screen.metrics[4].name, metric_index: 4, previous_value: previous, value: screen.metrics[4].value, source: 'data/completed-evidence/' + gdiNames[1], field: 'stage0..2.decoded_fps'});

  const wgcName = 'wgc-1800-20261021-resource-analysis.json';
  const wgc = await read(wgcName);
  assert.equal(wgc.status, 'PASS');
  const pb = wgc.resource_checks.private_bytes;
  update('H151', [wgc.sample_count, pb.baseline_median, pb.final_median, pb.growth, pb.maximum, pb.slope_per_minute], [wgcName], 'WGC1800秒连续负载、六资源门已完成；生成图案，WDDM过程计数不是DXGI预算。', ['最低／中位／最高解码FPS为' + [wgc.decoded_fps.minimum, wgc.decoded_fps.median, wgc.decoded_fps.maximum].join('/') + '，不证明持续复杂4K/30。', '未覆盖完整会议、跨机与物理质量。']);
  const lifecycleName = 'wgc-3600-100-20261021-result.json';
  const lifecycle = await read(lifecycleName);
  assert.equal(lifecycle.status, 'PASS');
  update('H155', [lifecycle.elapsed_seconds, lifecycle.cycles, lifecycle.first_stopped.handles, lifecycle.last_stopped.handles, (lifecycle.last_stopped.private_bytes - lifecycle.first_stopped.private_bytes) / 1048576, lifecycle.final_live.private_bytes], [lifecycleName], '同一采集进程真实Start/Stop、逐轮释放/join，至少3600秒及100轮；12门全部成立。', ['不覆盖完整会议、SFU、远端音视频、多用户、网络重连及B14 Formal。']);

  const boardNames = ['whiteboard-b12-20261021-collaboration-and-leave.json', 'whiteboard-b12-20261021-authority-disconnect.json'];
  const board = await read(boardNames[0]), authority = await read(boardNames[1]);
  assert.equal(board.status, 'PASS'); assert.equal(authority.status, 'PASS');
  const exits = Object.values(board.lifecycle);
  assert.ok(exits.every(row => row.exit_code === 0 && row.retirement.cleanup_pending === 0 && row.retirement.rooms_alive === 0));
  update('H156', [exits.length, Object.keys(board.cases).length + Object.keys(authority.cases).length, board.cases['simultaneous-write'].submission_skew_ms, new Set(Object.values(board.cases.export.exports).map(row => row.pixel_sha256)).size, exits.length, '0/0'], boardNames, '三个独立产品进程实服8项功能，Qt导出和Pillow独立RGB像素回读；authority离会／异常断开边界单独验证。', ['不是三台物理终端、批注视觉对齐或白板30分钟负载性能。', '正常协作场景三进程exit0；异常authority场景publisher预期exit1，不概括为正常退出。']);

  const telemetryName = 'telemetry-9000s-20261021-result.json';
  const telemetry = await read(telemetryName);
  assert.equal(telemetry.status, 'PASS'); assert.equal(telemetry.long_resource_gate.status, 'PASS');
  const long = telemetry.long_resource_gate;
  update('H164', [long.duration_s, long.samples, long.private_growth_mib, long.handles_growth, long.threads_growth, long.release_private_delta_mib], [telemetryName], 'RelWithDebInfo原生媒体/UI/持久化长门；预热300秒，资源原门限，最大采样间隔' + long.maximum_gap_s + '秒。');

  const formal = parse(await fs.readFile(path.join(root, 'reports/b14/b14-clipboard-readmission-20261019-01.json'))).formal;
  const summary = data.b14CycleSummary;
  const h181 = update('H181', [formal.effective_cycle_counts, summary.process.uia_duration_seconds, formal.resource_growth.private_bytes.growth / 1048576, formal.resource_growth.wddm_bytes.growth / 1048576, 0, formal.status], [path.basename(summary.source_path)], '最新完整Formal；run_id=' + formal.run_id + '；100周期逐轮检查全PASS，唯一跨周期Private Bytes增长FAIL，无本run例外。', ['Private增长95.869140625MiB＞原64MiB，根因UNKNOWN，目标仍active。', '产品正常退出、清理成功不抵扣资源门失败；旧NIC例外只归档。', 'DEFERRED：' + formal.deferred.join('、')]);
  h181.title = 'B14 最新完整 Formal：100 轮 / 8 小时';
  h181.status = formal.status;
  h181.date = data.highlights.find(row => row.id === 'highlight-b14').date;
  h181.environmentIds = data.highlights.find(row => row.id === 'highlight-b14').environmentIds;
  // 旧资格、失败及中断轮次保留于report-input.json，不在当前表重复展示同主题。
  data.completedRefresh.superseded_history_ids = ['H179', 'H180', 'H185', 'H186'];
  data.historicalRecords = data.historicalRecords.filter(row => !data.completedRefresh.superseded_history_ids.includes(row.id));
  data.curationSummary.historical_results = data.historicalRecords.length;
  for (const [id, environment] of [['H151', 'env-wgc-20261021'], ['H155', 'env-wgc-20261021'], ['H156', 'env-whiteboard-b12-20261021'], ['H164', 'env-telemetry-9000s-20261021']]) data.historicalRecords.find(row => row.id === id).environmentIds = [environment];
}
