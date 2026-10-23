import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {buildReportCatalog, renderReportDirectory} from './report-catalog.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const links = html => [...html.matchAll(/\s(?:href|src)\s*=\s*(["'])([^"']+)\1/gi)].map(match => match[2].replaceAll('&amp;', '&'));
const stripNavigation = html => html.replace(/\n?<nav data-report-navigation\b[\s\S]*?<\/nav>/i, '');
const visibleText = html => stripNavigation(html).replace(/<[^>]*>/g, ' ').replaceAll('（原附件缺失）', '').replace(/\s+/g, ' ').trim();

export async function validateReportLayout(root, {verifyMigration = false} = {}) {
  const checks = {};
  const catalog = await readJSON(path.join(root, 'data/report-catalog.json'));
  const migration = await readJSON(path.join(root, 'data/report-migrations.json'));
  const historyRoot = path.resolve(root, '../../out/acceptance-history-20261021-latest-only');
  const history = await readJSON(path.join(historyRoot, 'archive-index.json'));
  const archivedPaths = new Map(history.files.map(entry => [entry.path, entry]));
  assert.equal(archivedPaths.size, history.files.length, 'Duplicate archived report paths');
  for (const entry of history.files) {
    assert.ok(/^reports\/(?:product|b14|memory|tooling)\/[^/]+\.(?:html|json)$/.test(entry.path), 'Unexpected archive path: ' + entry.path);
    const bytes = await fs.readFile(path.join(historyRoot, entry.path));
    assert.equal(sha(bytes), entry.sha256, 'Archived report changed: ' + entry.path);
    assert.equal(bytes.length, entry.bytes, 'Archived report size changed: ' + entry.path);
    assert.equal(await fs.stat(path.join(root, entry.path)).then(() => true, () => false), false, 'Archived report remains in current directory: ' + entry.path);
  }
  const currentReport = 'reports/b14/b14-clipboard-readmission-20261019-01.html';
  const oldReference = 'b14-clipboard-fix-20261019-01.html';
  const archiveReference = '../../../../out/acceptance-history-20261021-latest-only/reports/b14/' + oldReference;
  // 仅此保留报告的历史链接随旧报告迁出而重定向；校验原文时还原该链接。
  const migrationBytes = (relative, bytes) => relative === currentReport
    ? Buffer.from(bytes.toString('utf8').replace('href="' + archiveReference + '"', 'href="' + oldReference + '"'))
    : bytes;
  // A completed replacement keeps its migration originals byte-for-byte in the presentation snapshot.
  const p19Source = await readJSON(path.join(root, 'data/completed-evidence/p19-qualification-20261023-completed-scoped.json'));
  const p19Replaced = new Set(['reports/b14/b14-full-standard-20261020-01.html', 'reports/b14/b14-full-standard-20261020-01.json']);
  assert.deepEqual(p19Source.history_archive.files.map(row => row.path).sort(), [...p19Replaced].sort());
  for (const entry of p19Source.history_archive.files) {
    const bytes = await fs.readFile(path.join(historyRoot, 'presentation-before', entry.path));
    assert.equal(sha(bytes), entry.sha256);assert.equal(bytes.length, entry.bytes);
  }
  const latestFormal = await readJSON(path.join(root, 'data/completed-evidence/b14-formal-20261023-completed-scoped.json'));
  const formalReplaced = new Map(latestFormal.history_replacements.map(entry => [entry.path, entry]));
  for (const entry of formalReplaced.values()) {
    const bytes = await fs.readFile(path.join(historyRoot, entry.snapshot));
    assert.equal(sha(bytes), entry.sha256);assert.equal(bytes.length, entry.bytes);
  }
  const resolveReport = relative => p19Replaced.has(relative)
    ? path.join(historyRoot, 'presentation-before', relative)
    : formalReplaced.has(relative) ? path.join(historyRoot, formalReplaced.get(relative).snapshot)
    : path.join(archivedPaths.has(relative) ? historyRoot : root, relative);
  const migratedPaths = new Set(migration.records.map(record => record.to));
  assert.deepEqual(catalog, await buildReportCatalog(root), 'Catalog must reflect every current report and its structured source');
  const home = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const directory = await fs.readFile(path.join(root, 'reports/index.html'), 'utf8');
  const css = await fs.readFile(path.join(root, 'assets/report-style.css'), 'utf8');
  assert.equal(directory, renderReportDirectory(catalog, css));
  assert.ok(!/id="(?:latest-reports|completed-results)"/.test(home), 'Home must retain the pushed layout without new result sections');
  assert.deepEqual([...home.matchAll(/<article class="highlight-card" id="([^"]+)"/g)].map(match => match[1]), ['highlight-b14', 'highlight-screen-share', 'highlight-b15', 'highlight-e2ee', 'highlight-whiteboard'], 'Original five highlight cards and their order must remain');
  assert.ok(home.includes('Private Bytes增长')&&home.includes('95.869140625'),'Latest completed Formal FAIL must be visible');
  assert.equal(latestFormal.status,'FAIL');
  assert.ok(!((await fs.readdir(root)).some(name => name.endsWith('.html') && name !== 'index.html')), 'Independent reports must live under reports/');
  const reportPaths = new Set(catalog.reports.map(report => report.path));
  assert.equal(reportPaths.size, catalog.report_count);
  assert.equal(catalog.categories.reduce((sum, category) => sum + category.count, 0), catalog.report_count);
  assert.ok(catalog.featured.every(report => reportPaths.has(report.path)), 'Featured metadata must reference current reports');
  assert.ok(history.kept_reports.every(relative => reportPaths.has(relative)), 'A retained latest report is missing');
  let packageLinks = 0, localAttachments = 0, localAttachmentsAvailable = 0;
  const localAttachmentTargets = new Set();
  async function inspectHTML(relative, html) {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const raw of links(html)) {
      if (raw.startsWith('#')) {
        // 历史独立报告的锚点原样保留；新目录的锚点必须存在。
        if (relative === 'reports/index.html') assert.ok(ids.has(decodeURIComponent(raw.slice(1))), 'Missing directory anchor: ' + raw);
        continue;
      }
      assert.ok(!/^[a-z]:[\\/]/i.test(raw), 'Browser-incompatible drive path: ' + relative + ' ' + raw);
      const url = new URL(raw, pathToFileURL(path.join(root, relative)));
      if (url.protocol !== 'file:') continue;
      const full = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1').replaceAll('/', path.sep);
      const local = path.relative(root, full);
      const internal = local !== '..' && !local.startsWith('..' + path.sep) && !path.isAbsolute(local);
      if (internal) {
        assert.ok((await fs.stat(full)).isFile(), 'Broken package report link: ' + relative + ' -> ' + raw);
        packageLinks++;
      } else {
        localAttachments++;
        localAttachmentTargets.add(url.href);
        if (await fs.stat(full).then(stat => stat.isFile() || stat.isDirectory(), () => false)) localAttachmentsAvailable++;
      }
    }
  }
  await inspectHTML('reports/index.html', directory);
  for (const report of catalog.reports) {
    assert.ok(/^reports\/(?:product|b14|memory|tooling)\/[^/]+\.html$/.test(report.path));
    const html = await fs.readFile(path.join(root, report.path), 'utf8');
    if (migratedPaths.has(report.path)) assert.ok(html.includes('data-report-navigation'), 'Missing migrated report return navigation: ' + report.path);
    await inspectHTML(report.path, html);
    if (report.json_path) await readJSON(path.join(root, report.json_path));
  }
  const retained = await fs.readFile(path.join(root, currentReport), 'utf8');
  assert.ok(retained.includes('href="' + archiveReference + '"'), 'Retained report must point to the archived repair report');
  assert.equal(path.resolve(root, path.dirname(currentReport), archiveReference), path.join(historyRoot, 'reports/b14', oldReference));
  checks.classified_report_catalog = {reports: catalog.report_count, categories: catalog.categories.map(category => ({id: category.id, count: category.count})), featured: catalog.featured.length};
  checks.original_five_card_layout_retained = true;
  checks.report_links = {package_references: packageLinks, machine_local_references: localAttachments, machine_local_existing: localAttachmentsAvailable, machine_local_missing: localAttachments - localAttachmentsAvailable, machine_local_unique_targets: localAttachmentTargets.size};
  assert.equal(new Set(migration.records.map(record => record.from)).size, migration.records.length);
  assert.equal(new Set(migration.records.map(record => record.to)).size, migration.records.length);
  for (const record of migration.records) {
    assert.ok(reportPaths.has(record.to) || archivedPaths.has(record.to), 'Migrated report is neither current nor archived: ' + record.to);
    if (archivedPaths.has(record.to)) assert.equal(archivedPaths.get(record.to).sha256, record.relocated_sha256, 'Archive does not match relocated report: ' + record.to);
    if (p19Replaced.has(record.to)) assert.equal(sha(await fs.readFile(resolveReport(record.to))), record.relocated_sha256, 'Superseded report migration original changed: ' + record.to);
    if (record.companion) {
      const bytes = await fs.readFile(resolveReport(record.companion.to));
      assert.equal(sha(bytes), record.companion.sha256, 'Original JSON changed: ' + record.companion.to);
    }
  }
  checks.migration_traceability = {reports: migration.records.length, current_reports: catalog.report_count, archived_files_verified: history.files.length, archived_html: history.files.filter(entry => entry.path.endsWith('.html')).length, original_missing_links: migration.records.flatMap(record => record.unavailable_links).length};
  if (verifyMigration) {
    const archive = path.join(root, 'audit/report-layout-originals');
    const protectedFiles = await readJSON(path.join(archive, 'protected-files.json'));
    for (const entry of protectedFiles) {
      // 此派生汇总已按用户要求更新为最新完成run；原版本以同指纹留在展示快照中。
      const originalPath = entry.path === 'data/b14-100-cycle-summary.json'
        ? path.join(historyRoot, 'presentation-before', entry.path)
        : path.join(root, entry.path);
      assert.equal(sha(await fs.readFile(originalPath)), entry.sha256, 'Historical evidence changed: ' + entry.path);
    }
    const movedPaths = new Map(migration.records.flatMap(record => [[path.join(root, record.from), path.join(root, record.to)], ...(record.companion ? [[path.join(root, record.companion.from), path.join(root, record.companion.to)]] : [])]));
    let preservedCompanions = 0, preservedTargets = 0;
    for (const record of migration.records) {
      const original = await fs.readFile(path.join(archive, record.from));
      const relocated = migrationBytes(record.to, await fs.readFile(resolveReport(record.to)));
      assert.equal(sha(original), record.original_sha256);
      assert.equal(sha(relocated), record.relocated_sha256);
      assert.equal(visibleText(relocated.toString('utf8')), visibleText(original.toString('utf8')), 'Report text changed during relocation: ' + record.from);
      const before = links(original.toString('utf8')).filter(raw => !record.unavailable_links.includes(raw));
      const after = links(stripNavigation(relocated.toString('utf8')));
      assert.equal(after.length, before.length, 'Report reference count changed: ' + record.from);
      for (const [index, raw] of before.entries()) {
        const normalized = /^[a-z]:[\\/]/i.test(raw) ? pathToFileURL(raw).href : raw;
        const originalURL = new URL(normalized, pathToFileURL(path.join(root, record.from)));
        if (originalURL.protocol === 'file:') {
          const full = decodeURIComponent(originalURL.pathname).replace(/^\/([a-z]:\/)/i, '$1').replaceAll('/', path.sep);
          if (movedPaths.has(full)) {
            const mapped = pathToFileURL(movedPaths.get(full));
            mapped.search = originalURL.search;
            mapped.hash = originalURL.hash;
            originalURL.href = mapped.href;
          }
        }
        assert.equal(new URL(after[index], pathToFileURL(path.join(root, record.to))).href, originalURL.href, 'Reference target changed: ' + record.from + ' -> ' + raw);
        preservedTargets++;
      }
      if (record.companion) {
        assert.equal(sha(await fs.readFile(resolveReport(record.companion.to))), record.companion.sha256, 'Original JSON changed: ' + record.companion.to);
        preservedCompanions++;
      }
    }
    let planBefore = await fs.readFile(path.join(archive, 'test-plan.before.json'), 'utf8');
    for (const record of migration.records) planBefore = planBefore.replaceAll(record.from, record.to);
    // 仅放行同run已完成的计时及空闲内存观测状态，其余计划内容仍逐字保护。
    for (const id of ['join_ready', 'leave_complete', 'ui_first_paint']) {
      const pattern = new RegExp('("id": "' + id + '"[^}]*"collection_status": )"NOT_RUN"', 'g');
      assert.equal([...planBefore.matchAll(pattern)].length, 1, 'Original timing status must occur exactly once: ' + id);
      planBefore = planBefore.replace(pattern, '$1"OBSERVATION_RECORDED"');
    }
    const originalTimingPolicy = '采集实现已接入现有诊断、UIA与runner链路；真实runtime采集验证未执行，collection_status保持NOT_RUN。新增实现不更改历史状态、门限或原暂停约束。';
    const completedTimingPolicy = '采集实现已接入现有诊断、UIA与runner链路；本次完整100轮已留存入会、离会及meeting首绘数据，collection_status为OBSERVATION_RECORDED，仅作耗时观测，不签发独立性能PASS，不更改原门限或暂停约束。';
    assert.equal(planBefore.split(originalTimingPolicy).length, 2, 'Original timing collection policy must occur exactly once');
    planBefore = planBefore.replace(originalTimingPolicy, completedTimingPolicy);
    for (const [field, before, after] of [
      ['collection_status', 'NOT_RUN', 'OBSERVATION_RECORDED'],
      ['implementation_status', 'IMPLEMENTED_RUNTIME_NOT_RUN', 'IMPLEMENTED_OBSERVATION_RECORDED']
    ]) {
      const pattern = new RegExp('("idle_memory_measurements": \\{[^}]*"' + field + '": )"' + before + '"', 'g');
      assert.equal([...planBefore.matchAll(pattern)].length, 1, 'Original idle memory status must occur exactly once: ' + field);
      planBefore = planBefore.replace(pattern, '$1"' + after + '"');
    }
    const currentPlanBytes = await fs.readFile(path.join(root, 'data/test-plan.json'));
    const currentPlan = JSON.parse(currentPlanBytes.toString('utf8'));
    if (currentPlan.stage_freeze?.status === 'FROZEN_STAGE_CLOSED') {
      // 后续任务已在本轮文档更新前完成阶段收口；保护该输入原样，不撤销其既有计划注记。
      assert.equal(sha(currentPlanBytes), '3155df02cd5c4cfb17a8fd8570129524b2324e25b8138faade7c90e2771125a7', 'Preexisting closed-stage plan changed');
      const frozenBytes = await fs.readFile(path.join(root, 'data/stage-freeze-20261022-plan.json'));
      assert.equal(sha(frozenBytes), '51e074ead1b630a490f89e371dc9b10c347eebf2dd9dc794155621de70ffe820', 'Frozen stage plan changed');
      assert.equal(sha(await fs.readFile(path.join(archive, 'test-plan.before.json'))), 'e4872fb5a33e9bed016dd1abfd30150761f9c09674cdd9269362d09eeeb440b8', 'Original migration plan changed');
      const frozenPlan = JSON.parse(frozenBytes.toString('utf8'));
      const stage = await readJSON(path.join(root, 'data/stage-closure-20261022.json'));
      const preservedPlan = structuredClone(currentPlan);
      delete preservedPlan.stage_freeze;
      preservedPlan.revised_at = frozenPlan.revised_at;
      for (const group of preservedPlan.groups) {
        const assessment = stage.groups.find(item => item.id === group.id)?.stage_status;
        assert.ok(assessment, 'Missing closed-stage group: ' + group.id);
        const expectedNote = {...assessment, as_of: stage.closed_at, stage_execution: 'STOPPED_AFTER_CLOSURE', evidence_catalog: 'data/stage-closure-20261022.json#evidence'};
        if (group.plan_code === 'P03') expectedNote.followup_only = ['Early-exit readback reported one unexplained declared-input-map difference.', 'User later reported mouse disconnected; no post-freeze probe or retry.'];
        assert.deepEqual(group.stage_status, expectedNote, 'Stage note differs from its closure: ' + group.id);
        delete group.stage_status;
      }
      assert.deepEqual(preservedPlan, frozenPlan, 'Closed stage must preserve the frozen gates and existing plan fields');
      checks.closed_stage_plan_preserved_without_new_execution = true;
    } else {
      assert.equal(currentPlanBytes.toString('utf8'), planBefore, 'Existing test-plan changes must be preserved');
    }
    checks.migration_preservation = {protected_files: protectedFiles.length, report_texts: migration.records.length, original_json_files: preservedCompanions, reference_targets: preservedTargets, preexisting_plan_preserved: true};
  }
  return checks;
}
