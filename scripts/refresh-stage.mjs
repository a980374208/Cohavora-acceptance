import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const norm = value => String(value).replaceAll('\\', '/').toLowerCase();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
const unique = values => [...new Set(values)];

/** Project completed scoped evidence into the existing cards and plan boundaries. */
export async function refreshStage(root, data, {writeEvidence = true} = {}) {
  const originalMetrics = data.highlights.map(card => ({id: card.id, metrics: structuredClone(card.metrics)}));
  const originalB14 = structuredClone(data.highlights.find(card => card.id === 'highlight-b14'));
  const originalCycleSummary = structuredClone(data.b14CycleSummary);
  const originalMemory = structuredClone(data.memoryUsageSummary);
  const sources = [];
  data.portableFiles ??= {};
  const register = (relative, bytes, original = relative) => {
    const receipt = {original_path: original, portable_path: relative, sha256: hash(bytes), bytes: bytes.length, status: 'COMPLETED_SCOPED_RESULT_SOURCE'};
    for (const name of [relative, path.join(root, relative), original]) data.portableFiles[norm(name)] = receipt;
    if (!sources.some(source => source.path === relative)) sources.push({path: relative, sha256: receipt.sha256, bytes: bytes.length, original_path: original});
    return {value: relative.endsWith('.json') ? parse(bytes) : null, relative, receipt};
  };
  const read = async relative => register(relative, await fs.readFile(path.join(root, relative)));
  const freeze = async (original, name, expectedHash) => {
    const relative = 'data/completed-evidence/' + name;
    let bytes;
    try { bytes = await fs.readFile(path.join(root, relative)); }
    catch (error) {
      if (error.code !== 'ENOENT' || !writeEvidence) throw error;
      bytes = await fs.readFile(original);
    }
    assert.equal(hash(bytes), expectedHash, 'Frozen stage source changed: ' + original);
    if (writeEvidence) await fs.writeFile(path.join(root, relative), bytes);
    return register(relative, bytes, original);
  };
  const stageSource = await read('data/stage-closure-20261022.json');
  const stageReport = await read('reports/product/stage-closure-20261022.json');
  const stageHTML = await read('reports/product/stage-closure-20261022.html');
  const stage = stageSource.value, report = stageReport.value;
  assert.equal(stage.status, 'STAGE_CLOSED_PARTIAL');
  assert.equal(stage.full_plan_gates_completed, 0);
  assert.equal(stage.formal_credit, 0);
  assert.equal(stage.p20_credit, 0);
  assert.equal(stage.production_ready, false);
  assert.equal(report.final_snapshot, true);
  assert.equal(report.draft, false);
  assert.equal(report.summary.final_regression_status, 'NOT_RUN');
  assert.equal(stage.groups.length, 24);
  const stageByCode = new Map(stage.groups.map(group => [group.plan_code, group]));

  // Retain the original closed stage and bind later completed subscopes separately.
  const repairSources = await read('data/completed-evidence/repair-validation-20261022-sources.json');
  assert.equal(repairSources.value.status, 'COMPLETED_SCOPES_ONLY');
  assert.equal(repairSources.value.full_gate_credit, 0);
  for (const receipt of repairSources.value.sources) {
    const source = await read(receipt.path);
    assert.equal(source.receipt.sha256, receipt.sha256, 'Completed repair source changed: ' + receipt.path);
    assert.equal(source.receipt.bytes, receipt.bytes);
  }
  data.completedRepairRefresh = {
    date: repairSources.value.date,
    evidence_completed_at: repairSources.value.evidence_completed_at,
    source: repairSources.relative,
    sources: structuredClone(repairSources.value.sources),
    excluded: structuredClone(repairSources.value.excluded),
    full_gate_credit: 0,
    product_retest_executed_by_document_refresh: false
  };
  for (const [code, names] of [
    ['P06', ['repair-native-clear-20261022-runtime.json', 'repair-native-clear-20261022-closeout.json']],
    ['P14', ['repair-artifact-identity-20261022-result.json']],
    ['P18', ['repair-remote-output-20261022-receipt.json']],
    ['A01', ['repair-flutter-key-20261022-result.json', 'repair-flutter-dispose-20261022-result.json']]
  ]) {
    const target = data.retestRecords.find(record => record.plan_code === code);
    target.sources = unique([...target.sources, ...names.map(name => 'data/completed-evidence/' + name)]);
  }

  const networkSource = await read('data/completed-evidence/p09-network-eleven-20261022-scoped.json');
  const network = networkSource.value;
  const networkCases = ['baseline', 'packet-loss', 'jitter', 'bandwidth', 'network-loss', 'service-restart', 'signal-reconnect', 'full-reconnect', 'auth-recovery', 'path-switch', 'turn-relay'];
  assert.equal(network.status, 'PASS');
  assert.equal(network.case_count, 11);
  assert.equal(network.full_P09_gate_credit, 0);
  assert.deepEqual(network.cases.map(row => row.case), networkCases);
  for (const field of ['case_status', 'cleanup_status', 'input_identity_status', 'environment_restore_status', 'security_group_restore_status']) assert.equal(network[field], 'PASS');
  assert.ok(network.cases.every(row => row.status === 'PASS' && row.case_status === 'PASS' && row.cleanup_status === 'PASS' && row.persistence_close_status === 'PASS'));
  data.completedNetworkRefresh = {
    source: networkSource.relative, sha256: networkSource.receipt.sha256, bytes: networkSource.receipt.bytes,
    finished_utc: network.finished_utc, closed_utc: network.closed_utc,
    case_count: network.case_count, status: network.status,
    group_status: 'PARTIAL', full_gate_credit: 0,
    not_covered: structuredClone(network.not_covered),
    original_stage_source: stageSource.relative,
    product_retest_executed_by_document_refresh: false
  };
  for (const code of ['P02', 'P09']) {
    const target = data.retestRecords.find(record => record.plan_code === code);
    target.sources = unique([...target.sources, networkSource.relative]);
  }

  const telemetrySource = await read('data/completed-evidence/p13-performance-paired-20261022-scoped.json');
  const latestTelemetry = telemetrySource.value;
  assert.equal(latestTelemetry.schema, 'cohavora-p13-performance-paired-completed-scoped-v1');
  assert.ok(['PASS', 'FAIL'].includes(latestTelemetry.status));
  assert.equal(latestTelemetry.paired_status, latestTelemetry.status);
  assert.equal(latestTelemetry.requested_seconds, 60);
  assert.equal(latestTelemetry.requested_pairs, 3);
  assert.ok(latestTelemetry.completed_pairs >= 1 && latestTelemetry.completed_pairs <= latestTelemetry.requested_pairs);
  assert.equal(latestTelemetry.remaining_pairs, latestTelemetry.requested_pairs - latestTelemetry.completed_pairs);
  if (latestTelemetry.remaining_pairs) assert.equal(latestTelemetry.remaining_pairs_status, 'NOT_RUN');
  assert.equal(latestTelemetry.full_P13_gate_credit, 0);
  assert.equal(latestTelemetry.root_cause, 'UNKNOWN');
  assert.equal(latestTelemetry.diagnostic_stage_timing, false);
  for (const field of ['cleanup_status', 'input_identity_status', 'environment_restore_status', 'security_group_restore_status']) assert.equal(latestTelemetry[field], 'PASS');
  const expectedWindows = Array.from({length: latestTelemetry.completed_pairs}, (_, index) =>
    (index % 2 ? ['on', 'off'] : ['off', 'on']).map(mode => String(index + 1) + '-' + mode)).flat();
  assert.deepEqual(latestTelemetry.windows.map(row => row.name), expectedWindows);
  assert.ok(latestTelemetry.windows.every(row => row.status === 'PASS' && row.requested_seconds === 60 && row.stage_timing_enabled === false && row.diagnostic_artifacts_absent === true));
  assert.equal(latestTelemetry.pairs.length, latestTelemetry.completed_pairs);
  for (const latestPair of latestTelemetry.pairs) {
    assert.ok(['PASS', 'FAIL'].includes(latestPair.status));
    assert.equal(latestPair.limits.callback_p99_increase_percent, 5);
  }
  assert.ok(latestTelemetry.pairs.slice(0, -1).every(row => row.status === 'PASS'));
  if (latestTelemetry.status === 'PASS') {
    assert.equal(latestTelemetry.completed_pairs, latestTelemetry.requested_pairs);
    assert.ok(latestTelemetry.pairs.every(row => row.status === 'PASS'));
  } else assert.equal(latestTelemetry.pairs.at(-1).status, 'FAIL');
  data.completedTelemetryRefresh = {
    source: telemetrySource.relative, sha256: telemetrySource.receipt.sha256, bytes: telemetrySource.receipt.bytes,
    finished_utc: latestTelemetry.finished_utc, closed_utc: latestTelemetry.closed_utc,
    status: latestTelemetry.status, requested_seconds: latestTelemetry.requested_seconds,
    requested_pairs: latestTelemetry.requested_pairs, completed_pairs: latestTelemetry.completed_pairs,
    remaining_pairs: latestTelemetry.remaining_pairs, remaining_pairs_status: latestTelemetry.remaining_pairs_status,
    group_status: data.retestRecords.find(record => record.plan_code === 'P13').status,
    full_gate_credit: 0, root_cause: latestTelemetry.root_cause,
    original_stage_source: stageSource.relative,
    product_retest_executed_by_document_refresh: false
  };
  const telemetryPlan = data.retestRecords.find(record => record.plan_code === 'P13');
  telemetryPlan.sources = unique([...telemetryPlan.sources, telemetrySource.relative]);

  const p15Source = await read('reports/product/p15-lan-clock-20261022.json');
  const latestP15 = p15Source.value;
  assert.equal(latestP15.schema, 'cohavora-p15-clock-retest-v1');
  assert.equal(latestP15.status, 'PASS');
  assert.equal(latestP15.full_gate_credit, 0);
  assert.equal(latestP15.metrics.requested_probes, 30);
  assert.equal(latestP15.metrics.gate_us, 10000);
  assert.equal(latestP15.metrics.clock_uncertainty_us, 2898);
  assert.equal(latestP15.metrics.valid_one_way_samples, 30);
  assert.equal(latestP15.clock_route, 'lan_udp');
  assert.equal(latestP15.validation.independent_recalculation_status, 'PASS');
  for (const field of ['cleanup_confirmed', 'evidence_complete', 'binary_unchanged']) assert.equal(latestP15.validation[field], true);
  assert.equal(latestP15.validation.environment_cleanup_status, 'PASS');
  data.completedP15Refresh = {
    source: p15Source.relative, sha256: p15Source.receipt.sha256, bytes: p15Source.receipt.bytes,
    run_id: latestP15.run_id, status: latestP15.status,
    finished_utc: latestP15.finished_utc, finished_beijing: latestP15.finished_beijing,
    full_gate_credit: 0, product_retest_executed_by_document_refresh: false
  };
  const p15Plan = data.retestRecords.find(record => record.plan_code === 'P15');
  p15Plan.sources = unique([...p15Plan.sources, p15Source.relative]);

  const p19Source = await read('data/completed-evidence/p19-qualification-20261023-completed-scoped.json');
  const p19 = p19Source.value;
  assert.equal(p19.schema, 'cohavora-p19-qualification-completed-scoped-v1');
  assert.equal(p19.status, 'READY');assert.equal(p19.full_media_gpu_ready, true);
  assert.equal(p19.controller_id, 'e4b0a73762e84cb9ace03afc5fcb22f3');
  assert.equal(p19.qualification_passes, 3);assert.equal(p19.completed_pilots.length, 3);
  assert.equal(new Set(p19.completed_pilots.map(row => row.run_id)).size, 3);
  assert.ok(p19.completed_pilots.every(row => row.verdict === 'PILOT_PASS' && row.cycles_pass === 2 && row.check_counts.PASS === 78 && Object.keys(row.check_counts).length === 1));
  assert.equal(p19.group_status, 'PARTIAL');assert.equal(p19.full_gate_credit, 0);
  assert.equal(p19.formal, 'NOT_RUN');assert.equal(p19.thresholds_changed, false);
  assert.equal(p19.camera.status, 'PARTIAL');assert.equal(p19.other_hosts[0].status, 'PARTIAL');
  assert.deepEqual(p19.plan_update.stage_status.gates.map(row => row.status), ['PASS_SCOPED', 'PASS_SCOPED', 'PARTIAL', 'PASS_SCOPED', 'READY']);
  // Keep the qualification snapshot unchanged; correct only the camera display
  // from its original terminal review and recorded deterministic owner test.
  const cameraSource = await read('data/completed-evidence/p19-camera-rejoin-20261023-scoped.json');
  const camera = cameraSource.value;
  assert.equal(camera.schema, 'cohavora-p19-camera-rejoin-completed-scoped-v1');
  assert.equal(camera.status, 'PASS_SCOPED');assert.equal(camera.original_verdict, 'PASS');
  assert.deepEqual(camera.checks, {PASS: 33, FAIL: 0});
  for (const field of ['qualification_credit', 'formal_credit', 'full_gate_credit']) assert.equal(camera[field], 0);
  for (const receipt of camera.sources) {
    const bytes = await fs.readFile(path.join(root, receipt.path));
    const source = register(receipt.path, bytes, receipt.original_path);
    assert.equal(source.receipt.sha256, receipt.sha256);assert.equal(bytes.length, receipt.bytes);
    if (receipt.locator === '/camera_scoped_verdict') {
      assert.equal(source.value.camera_scoped_verdict, camera.original_verdict);
      assert.equal(source.value.run_id, camera.run_id);assert.equal(source.value.reviewed_utc, camera.test_date);
      assert.equal(source.value.b14_qualification_credit, false);assert.equal(source.value.formal_status, 'NOT_RUN');
      assert.equal(Object.keys(source.value.checks).length, 33);
      assert.ok(Object.values(source.value.checks).every(check => check.status === 'PASS'));
    } else {
      assert.equal(receipt.testcase, 'camera_owner_remediation_test');
      const testcase = bytes.toString('utf8').match(/<testcase\b[^>]*name="camera_owner_remediation_test"[^>]*>[\s\S]*?<\/testcase>/)?.[0];
      assert.ok(testcase?.includes('status="run"') && !/<(?:failure|error|skipped)\b/.test(testcase));
      for (const observation of ['A alive timeout reaches GUI once', 'A first frame success reaches GUI once', 'D queued timeout rejected by session invalidation']) assert.ok(testcase.includes(observation));
    }
  }
  const cameraAssessment = structuredClone(p19.plan_update.stage_status);
  cameraAssessment.completed_scope[2] = camera.completed_scope;
  assert.ok(cameraAssessment.remaining[1].startsWith('摄像头二次入会独立专项仍PARTIAL：'));
  cameraAssessment.remaining.splice(1, 1);
  cameraAssessment.gates[2].status = camera.status;
  cameraAssessment.gates[2].interpretation = camera.interpretation;
  cameraAssessment.evidence_refs.push(cameraSource.relative);
  const p19Plan = data.retestRecords.find(record => record.plan_code === 'P19');
  assert.deepEqual(p19Plan.stage_status, cameraAssessment, 'P19 camera correction must preserve all other recorded qualification fields');
  p19Plan.sources = unique([...p19Plan.sources, p19Source.relative, cameraSource.relative]);
  data.completedP19CameraRefresh = {
    source: cameraSource.relative, sha256: cameraSource.receipt.sha256, bytes: cameraSource.receipt.bytes,
    status: camera.status, original_verdict: camera.original_verdict, run_id: camera.run_id,
    test_date: camera.test_date, checks: structuredClone(camera.checks), sources: structuredClone(camera.sources),
    group_status: p19.group_status, qualification_credit: 0, formal_credit: 0, full_gate_credit: 0,
    original_qualification_receipt_changed: false, new_test_execution: 'NOT_RUN'
  };
  data.completedP19Refresh = {
    source: p19Source.relative, sha256: p19Source.receipt.sha256, bytes: p19Source.receipt.bytes,
    status: p19.status, finished_utc: p19.finished_utc, controller_id: p19.controller_id,
    qualification_passes: p19.qualification_passes, run_ids: p19.completed_pilots.map(row => row.run_id),
    group_status: p19.group_status, full_gate_credit: 0, formal: p19.formal,
    camera_status: camera.status, original_camera_assessment: p19.camera.status,
    camera_source: cameraSource.relative, other_hosts: structuredClone(p19.other_hosts),
    report_path: 'reports/b14/b14-full-standard-20261020-01.html',
    original_stage_source: stageSource.relative, product_retest_executed_by_document_refresh: false
  };

  const flutterDiagnosisSource = await read('data/completed-evidence/flutter-full-rtp-sif-20261022-diagnosis.json');
  const flutterExecutionSource = await read('data/completed-evidence/flutter-full-rtp-sif-20261022-execution.json');
  const diagnosis = flutterDiagnosisSource.value, execution = flutterExecutionSource.value;
  assert.equal(diagnosis.status, 'DIAGNOSTIC_SFU_BLANK_FRAME_ENQUEUE_MATCHED');
  assert.equal(execution.status, 'DIAGNOSTIC_RUN_TERMINAL');
  assert.equal(execution.peer_run_id, diagnosis.peer_run_id);
  assert.equal(execution.run_id, diagnosis.capture_run_id);
  assert.equal(diagnosis.evidence_sha256['execution.json'], flutterExecutionSource.receipt.sha256);
  for (const result of [diagnosis, execution]) {
    assert.equal(result.acceptance_credit, 0);assert.equal(result.full_gate_credit, 0);
    assert.equal(result.cleanup_confirmed, true);assert.equal(result.peer_verdict, 'FAIL');
    assert.equal(result.matched_frames, 6);assert.equal(result.invalid_frames, 6);
  }
  assert.equal(diagnosis.matches.length, 6);
  assert.equal(diagnosis.historical_run_0770_attribution, 'STRONG_CANDIDATE_NOT_RETROSPECTIVELY_CONFIRMED');
  data.completedFlutterDiagnosis = {
    source: flutterDiagnosisSource.relative, execution_source: flutterExecutionSource.relative,
    sha256: flutterDiagnosisSource.receipt.sha256, execution_sha256: flutterExecutionSource.receipt.sha256,
    original_directory: 'E:/vsSource/WebRTC/live-kit-test-local/out/flutter-full-rtp-sif-capture-20261022-01',
    finished_at: diagnosis.finished_beijing, status: diagnosis.status,
    peer_run_id: diagnosis.peer_run_id, acceptance_credit: 0, full_gate_credit: 0,
    counted_as_product_result: false, replaces_shared_retest: false,
    product_retest_executed_by_document_refresh: false
  };
  const flutterDiagnosticNote = '18:03完成的独立隔离RTP／SIF诊断仅解释本次run ' + diagnosis.peer_run_id +
    '：508帧中502有效、6异常，原严格检查仍FAIL 69/70；六帧按SSRC／RTP时间戳关联至SFU关闭旧轨时生成的VP8 blank frame，再经Native SIF兼容路径交付。' +
    '仅本次生产者链路已确认，不追判17:20 shared修复衍生run的六帧来源；不替换其522帧结果，不新增产品PASS／FAIL，验收信用0。';
  for (const code of ['P05', 'P06']) {
    const target = data.retestRecords.find(record => record.plan_code === code);
    target.sources = unique([...target.sources, flutterDiagnosisSource.relative, flutterExecutionSource.relative]);
  }

  // A later user disposition does not rewrite the closed-stage or runtime verdicts.
  const deferredSource = await read('reports/product/p05-p06-deferred-remediation-20261022.json');
  const deferredHTML = await read(deferredSource.relative.replace(/\.json$/, '.html'));
  const deferred = deferredSource.value;
  assert.equal(deferred.schema, 'cohavora-p05-p06-deferred-bugs-v1');
  assert.equal(deferred.status, 'DEFERRED');
  assert.equal(deferred.execution, 'NOT_RUN');
  assert.equal(deferred.acceptance_credit, 0);
  assert.equal(deferred.full_gate_credit, 0);
  const deferredNote = '当前P05／P06及三条共享失败来源按用户要求DEFERRED，涉及两个bug；原实测FAIL／日期／输入和replace-two衍生PASS保留。优先评估A1严格新建接收管线，必须复用或隔离无法证明时采用B显式clear／epoch／完成ACK；本轮未修复或重测。';
  data.deferredFlutterBugs = {
    source: deferredSource.relative, report: deferredHTML.relative,
    sha256: deferredSource.receipt.sha256, report_sha256: deferredHTML.receipt.sha256,
    decision_at: deferred.decision_at, status: 'DEFERRED',
    shared_bug_count: deferred.bugs.length, unique_failed_result_records: deferred.case_dispositions.length,
    product_runtime: 'NOT_RUN', full_gate_credit: 0
  };

  const scopedNames = [
    'official-cpp-audio-windows01-20261021-scoped.json',
    'ui-smoke-export-observed15-20261021-scoped.json',
    'ui-timing-theme-unblocked09-20261021-scoped.json',
    'turn02-export-readback-20261021-scoped.json',
    'p03-cpu-static-content17b-20261022-scoped.json',
    'p14-artifact-identity-20261021-scoped.json',
    'theme-restart04-20261021-scoped.json',
    'theme-invalid02-20261021-scoped.json',
    'theme-first-window02-20261021-scoped.json',
    'theme-configuration-seeds01-20261021-scoped.json',
    'p21-system-theme16-20261021-scoped.json',
    'p21-meeting-theme04-20261022-scoped.json',
    'p21-meeting-cpu05-20261022-scoped.json',
    'p21-meeting-opengl05-20261022-scoped.json'
  ];
  for (const name of scopedNames) {
    const source = await read('data/completed-evidence/' + name);
    const expectedStatus = name.startsWith('p14-artifact-identity-') ? 'PARTIAL' : 'PASS_SCOPED';
    assert.equal(source.value.status, expectedStatus, 'Scoped evidence must preserve its original result: ' + name);
    if (expectedStatus === 'PARTIAL') {
      for (const field of ['full_plan_gate_credit', 'formal_credit', 'p20_credit']) assert.equal(source.value[field], 0, 'Partial artifact audit grants no full-gate credit');
    }
  }
  const resource = await read('reports/product/resource-completion-20261021-01.json');
  const boardSource = await read('data/completed-evidence/whiteboard-1800-fixed04-20261021-result.json');
  const board = boardSource.value;
  assert.equal(board.status, 'PASS');
  assert.equal(board.contract.independent_product_processes, 8);
  assert.equal(board.contract.writer_count, 4);
  assert.equal(board.contract.total_share_annotation_cycles, 50);
  assert.ok(board.measured_seconds >= 1800);
  assert.equal(Object.keys(board.writer_strokes).length, 4);
  assert.ok(Object.values(board.writer_strokes).every(strokes => strokes.length === 361));
  assert.equal(Object.keys(board.lifecycle).length, 8);
  assert.ok(Object.values(board.lifecycle).every(peer => peer.exit_code === 0));
  assert.deepEqual(board.peer_cleanup.forced_roles, []);
  assert.equal(board.peer_cleanup.status, 'PASS');
  const pairSource = await freeze(
    'E:/vsSource/WebRTC/live-kit-test-local/out/resource-completion-20261021-01/telemetry-paired-01/index.json',
    'telemetry-paired-first-20261021-index.json',
    '271e7c548683b555ff02b3b6132e77328e9437f1a74ba4f5820f9ff8dddbe27e'
  );
  const pair = pairSource.value;
  assert.equal(pair.status, 'FAIL');
  assert.equal(pair.pairs.length, 1);
  assert.equal(pair.pairs[0].callback_p99_increase_upper_percent, 7.014681892332786);
  assert.equal(pair.pairs[0].limits.callback_p99_increase_percent, 5);
  const pairOffSource = await freeze(
    'E:/vsSource/WebRTC/live-kit-test-local/out/resource-completion-20261021-01/telemetry-paired-01/1-off/result.json',
    'telemetry-paired-first-20261021-off-result.json',
    '8d447c2cbed41f422a09cd581e404b647c0b29bebcfc956d34c908a25d2deee2'
  );
  const pairOnSource = await freeze(
    'E:/vsSource/WebRTC/live-kit-test-local/out/resource-completion-20261021-01/telemetry-paired-01/1-on/result.json',
    'telemetry-paired-first-20261021-on-result.json',
    'a219249e010b2b526a0bc1a1a631133aa896461e32f2719bac2ef5fdaee6309d'
  );
  for (const source of [pairOffSource, pairOnSource]) {
    assert.equal(source.value.status, 'PASS');
    assert.equal(source.value.requested_seconds, 60);
  }
  assert.equal(pairOffSource.value.server_before.config_sha256, pairOnSource.value.server_before.config_sha256);
  const qualitySource = await freeze(
    'E:/vsSource/WebRTC/live-kit-test-local/out/resource-completion-20261021-01/capture-quality-fullscreen-unblocked01/complex-wgc-screen/result.json',
    'capture-quality-2k-20261021-result.json',
    '2da4b1453628daebf6e8bf96d06d8b62187b3af266dd948a211d79e1616d96b8'
  );
  assert.equal(qualitySource.value.status, 'PASS');
  assert.equal(qualitySource.value.receiver_topology, 'two_distinct_native_Rooms_in_one_process');
  assert.equal(qualitySource.value.quality.length, 1);
  const quality = qualitySource.value.quality[0];
  assert.equal(quality.width, 2560);assert.equal(quality.height, 1440);
  assert.equal(quality.warmup_seconds, 15);assert.equal(quality.samples, 30);

  const card = id => { const value = data.highlights.find(item => item.id === id); assert.ok(value, 'Missing original card: ' + id); return value; };
  const addSources = (target, paths) => { target.sources = unique([...target.sources, ...paths, stageHTML.relative]); };
  const addEnvironment = (target, profile) => {
    data.testEnvironments.profiles = [...data.testEnvironments.profiles.filter(item => item.id !== profile.id), profile];
    target.environmentIds = unique([...target.environmentIds, profile.id]);
  };
  const screen = card('highlight-screen-share');
  screen.status = 'PASS（已完成子门；完整P07仍PARTIAL）';
  screen.summary = 'WGC生命周期、1800秒六资源与GDI50保持各自已完成实测；新增桌面后端与2560×1440 WGC客观画质结果按独立范围留存。原15项整批及2K成本仍保留原日期和数值。';
  screen.scope += ' 新完成的complex-wgc-screen仅授2560×1440客观画质：30个样本，PSNR最低45.6195284dB、luma SSIM最低0.997299443、文字PSNR最低41.07155195dB，原门限分别30dB／0.95／30dB；不是新的2K CPU／带宽成本运行。';
  screen.limitations.push('2026-10-22阶段收口：后端／质量短门不关闭物理多屏、混合DPI、横竖屏、跨GPU及人工运动画质；不拼成新的15项整批PASS。');
  addSources(screen, [qualitySource.relative, resource.relative]);
  addEnvironment(screen, {
    id: 'env-wgc-quality-2k-20261021', label: 'WGC 2K客观画质：2026-10-21',
    server: '本run SFU image=' + qualitySource.value.server_before.image + '，binary=' + qualitySource.value.server_before.binary + '，配置SHA256=' + qualitySource.value.server_before.config_sha256 + '。云厂商、服务机CPU／内存／带宽未在该回执单列。',
    client: 'Windows ' + qualitySource.value.configuration + '；同进程两个独立Native Room，PID ' + qualitySource.value.pid + '；EXE SHA256=' + qualitySource.value.binary_identity.binary_sha256 + '。CPU、RAM、GPU型号未在本次结果单列。',
    load: '生产WGC采集／发布／解码，生成文字／色块／滚动图案，' + quality.width + '×' + quality.height + '；预热' + quality.warmup_seconds + '秒后' + quality.samples + '个客观画质样本。',
    boundary: '仅同run客观画质门；不是CPU／带宽成本、独立两台终端、物理画质或完整多屏／DPI矩阵。',
    sources: [{path: qualitySource.relative, basis: 'receiver_topology、configuration、binary_identity、server_before及quality'}]
  });

  const boardCard = card('highlight-whiteboard');
  boardCard.date += '；1800秒协同负载：2026-10-21';
  boardCard.status = 'PASS_SCOPED（原M5）／PASS（B12及1800秒限定负载）';
  boardCard.summary = '原M5合成工程指标及B12八项功能数值保留；新增一机8产品进程、4书写者、1800秒协同与50对真实共享／批注启停完成结果。各运行分别授予限定范围，完整P11仍PARTIAL。';
  boardCard.scope += ' 独立1800-fixed04负载实测' + board.measured_seconds.toFixed(3) + '秒，4位书写者各361笔，50对共享／批注启停，八端最终收敛；8/8自然退出、forced=0，任务所有netem已清除。';
  boardCard.limitations = boardCard.limitations.filter(value => !value.includes('不替代8端／4写者／50对的1800秒协同负载'));
  boardCard.limitations.push('新增1800秒结果是一台电脑上的八个逻辑产品进程；不等于八台物理终端，也不覆盖跨DPI／多GPU完整人工对齐矩阵或实际4K落笔延迟。');
  addSources(boardCard, [boardSource.relative]);
  const boardConfiguration = unique(Object.values(board.lifecycle).map(peer => peer.started.configuration));
  assert.equal(boardConfiguration.length, 1);
  addEnvironment(boardCard, {
    id: 'env-whiteboard-1800-20261021', label: '白板1800秒协同负载：2026-10-21',
    server: '任务所有的独立SFU容器；image=' + board.server_before.image + '，binary=' + board.server_before.binary + '，配置SHA256=' + board.server_before.config_sha256 + '。云厂商、服务机CPU／内存／带宽未在该回执单列。',
    client: 'Windows ' + boardConfiguration[0] + '；一台电脑上的' + board.contract.independent_product_processes + '个独立产品进程、' + board.contract.writer_count + '位书写者；进程身份逐项见lifecycle。CPU、RAM、GPU型号未在该结果单列。',
    load: '约' + board.measured_seconds.toFixed(3) + '秒，每写者' + board.rounds + '笔，' + board.contract.total_share_annotation_cycles + '对真实共享／批注启停。独立容器netem每腿延迟' + board.contract.network.egress_delay_ms + 'ms及' + board.contract.network.loss_percent + '%丢包。',
    boundary: 'netem配置不声明精确实测WAN RTT；单机逻辑端不替代物理多端、跨DPI／GPU或人工远端对齐。',
    sources: [{path: boardSource.relative, basis: 'contract、measured_seconds、writer_strokes、lifecycle、server_before及network_clear'}]
  });

  const e2ee = card('highlight-e2ee');
  e2ee.status = 'PASS（Native 限定性能负载）';
  e2ee.summary = '表内Native ABBA和共同600秒限定性能结果仍为PASS。独立跨SDK内容范围中，Flutter为14 PASS／2 FAIL；官方C++数据12格、受控视频4格及合成音频OFF／ON限定内容分别完成。内容失败不改判本卡Native性能结果，完整P05／P06未关闭。';
  e2ee.scope += ' 官方C++合成音频为独立OFF／ON各60秒内容观察，原生解码及实际回送按同run留证，不是物理口到耳、音质或连续性门。';
  e2ee.limitations.push('2026-10-22阶段收口：Flutter严格媒体内容两格FAIL及六帧异常原判据保留；不剔除失败帧，不用Native成功改判。官方C++进程退出不证明SDK进程内callback-drain或安全退休。');
  e2ee.limitations.push(flutterDiagnosticNote);
  addSources(e2ee, [resource.relative, 'data/completed-evidence/official-cpp-audio-windows01-20261021-scoped.json', flutterDiagnosisSource.relative, flutterExecutionSource.relative]);
  e2ee.summary += ' 当前失败处置已改为DEFERRED，历史14 PASS／2 FAIL属于原实测。';
  e2ee.limitations.push(deferredNote);
  addSources(e2ee, [deferredSource.relative, deferredHTML.relative]);

  const telemetry = card('highlight-b15');
  telemetry.status = 'PASS（原配对范围／最新资源子门）';
  telemetry.summary = '表内原180秒三组配对及独立9000秒资源子门仍为各自限定范围的PASS，保留原日期和数值。2026-10-22最新正式重测每侧60秒，计划三对、已完成' + latestTelemetry.completed_pairs + '对，原判定' + latestTelemetry.paired_status + '；各对callback p99保守增幅为' + latestTelemetry.pairs.map(row => row.callback_p99_increase_upper_percent.toFixed(10) + '%').join('／') + '，原门限5%。' + (latestTelemetry.remaining_pairs ? '原入口失败即停止，剩余' + latestTelemetry.remaining_pairs + '对NOT_RUN。' : '三对在同一运行中完成。') + '该60秒范围不替换表内180秒结果。';
  telemetry.scope += ' 最新60秒各对CPU增量' + latestTelemetry.pairs.map(row => row.cpu_increase_pp.toFixed(6)).join('／') + '个百分点，工作集增量' + latestTelemetry.pairs.map(row => (row.working_set_increase_bytes / 1048576).toFixed(6)).join('／') + 'MiB。清理、输入身份、外部环境和安全组恢复均PASS；独立窗口PASS不抵扣配对失败，与旧180秒三对和资源门分别解释。';
  telemetry.limitations.push('历史正式首对p99 +' + pair.pairs[0].callback_p99_increase_upper_percent.toFixed(10) + '%＞5% FAIL保留原工件与日期；原失败根因UNKNOWN，不因新运行改判或声称根因已解决。panel-closed batch22八窗及143693项回读仅为诊断，不能改判；P13完整主门信用0。');
  addSources(telemetry, [telemetrySource.relative, pairSource.relative, resource.relative]);
  const latestOff = latestTelemetry.windows.find(row => row.mode === 'off');
  addEnvironment(telemetry, {
    id: 'env-telemetry-pair-20261022', label: '遥测正式60秒配对重测：2026-10-22',
    server: '本首对SFU image=' + latestOff.server_before.image + '，binary=' + latestOff.server_before.binary + '，配置SHA256=' + latestOff.server_before.config_sha256 + '；OFF／ON配置指纹一致。云厂商、CPU／内存／带宽未在该首对回执单列。',
    client: 'Windows ' + latestTelemetry.binary_identity.configuration + ' uia_entry_fixture.exe；EXE SHA256=' + latestTelemetry.binary_identity.binary_sha256 + '，PDB GUID=' + latestTelemetry.binary_identity.pdb_guid + '／age' + latestTelemetry.binary_identity.pdb_age + '。CPU、RAM、GPU型号未在回执单列。',
    load: '同冻结工件OFF／ON各60秒，原计划三对、已完成' + latestTelemetry.completed_pairs + '对；实际native callback FPS各对OFF／ON=' + latestTelemetry.pairs.map(row => row.actual_callback_fps.off.toFixed(6) + '／' + row.actual_callback_fps.on.toFixed(6)).join('；') + '。',
    boundary: '仅最新60秒已完成配对范围；' + (latestTelemetry.remaining_pairs ? '剩余' + latestTelemetry.remaining_pairs + '对未执行。' : '三对均在同一运行中完成。') + '与原每侧180秒三对、历史60秒首对FAIL及独立9000秒资源门分别解释；完整P13信用0。',
    sources: [{path: telemetrySource.relative, basis: 'binary_identity、requested_seconds、pairs、windows及恢复状态'}]
  });

  const notes = new Map([
    ['P02', 'TURN02封存源与UI15生产导出分别完成限定回读；不授故障后live-current或完整恢复通过。'],
    ['P03', 'UI15三轮及三次导出、UI09操作计时观测、Qt CPU四主题静帧范围分别完成；有限时变内容中止不作为新完成结果回填。'],
    ['P05', 'Flutter原实测独立格14 PASS／2 FAIL，官方C++数据12格、视频4格与合成音频OFF／ON各自留证；严格失败及SDK退休边界保留。' + flutterDiagnosticNote + deferredNote],
    ['P06', 'Native ABBA／600秒与跨SDK已完成格分别解释；Flutter原实测FAIL保留，不合并为完整E2EE通过。' + flutterDiagnosticNote + deferredNote],
    ['P07', '生命周期、六资源、GDI50及2560×1440客观画质各自完成；原2K成本不被画质结果覆盖。'],
    ['P11', '1800-fixed04完成8逻辑进程／4书写者／1802.609秒／50对启停／每写者361笔与自然退出；原M5及B12指标分别保留。'],
    ['P12', 'service-restart、九成功网络子集、TURN及UI15封存导出按各自run留证；不授完整L3或故障后live-current通过。'],
    ['P13', '冻结阶段60秒首对及更早pair2原FAIL留在历史来源；最新60秒三对正式重测全部PASS，连同独立9000秒资源、UIA20及5轮残余，当前完成结果6 PASS／0 FAIL。当前整组PARTIAL，最终输入贯通及完整主门未关闭；原180秒表及历史UNKNOWN根因保留。'],
    ['P14', '工件身份及两处离线源码定位只授限定结果；非最终工件，旧部署DLL／PDB age错配仍保留。'],
    ['P17', 'TURN及UI15支持包生产导出与独立回读、限定工件身份分别完成；不等于事故根因或最终符号链关闭。'],
    ['P21', '主题恢复、无效配置、真实系统偏好及DX11／Qt CPU／当前GLES会中四主题限定范围完成；桌面OpenGL与完整stage矩阵不外推。'],
    ['A01', '已有直接工具合同按原输入复用；P03离线与WinPS兼容、P13 bool及回读只授工具范围，不升级产品门。']
  ]);
  const groupUpdates = [];
  for (const [code, text] of notes) {
    const target = data.retestRecords.find(record => record.plan_code === code);
    const assessed = stageByCode.get(code)?.stage_status;
    assert.ok(target && assessed?.completed_scope?.length, 'Missing completed stage scope: ' + code);
    assert.equal(assessed.full_gate_credit, 0);
    const note = '2026-10-22阶段收口注记：' + text + ' 冻结时阶段评估' + assessed.status + '，完整主门信用0；各子门按实际范围分别判定。来源reports/product/stage-closure-20261022.html。';
    target.boundaries = [...target.boundaries.filter(boundary => !boundary.startsWith('2026-10-22阶段收口注记：')), note];
    target.limitations = target.boundaries.join('；');
    groupUpdates.push({plan_code: code, status: assessed.status, note, source: stageHTML.relative, full_gate_credit: 0});
  }
  data.stageRefresh = {
    schema: 'cohavora-completed-stage-projection-v1',
    date: '2026-10-22', status: stage.status, closed_at: stage.closed_at,
    data_path: stageSource.relative, report_path: stageHTML.relative,
    full_plan_gates_completed: 0, formal_credit: 0, p20_credit: 0,
    final_regression: 'NOT_RUN', production_ready: false,
    group_status_counts: structuredClone(stage.group_status_counts),
    new_completed_group_codes: [...notes.keys()], group_updates: groupUpdates,
    environment_profile_ids: ['env-whiteboard-1800-20261021', 'env-wgc-quality-2k-20261021', 'env-telemetry-pair-20261022'],
    sources,
    preserved_metric_columns: originalMetrics.map(item => ({id: item.id, count: item.metrics.length})),
    unchanged_scopes: ['B14由独立最新完整Formal投影；冻结阶段不改其原结果', '原180秒三组OFF／ON配对', '原15项共享整批及2K成本', 'M5合成工程指标及B12八项功能'],
    excluded: ['P03有限时变内容中止未产生帧证据', ...(latestTelemetry.remaining_pairs ? ['最新60秒正式配对剩余' + latestTelemetry.remaining_pairs + '对NOT_RUN'] : []), '冻结阶段当时P20 Formal暂停；后续current Formal独立展示', '最终回归NOT_RUN', '完整跨平台／物理设备及声学光学验收未完成'],
    verification_scope: 'Read and hash listed document/scoped-result bytes only; no build, runtime rerun, full transitive input acceptance or product gate promotion.'
  };
  for (const original of originalMetrics) assert.deepEqual(card(original.id).metrics, original.metrics, 'Stage notes must preserve original metric rows: ' + original.id);
  assert.deepEqual(card('highlight-b14'), originalB14);
  assert.deepEqual(data.b14CycleSummary, originalCycleSummary);
  assert.deepEqual(data.memoryUsageSummary, originalMemory);
  return data;
}
