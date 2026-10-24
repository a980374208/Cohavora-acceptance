import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const norm = value => String(value).replaceAll('\\', '/').toLowerCase();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = value => Array.isArray(value) ? value.map(text).join('；') : typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const pointer = (value, locator) => locator.split('/').slice(1).reduce((current, key) => current?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], value);
const completed = status => typeof status === 'string' && /^(?:PASS(?:_[A-Z0-9]+)*|FAIL(?:_[A-Z0-9]+)*|READY|OBSERVATION_ONLY|PASS_SCOPED \/ NOT_CLOSED)$/.test(status);
const stripResults = record => { const copy = structuredClone(record); delete copy.completed_results; return copy; };

/** Read package-local terminal results without changing frozen plans or executing tests. */
export async function refreshPlanResults(root, data, {writeEvidence = false} = {}) {
  // All required sources already belong to this package; this projection never copies evidence.
  void writeEvidence;
  const before = data.retestRecords.map(stripResults);
  const groups = new Map(data.retestRecords.filter(record => record.plan_kind === 'product').map(record => [record.plan_code, record]));
  assert.equal(groups.size, 21);
  const results = new Map([...groups.keys()].map(code => [code, new Map()]));
  const sources = [], cache = new Map(), skipped = [];
  const packageRoot = path.resolve(root);
  data.portableFiles ??= {};

  const read = async relative => {
    if (cache.has(relative)) return cache.get(relative);
    const absolute = path.resolve(root, relative);
    const within = path.relative(packageRoot, absolute);
    assert.ok(within && !within.startsWith('..') && !path.isAbsolute(within), 'Result source must belong to the package: ' + relative);
    // assemble writes this derived summary after the projection; bind the exact pending bytes.
    const bytes = relative === 'data/b14-100-cycle-summary.json'
      ? Buffer.from(JSON.stringify(data.b14CycleSummary, null, 2))
      : await fs.readFile(absolute);
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    const old = data.portableFiles[norm(relative)];
    const receipt = {...old, original_path: old?.original_path || relative, portable_path: relative, sha256: digest(bytes), bytes: bytes.length, status: old?.status || 'COMPLETED_PLAN_RESULT_SOURCE'};
    data.portableFiles[norm(relative)] = receipt;
    data.portableFiles[norm(absolute)] = receipt;
    sources.push({path: relative, sha256: receipt.sha256, bytes: bytes.length});
    const source = {relative, value};
    cache.set(relative, source);
    return source;
  };
  const add = (codes, source, locator, {id, title, scope, date}) => {
    assert.ok(locator.startsWith('/'), 'Expected an RFC6901 status pointer');
    const status = pointer(source.value, locator);
    assert.ok(completed(status), 'Not a completed result: ' + source.relative + '#' + locator + '=' + status);
    assert.ok(id && title && scope && date, 'Completed result requires identity, scope and recorded date');
    for (const code of codes) {
      assert.ok(groups.has(code), 'Unknown product plan: ' + code);
      // A later, explicitly matching completed scope replaces its earlier display entry.
      results.get(code).set(id, {id, title, status, date, scope, source_path: source.relative, source_locator: locator});
    }
  };
  const sourceDate = source => source.value.completed_date || source.value.test_date || source.value.finished_utc || source.value.created_utc;
  const reportDate = source => '来源报告更新于 ' + source.value.updated_utc + '（非逐格完成时间）';

  const functional = await read('reports/product/functional-media-retest-20261020-01.json');
  assert.equal(functional.value.final_snapshot, true);
  const observations = functional.value.current_observations;
  assert.equal(observations.filter(row => row.batch_family === 'b03-codec').length, 9);
  assert.equal(observations.filter(row => row.batch_family.startsWith('b04-')).length, 13);
  for (const [index, row] of observations.entries()) {
    assert.equal(row.view, 'CURRENT');
    if (!completed(row.current_status) || row.pending_retest) continue;
    assert.equal(row.current_status, row.original_status);
    // B12 and ABBA have newer or more precise package-local result projections below.
    if (row.batch_family === 'b12-whiteboard' || row.case === 'e2ee-performance') continue;
    const codes = [...new Set(row.plan_mapping.map(mapping => mapping.plan_code))];
    if (row.case === 'remote_control_ui_test') codes.push('P18');
    if (!codes.length) continue;
    const isNetwork = row.batch_family === 'b10-network';
    const engineering = /^engineering-/.test(row.batch_family);
    add(codes, functional, '/current_observations/' + index + '/current_status', {
      id: (isNetwork ? 'network-' : 'functional-') + row.case,
      title: row.batch_family + ' · ' + row.case,
      date: row.recorded_at,
      scope: '原输入已完成的独立case；' + (engineering ? '工程／单元合同，不代替真实设备、服务或完整runtime。' : '仅限该case实际codec、负载和退出条件，不授整组通过。')
    });
  }

  const resource20 = await read('reports/product/resource-completion-20261020-01.json');
  add(['P03'], resource20, '/entries/io/status', {
    id: 'controlled-io-three', title: '真实I/O：三项受控运行子条件', date: reportDate(resource20),
    scope: resource20.value.entries.io.scope + ' 三项使用各自受控条件；真实物理慢盘、驱动不响应及断电恢复未覆盖。'
  });
  const resource = await read('reports/product/resource-completion-20261021-01.json');
  const entries = resource.value.entries;

  // Matrices are already curated per logical cell. Do not reuse their stale parent verdicts.
  const flutter = entries.official_flutter.latest_projection;
  assert.deepEqual(flutter.counts, {PASS: 14, FAIL: 2});
  for (const [index, cell] of flutter.cells.entries()) add(['P05', 'P06'], resource, '/entries/official_flutter/latest_projection/cells/' + index + '/status', {
    id: 'flutter-' + cell.id, title: '固定派生Flutter · ' + cell.id, date: reportDate(resource),
    scope: '各格分别采用原输入／原run：' + (cell.run_id || cell.attempt || cell.evidence_ref) + '；受控relay内容／媒体数据及所声明换钥、恢复条件。14 PASS／2 FAIL为逐格投影，不拼成同run完整互通或E2EE通过；不覆盖摄像头、物理跨机或长稳。'
  });
  // These two shared IDs describe repair derivatives, never replacements for
  // the original official cells above; the batch itself is not a third case.
  const flutterRetest = await read('data/completed-evidence/flutter-original-failures-retest-20261022-scoped.json');
  assert.equal(flutterRetest.value.schema, 'cohavora-flutter-original-failures-retest-scoped-v1');
  assert.equal(flutterRetest.value.acceptance_credit, 0);
  assert.equal(flutterRetest.value.full_gate_credit, 0);
  assert.deepEqual(flutterRetest.value.cases.map(row => row.id).sort(), ['flutter-full', 'replace-two']);
  for (const [index, row] of flutterRetest.value.cases.entries()) {
    assert.ok(['PASS', 'FAIL'].includes(row.status));
    assert.ok(Number.isInteger(row.check_count) && Number.isInteger(row.passed_checks));
    assert.equal(row.passed_checks + row.failed_checks.length, row.check_count);
    assert.equal(row.marker.valid + row.marker.invalid, row.marker.video_frames);
    assert.ok(row.source.path && /^[a-f0-9]{64}$/.test(row.source.sha256));
    if (row.status === 'PASS') {
      assert.equal(row.failed_checks.length, 0);
      assert.equal(row.marker.invalid, 0);
      assert.equal(row.marker.first_frame_correct, true);
      assert.ok(row.exit_codes.every(code => code === 0));
    } else assert.ok(row.failed_checks.length > 0);
    add(['P05', 'P06'], flutterRetest, '/cases/' + index + '/status', {
      id: 'flutter-repair-derivative-' + row.id,
      title: '修复衍生Flutter · ' + row.id + '（credit 0）',
      date: row.observed_at_utc,
      scope: 'P05／P06共用同一case，不重复计数；原shared服务、ON／60秒／VP8 relay、继承桌面；run=' + row.run_id +
        '，检查' + row.passed_checks + '/' + row.check_count + '，返回视频' + row.marker.video_frames +
        '帧／有效' + row.marker.valid + '／无效' + row.marker.invalid + '，首帧marker=' + row.marker.first_frame_correct +
        '，退出码' + row.exit_codes.join('/') + '。' + (row.failed_checks.length ? '原判据失败=' + row.failed_checks.join('、') + '；根因UNKNOWN，未剔除异常帧或按尺寸豁免。' : '两轮replace的媒体／数据恢复及严格marker原判据通过，仅授本修复衍生范围。') +
        '仅复用排除task7的冻结修复产物；acceptance_credit=0／full_gate_credit=0，pristine official=false。原official 14 PASS／2 FAIL及阶段冻结保持，未授官方SDK、完整互通／E2EE、跨机、物理声学或长稳信用；原run来源SHA256=' + row.source.sha256 + '。'
    });
  }
  for (const field of ['data_cells', 'controlled_video_cells']) {
    const cells = entries.official_cpp.latest_projection[field];
    assert.equal(cells.length, field === 'data_cells' ? 12 : 4);
    for (const [index, cell] of cells.entries()) add(['P05', 'P06'], resource, '/entries/official_cpp/latest_projection/' + field + '/' + index + '/status', {
      id: 'cpp-' + field + '-' + index,
      title: field === 'data_cells' ? '官方C++数据 · ' + [cell.direction, cell.mode, cell.key_state].join(' / ') : '官方C++受控视频 · ' + cell.codec + ' / ' + cell.mode,
      date: reportDate(resource),
      scope: '独立格原输入／attempt=' + cell.attempt + '；' + (field === 'data_cells' ? '固定官方SDK的该方向及key条件下数据/流合同。' : '仅受控合成视频内容及该codec／OFF或ON条件。') + ' 多run不拼接完整矩阵通过，音频、跨物理机和长稳另判。'
    });
  }

  // Older network execution judgments remain in their source reports. The latest
  // complete eleven-case batch below replaces the matching active display.
  for (const key of ['export_readback', 'independent_review']) add(['P02', 'P12', 'P17'], resource, '/entries/network_audit/' + key + '/status', {
    id: 'network-nine-' + key, title: key === 'export_readback' ? '九成功网络子集：生产导出回读' : '九成功网络子集：独立支持包复盘',
    date: reportDate(resource), scope: entries.network_audit.scope + ' 仅该完成审计条件；不是新的网络runtime或整组通过。'
  });
  add(['P02', 'P12', 'P17'], resource, '/entries/service_restart/status', {
    id: 'service-restart-export-review', title: 'service-restart生产导出与独立复盘', date: reportDate(resource), scope: entries.service_restart.scope + ' 仅限定复用／审计范围，完整主门信用0。'
  });
  for (const [index, check] of entries.telemetry_lifecycle.checks.entries()) add(['P13'], resource, '/entries/telemetry_lifecycle/checks/' + index + '/status', {
    id: 'telemetry-' + check.id, title: check.id === 'uia-interference' ? '遥测UIA干扰：20轮' : '遥测同进程残余：5轮', date: reportDate(resource),
    scope: '两个独立原输入分别判定的资源／生命周期子门；本条=' + check.id + '，不抵扣正式OFF/ON首对P99失败。'
  });
  for (const [index, cell] of entries.desktop_runtime.latest_projection.cells.entries()) {
    // B12 and complex-wgc-screen are represented once by their more precise raw receipts below.
    if (!['capture-backends', 'annotation-runtime'].includes(cell.gate)) continue;
    assert.equal(cell.terminal, true);
    const attempt = resource.value.followup_results.find(row => row.id === cell.attempt);
    assert.equal(attempt?.terminal, true);
    add(cell.plan_codes, resource, '/entries/desktop_runtime/latest_projection/cells/' + index + '/status', {
      id: 'desktop-' + cell.gate, title: '桌面限定子门 · ' + cell.gate,
      date: attempt.observed_at_utc, scope: cell.scope + ' 原输入／attempt=' + cell.attempt + '；仅该实际范围，不授完整主门。'
    });
  }

  const raw = async (codes, name, title, scope, {locator = '/status', date, id = name.replace(/\.json$/, '')} = {}) => {
    const source = await read('data/completed-evidence/' + name);
    add(codes, source, locator, {id, title, scope, date: date || sourceDate(source)});
    return source;
  };
  const networkEleven = await read('data/completed-evidence/p09-network-eleven-20261022-scoped.json');
  assert.equal(networkEleven.value.status, 'PASS');
  assert.equal(networkEleven.value.case_count, 11);
  assert.equal(networkEleven.value.cases.length, 11);
  for (const [index, row] of networkEleven.value.cases.entries()) {
    assert.equal(row.case_status, 'PASS');
    assert.equal(row.cleanup_status, 'PASS');
    assert.equal(row.persistence_close_status, 'PASS');
    add(['P09'], networkEleven, '/cases/' + index + '/status', {
    id: 'network-' + row.case, title: '最新同批网络case · ' + row.case, date: row.finished_utc,
    scope: '本轮同批／同一新产物；decoded ' + row.decoded_before + '→' + row.decoded_after + '、DX11交付' + row.render_delivered + '帧，实际' + row.local_candidate + '/' + row.protocol + '；双方自然退出0、native rooms_alive／cleanup_pending均0、持久化关闭及case清理PASS，同批输入身份PASS。仅该软件注入／合成视频范围，实际音频和物理故障另判；不授P09整组通过。'
    });
  }
  add(['P02'], networkEleven, '/status', {
    id: 'network-eleven-store-close', title: '同批网络11项：接收端snapshot及存储关闭', date: networkEleven.value.finished_utc,
    scope: '仅本轮11个case的接收端snapshot与真实store-close：逐项persistence_close_status均PASS；不覆盖生产导出回读、故障日志关联或缺失／重复事件审计，不替换原独立导出和复盘结果。'
  });
  await raw(['P05', 'P06'], 'official-cpp-audio-windows01-20261021-scoped.json', '官方C++合成音频：OFF／ON内容对应',
    '固定官方C++ SDK及Native显式绑定，同一Windows主机两进程，返回音频每种模式60秒；全部tone/silent/other窗口保留。仅内容存在PASS_SCOPED，不证明音频连续性、主观音质、物理嘴到耳、跨机、换钥或SDK进程内退场；content04仅历史支持，不重复列项。');
  const abba = await read('data/completed-evidence/native-e2ee-abba-20261020-result.json');
  const abbaDate = observations.find(row => row.case === 'e2ee-performance').recorded_at;
  add(['P06'], abba, '/performance_status', {id: 'native-abba-performance', title: '三Native OFF/ON/ON/OFF性能', date: abbaDate,
    scope: abba.value.load + '；每轮' + abba.value.trial_seconds + '秒，原固定CPU/内存/解码FPS预算；只授本次负载，不证明摄像头性能或完整E2EE。'});
  add(['P06'], abba, '/observation/status', {id: 'native-common-600', title: '三Native共同600秒逐轨观察', date: abbaDate,
    scope: '同机三独立Native进程，共同有效观察' + abba.value.observation.verified_seconds + '秒；独立于ABBA性能结论，不等于跨物理机、Flutter或长期稳定性。'});
  await raw(['P07'], 'wgc-3600-100-20261021-result.json', 'WGC局部生命周期：至少3600秒／100轮',
    '原同进程100轮创建、采集、停止与join生命周期及资源门；不是实服会议、跨机音视频或B14 Formal。');
  const wgc = await read('data/completed-evidence/wgc-1800-20261021-summary.json');
  await raw(['P07'], 'wgc-1800-20261021-resource-analysis.json', 'WGC实服共享：1800秒六资源',
    '仅同run连续共享1800秒六资源分析PASS；与3600秒局部生命周期是独立运行。WDDM计数不等于DXGI预算／驻留，未授主观画质或完整会议长稳。', {date: wgc.value.finished_utc});
  await raw(['P07'], 'gdi-hot-50-20261021-summary.json', 'GDI：50次热切与信令／完整重连',
    '原GDI原生功能与采集合同完成；六资源增长为NOT_APPLICABLE，不能由该PASS推出新的FPS预算、六资源或主观画质通过。');
  await raw(['P07'], 'capture-quality-2k-20261021-result.json', 'WGC 2K复杂图案：采集交付与客观画质',
    'complex-wgc-screen原run：2560×1440自有文字／色彩／滚动图案，同进程两个不同Native Room；原采集交付、停止清理检查与30个PSNR/SSIM样本按原门限PASS。父批次不重复列项；不证明复杂真实桌面主观可读性、两独立进程、跨机或新2K性能预算。');
  await raw(['P11'], 'whiteboard-b12-20261021-index.json', 'B12白板：三独立产品进程八项',
    '同机三独立产品进程、实服八项功能及Qt导出／独立像素回读；正常离会和authority异常断开各按其run判定，不是三台物理终端或主观批注对齐。');
  await raw(['P11'], 'whiteboard-1800-fixed04-20261021-result.json', '白板1800秒：8进程／4书写者／50对启停',
    '一机8产品进程、4书写者，1802.609秒、每写者361笔、50对共享／批注启停；8端收敛、8/8自然退出、forced0及netem清除。替代同范围旧失败，不能外推跨DPI、物理跨机或主观视觉对齐。');
  const telemetryPaired = await read('data/completed-evidence/p13-performance-paired-20261022-scoped.json');
  assert.equal(telemetryPaired.value.requested_seconds, 60);
  assert.equal(telemetryPaired.value.full_P13_gate_credit, 0);
  for (const [index, comparison] of telemetryPaired.value.pairs.entries()) add(['P13'], telemetryPaired, '/pairs/' + index + '/status', {
    id: 'telemetry-formal-60s-pair-' + (index + 1), title: '最新正式OFF/ON配对 · 第' + (index + 1) + '对', date: telemetryPaired.value.finished_utc,
    scope: '同一冻结RelWithDebInfo工件，每窗60秒、计划' + telemetryPaired.value.requested_pairs + '对；本对callback P99保守增幅' + comparison.callback_p99_increase_upper_percent + '%，原门限' + comparison.limits.callback_p99_increase_percent + '%；CPU增量' + comparison.cpu_increase_pp + '个百分点、工作集增量' + comparison.working_set_increase_bytes / 1048576 + 'MiB。' + (telemetryPaired.value.remaining_pairs ? '原入口失败即停止，剩余' + telemetryPaired.value.remaining_pairs + '对NOT_RUN，不列为已完成；' : '六窗、三对均在同一运行中完成；') + '清理、输入身份及环境／安全组恢复PASS。旧7.014681892332786% FAIL保留历史来源和UNKNOWN根因，原180秒表不覆盖，完整P13信用0。'
  });
  await raw(['P13'], 'telemetry-9000s-20261021-result.json', '遥测原生媒体／UI／持久化：9000秒资源门',
    '独立原输入9030.448秒资源门、预热300秒，原资源阈值PASS；不是新的三对OFF/ON性能通过，也不是B14八小时／100周期。', {locator: '/long_resource_gate/status'});

  const scoped = [
    [['P02', 'P03', 'P12', 'P17'], 'ui-smoke-export-observed15-20261021-scoped.json', 'UI15三轮短测与三次生产导出回读', 'strict UI短测3/3轮、三次生产导出回读；仅UI／导出范围，不授媒体、L3、长期内存、fault恢复或全隐私注入通过。'],
    [['P02', 'P12', 'P17'], 'turn02-export-readback-20261021-scoped.json', 'TURN02封存源：生产导出与独立回读', '7文件、93 revisions、61104指标及17 timeline的封存源生产导出回读；不重跑媒体，不等于fault后实时当前导出或整组通过。'],
    [['P03'], 'p03-cpu-static-content17b-20261022-scoped.json', '四主题Qt CPU静帧与16个桌面合成像素', '单远端静帧、同帧／绑定／自然Paint身份及16个合成像素限定闭合；不是逐帧Present、物理显示像素、运动媒体或全renderer矩阵。'],
    [['P21'], 'theme-restart04-20261021-scoped.json', '四主题设置：产品重启恢复', '四主题独立进程设置及重启恢复，原strict输入和自然退出；不是首屏物理无闪烁、媒体连续性或完整舞台矩阵。'],
    [['P21'], 'theme-invalid02-20261021-scoped.json', '主题无效值：unsupported token回退', '原unsupported token种子、实际settings读回及回退；不外推任意畸形INI或首窗物理显示。'],
    [['P21'], 'theme-configuration-seeds01-20261021-scoped.json', '主题配置：empty／wrong-section两个有限种子', '两个有限隔离配置种子的原完成Read；保留未使用pin在运行后的漂移，不外推任意INI、首窗或换机。'],
    [['P21'], 'theme-first-window02-20261021-scoped.json', '主题：派生首窗限定观察', '原限定首窗颜色／配置恢复观察；非物理扫描显示或无闪烁认证，不扩展到系统往返或媒体矩阵。'],
    [['P21'], 'p21-system-theme16-20261021-scoped.json', '系统主题：真实Windows偏好八行', '真实Windows light/dark偏好往返八行与恢复、strict输入及自然退出；仅该工件及设置窗口范围。'],
    [['P21'], 'p21-meeting-theme04-20261022-scoped.json', '会中主题：DX11限定设置交互', '真实设置控件与合成媒体并发，DX11原工件限定范围；不授完整舞台视觉矩阵或物理声学通过。'],
    [['P21'], 'p21-meeting-cpu05-20261022-scoped.json', '会中主题：Qt CPU限定设置交互', '真实设置控件与合成媒体并发，Qt CPU原工件限定范围；初始render stall保留，不授新连续性阈值或逐帧像素完整性。'],
    [['P21'], 'p21-meeting-opengl05-20261022-scoped.json', '会中主题：当前GLES模块限定设置交互', '当前GLES模块真实会中设置与合成媒体；不能外推Desktop OpenGL、完整DPI／舞台矩阵或传递性全新构建。']
  ];
  for (const [codes, name, title, scope] of scoped) await raw(codes, name, title, scope);
  const ui9 = await read('data/completed-evidence/ui-timing-theme-unblocked09-20261021-scoped.json');
  add(['P03'], ui9, '/timing/status', {id: 'ui9-typed-timing', title: 'UI09 typed耗时：仅观测', date: sourceDate(ui9),
    scope: '按同run业务终态和Qt投影关联的入会、离会及首绘耗时观测；无新增性能阈值，OBSERVATION_ONLY不授性能PASS。'});
  add(['P21'], ui9, '/theme/status', {id: 'ui9-theme-settings', title: 'UI09：四主题设置窗口交互', date: sourceDate(ui9),
    scope: '四主题settings选择、持久化与同进程重开；其他重启、首窗、真实系统偏好及会中renderer范围分别用各自专项，不拼成完整P21通过。'});
  const artifact = await read('data/completed-evidence/p14-artifact-identity-20261021-scoped.json');
  for (const [field, title] of [['old_deployment', '旧部署EXE／renderer DLL与PDB身份'], ['current_renderer_build', '当前renderer DLL／PDB身份'], ['negative_control', '真实交换PDB：预期拒绝负例'], ['offline_renderer_symbols', '两个renderer离线源码定位']]) add(['P14'], artifact, '/' + field + '/status', {
    id: 'artifact-' + field, title, date: sourceDate(artifact),
    scope: '非最终发行工件的只读限定审计；' + (field === 'old_deployment' ? '保留部署DLL/PDB age不匹配FAIL，不推断历史UI15运行身份。' : '仅本条身份／负例／离线定位条件。') + ' 未执行全新克隆、签名、安装升级卸载或外机启动，不授发行工件通过。'
  });

  // Keep independent completed historical scopes when no matching newer execution exists.
  // This immutable input catalog is a sealed summary, not a claim that external raw files are present.
  const baseline = await read('data/report-input.json');
  const p15Source = await read('reports/product/p15-lan-clock-20261022.json');
  const latestP15 = p15Source.value;
  assert.equal(latestP15.schema, 'cohavora-p15-clock-retest-v1');
  assert.equal(latestP15.status, 'PASS');
  assert.equal(latestP15.full_gate_credit, 0);
  const p15Metrics = latestP15.metrics;
  add(['P15'], p15Source, '/status', {
    id: 'p15-aliyun-software-clock', title: '双机软件校时 · LAN直连／媒体经阿里云SFU', date: latestP15.finished_beijing,
    scope: 'run=' + latestP15.run_id + '；LAN UDP校时，媒体经阿里云任务SFU；affine_interval_v1。最大保守不确定度'
      + p15Metrics.clock_uncertainty_us + '≤' + p15Metrics.gate_us + 'us PASS；有效软件单程样本'
      + p15Metrics.valid_one_way_samples + '/' + p15Metrics.requested_probes + '，marker匹配'
      + p15Metrics.marker_matched + '/' + p15Metrics.requested_probes + '；四时间戳与事件误差包络独立复算PASS。历史H122的41.258ms FAIL及UNKNOWN根因、原阿里云SFU的26.496ms FAIL保留原始证据及归档报告，不追判历史分项根因已修复。真实产品跨机媒体延迟门与独立光学／声学物理门未执行；合成媒体仅到软件提交，完整P15信用0。'
  });
  const legacy = [
    ['H115', ['P08']], ['H116', ['P08']], ['H123', ['P10']],
    ['H125', ['P01']], ['H127', ['P14']], ['H129', ['P21']], ['H133', ['P06']],
    ['H135', ['P06']], ['H136', ['P07']], ['H154', ['P07']], ['H171', ['P18']],
    ['H175', ['P14']]
  ];
  for (const [id, codes] of legacy) {
    const index = baseline.value.historicalRecords.findIndex(record => record.id === id);
    assert.ok(index >= 0, 'Missing retained independent historical scope: ' + id);
    const row = baseline.value.historicalRecords[index];
    add(codes, baseline, '/historicalRecords/' + index + '/status', {id: 'historical-' + id, title: '历史保留 · ' + row.title, date: row.date,
      scope: '原输入／原日期的封存摘要；未新增同范围重测，不继承为当前工件PASS。原范围：' + text(row.evidence_scope) + '；' + text(row.limitations) + (id === 'H154' ? ' 本条仅保留历史24轮提升令牌ETW instrumentation／owner链专项，不重复计为新的生命周期或长稳完成。' : '')});
  }
  const b14 = await read('reports/b14/b14-clipboard-readmission-20261019-01.json');
  assert.equal(b14.value.qualification.completed_pilots.length, 3);
  const p19 = await read('data/completed-evidence/p19-qualification-20261023-completed-scoped.json');
  assert.equal(p19.value.qualification_passes, 3);assert.equal(p19.value.full_media_gpu_ready, true);
  add(['P19'], p19, '/status', {id: 'current-local-b14-three-pilots', title: '本机当前冻结输入：3/3完整资格准入', date: p19.value.finished_utc,
    scope: 'controller=' + p19.value.controller_id + '；三次独立同进程双周期PILOT全部PASS，仅本机direct冻结环境READY。P19仍PARTIAL／full_gate_credit=0；摄像头专项、其他host与Formal保持独立原边界。'});
  const camera = await read('data/completed-evidence/p19-camera-rejoin-20261023-scoped.json');
  add(['P19'], camera, '/status', {id: 'historical-camera-two-cycle-scoped', title: '摄像头二次入会原专项：33 PASS／0 FAIL', date: camera.value.test_date,
    scope: camera.value.completed_scope + ' ' + camera.value.limitations.join(' ')});
  const summary = await read('data/b14-100-cycle-summary.json');
  assert.equal(b14.value.formal.status, 'FAIL');
  assert.equal(b14.value.formal.raw_verdict, 'FAIL');assert.equal(b14.value.formal.exception, null);
  add(['P20'], b14, '/formal/status', {id: 'current-b14-latest-complete', title: '最新完整B14：100周期／8小时（user_pass）', date: summary.value.process.uia_finished_utc,
    scope: 'run=' + b14.value.formal.run_id + '；100周期／' + summary.value.process.uia_duration_seconds + '秒；3200逐轮检查及11最终检查通过，唯一跨周期Private增长95.869140625MiB＞原64MiB，根因UNKNOWN；原runner/owner exit1。原机器FAIL保留；2026-10-23用户暂定PASS另见data/b14-user-disposition-20261023.json，不扣除估算保留量、不改变旧门限。P19资格、摄像头专项及其他host保持独立；无新重测或发布信用。'});


  const repairedNative = await read('data/completed-evidence/repair-native-clear-20261022-runtime.json');
  const repairCloseout = await read('data/completed-evidence/repair-native-clear-20261022-closeout.json');
  assert.equal(repairedNative.value.status, 'PASS_SCOPED_NATIVE_RUNTIME_ONLY');
  assert.equal(repairedNative.value.fixtures.length, 3);
  assert.ok(repairedNative.value.fixtures.every(fixture => fixture.status === 'PASS' && fixture.exit_code === 0));
  assert.equal(repairCloseout.value.acceptance_credit, 0);
  add(['P06'], repairedNative, '/status', {
    id: 'native-clear-direct-runtime', title: '派生Native：三项clear／等待／DX11直接运行', date: '来源收口于 ' + repairCloseout.value.updated_utc + '（非逐项执行时间）',
    scope: 'track/router、Room PC/DC等待及默认DX11模块clear/fence三项直接运行均PASS；仅派生Native模块范围。SDK ACK／SFU收据未直接观测，替换、full reconnect及完整marker未取得本次端到端信用；不覆盖原Flutter失败、跨SDK内容、物理显示或完整E2EE。'
  });
  const repairedArtifact = await read('data/completed-evidence/repair-artifact-identity-20261022-result.json');
  assert.equal(repairedArtifact.value.pairs.length, 3);
  assert.deepEqual(repairedArtifact.value.errors, []);
  assert.ok(Object.values(repairedArtifact.value.checks).every(value => value === true));
  assert.equal(repairedArtifact.value.runtime_renderer_bindings.length, 2);
  assert.ok(repairedArtifact.value.runtime_renderer_bindings.every(binding => binding.same_bytes === true
    && binding.runtime.sha256 === repairedArtifact.value.pairs.find(pair => pair.id === binding.id)?.binary.sha256));
  results.get('P14').delete('artifact-old_deployment');
  results.get('P14').delete('artifact-current_renderer_build');
  add(['P14'], repairedArtifact, '/status', {
    id: 'artifact-current-staged-pairs', title: '当前diagnostic-ON产品：三对EXE／DLL／PDB身份及部署副本校验', date: repairedArtifact.value.completed_utc,
    scope: '本次EXE、DX11／OpenGL DLL三对PDB身份及staged输出校验通过；两份runtime renderer部署副本与对应构建DLL的SHA256一致。source provenance、最终SDK／Flutter冻结和发行资格未验证，产品runtime未运行；10月21日旧部署age错配属于不同工件，原失败及证据仅保留历史追溯，不重复计入当前结果。'
  });
  const remoteOutput = await read('data/completed-evidence/repair-remote-output-20261022-receipt.json');
  assert.equal(remoteOutput.value.focused_gates.length, 2);
  assert.ok(remoteOutput.value.focused_gates.every(gate => gate.exit === 0));
  add(['P18'], remoteOutput, '/implementation_status', {
    id: 'remote-output-focused-contract', title: '远控诊断输出：ON／OFF直接工程门', date: remoteOutput.value.date,
    scope: '仅remote_control_probe_nonblocking_output_only：阻塞sink下暂停／停止／销毁可返回，单worker及latest-only队列有界；非真实双机、物理输入、安全桌面或长稳验收，无硬耗时上限声明。'
  });

  skipped.push(
    {scope: 'superseded network executions and batch summaries', reason: 'P09仅展示最新同批11个case；旧十项FAIL及独立TURN原判定保留来源历史，不再计入当前结果；同批汇总不重复计作第12项。'},
    {scope: '2026-10-21 deployment and renderer identity display', reason: '当前工件身份栏目仅采用10月22日三对staged工件及两份runtime部署副本校验结果；旧部署FAIL及旧renderer身份来源保留历史追溯，不重复计入当前结果。独立交换PDB负例及离线源码定位继续显示各自原结果。'},
    {scope: '2026-10-22 repair attempts and preparation', reason: '入会前失败、零媒体互通尝试与仅准备的实服重测不替换原Flutter格；P13仅采用最新完成60秒配对，容量没有新同范围完成结果。'},
    {scope: 'P15 historical H122 current display', reason: '当前仅显示最新完成LAN双机软件校时PASS；历史H122原输入及41.258ms FAIL、原阿里云SFU 26.496ms FAIL保留原判定和证据，不重复计作当前结果。路径与模型不同，不宣称原失败分项根因已解决；真实产品媒体延迟门与物理门未执行。'},
    {scope: 'functional observations history', reason: '仅使用current_observations；不重复旧attempt或同case的多gate映射。'},
    {scope: 'official Flutter/C++ historical checks', reason: '用latest_projection逐格终态；不展示已被替代的旧失败／未定attempt。'},
    {scope: 'desktop UI08/UI-smoke01/whiteboard1800-fullscreen02', reason: '对应最新完成结果为UI09、UI15、whiteboard1800-fixed04；旧失败仅留审计。'},
    {scope: 'desktop whiteboard-functional/capture-quality-fullscreen parent summaries', reason: '分别使用同run的B12及complex-wgc-screen原始回执；父汇总不重复计数。'},
    {scope: 'official audio content04', reason: 'windows01明确替代同范围；content04仅保留历史支持来源。'},
    {scope: 'P13 remaining pairs and instrumented diagnostics', reason: '只投影最新安全回执中已完成的60秒配对；未执行部分不列结果。旧首对7.014681892332786% FAIL仅留历史追溯，不重复计当前case；诊断只定位，不替代正式判定。'},
    {scope: 'P16 physical environment', reason: '无可信已完成真实物理操作；软件fault injection不冒充物理恢复。'},
    {scope: 'legacy B14 retry07/partial attempts', reason: '采用最新完整100周期／8小时实测；当前user_pass独立于原机器FAIL，历史结果按原run保留，运行继续暂停。'}
  );
  // Preserve exact completed verdicts while exposing the separately authorized disposition.
  const b14DecisionSource = await read('data/b14-user-disposition-20261023.json');
  const b14Decision = b14DecisionSource.value;
  assert.equal(b14Decision.schema, 'cohavora-b14-user-provisional-disposition-v1');
  assert.equal(b14Decision.status, 'user_pass');
  assert.equal(b14Decision.raw_verdict, b14.value.formal.raw_verdict);
  assert.equal(b14Decision.run_id, b14.value.formal.run_id);
  assert.equal(b14Decision.preserved.full_gate_credit, 0);
  assert.equal(groups.get('P20').stage_status.status, b14Decision.status);
  results.get('P20').get('current-b14-latest-complete').current_disposition = {
    status: b14Decision.status, date: b14Decision.date,
    source_path: b14DecisionSource.relative, source_locator: '/status',
    report_path: b14DecisionSource.relative
  };
  const deferredSource = await read('reports/product/p05-p06-deferred-remediation-20261022.json');
  const deferred = deferredSource.value;
  assert.equal(deferred.schema, 'cohavora-p05-p06-deferred-bugs-v1');
  assert.equal(deferred.status, 'DEFERRED');
  assert.equal(deferred.execution, 'NOT_RUN');
  assert.equal(deferred.full_gate_credit, 0);
  assert.deepEqual(deferred.case_dispositions.map(row => row.result_id).sort(),
    ['flutter-flutter-full', 'flutter-repair-derivative-flutter-full', 'flutter-replace-two']);
  for (const [index, disposition] of deferred.case_dispositions.entries()) {
    assert.equal(disposition.status, 'DEFERRED');
    assert.equal(disposition.original_status, 'FAIL');
    assert.deepEqual(disposition.plan_codes, ['P05', 'P06']);
    assert.ok(deferred.bugs.some(bug => bug.id === disposition.bug_id));
    for (const code of disposition.plan_codes) {
      const record = groups.get(code), result = results.get(code).get(disposition.result_id);
      assert.equal(record.stage_status.status, 'DEFERRED');
      assert.equal(record.stage_status.disposition_source, deferredSource.relative);
      assert.ok(result, 'Deferred result must already have a completed source');
      assert.equal(result.status, disposition.original_status);
      assert.equal(result.source_path, disposition.source_path);
      assert.equal(result.source_locator, disposition.source_locator);
      result.current_disposition = {
        status: disposition.status, date: deferred.decision_at, bug_id: disposition.bug_id,
        source_path: deferredSource.relative, source_locator: '/case_dispositions/' + index + '/status',
        report_path: record.stage_status.disposition_report
      };
    }
  }
  skipped.push({scope: 'P05/P06 deferred repair work', reason: '两个共享bug、三条失败来源仅更新当前处置为DEFERRED；原实测FAIL及修复衍生PASS保留，隔离诊断不新增产品计项。'});
  for (const [code, record] of groups) record.completed_results = [...results.get(code).values()];
  assert.deepEqual(data.retestRecords.map(stripResults), before, 'Completed-result projection must preserve all existing record fields');
  data.completedResultProjection = {
    schema: 'cohavora-completed-plan-results-v1', source_policy: 'Latest completed matching scope only; original verdict and input boundaries retained; no new execution or full-gate credit',
    evidence_written: false, new_test_execution: 'NOT_RUN', full_gate_credit: 0,
    sources, skipped,
    groups: [...groups].map(([plan_code, record]) => ({plan_code, completed_result_count: record.completed_results.length,
      status_counts: record.completed_results.reduce((counts, result) => { counts[result.status] = (counts[result.status] || 0) + 1; return counts; }, {}),
      current_status_counts: record.completed_results.reduce((counts, result) => { const status = result.current_disposition?.status || result.status; counts[status] = (counts[status] || 0) + 1; return counts; }, {}),
      ...(record.completed_results.length ? {} : {empty_reason: '没有可投影的已完成同口径实测终态；未执行、仅尝试及未完成范围不补造结果。'})}))
  };
  return data;
}
