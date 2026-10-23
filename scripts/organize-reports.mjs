import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON = async name => JSON.parse((await fs.readFile(path.join(root, name), 'utf8')).replace(/^\uFEFF/, ''));
const exists = async name => fs.access(name).then(() => true, () => false);
const archiveRoot = path.join(root, 'audit/report-layout-originals');
const category = name => name.startsWith('b14-') ? 'b14'
  : /^(?:heap-|memory-|vs-native-)/.test(name) ? 'memory'
  : /^(?:resource-completion-|functional-media-|camera-|theme-)/.test(name) ? 'product' : 'tooling';
const names = (await fs.readdir(root)).filter(name => name.endsWith('.html') && name !== 'index.html').sort();
if (!names.length) {
  console.log('No root-level reports to organize.');
  process.exit(0);
}
const migrationFile = 'data/report-migrations.json';
const migration = await exists(path.join(root, migrationFile)) ? await readJSON(migrationFile) : {
  schema: 'cohavora-report-layout-migration-v1',
  scope: '仅整理报告呈现路径；JSON原件、冻结门限和历史结论保持原字节。',
  records: []
};
const moves = new Map(migration.records.flatMap(record => [
  [record.from, record.to], ...(record.companion ? [[record.companion.from, record.companion.to]] : [])
]));
for (const name of names) {
  if (await exists(path.join(archiveRoot, name))) throw Error('Original report archive already exists: ' + name);
  moves.set(name, `reports/${category(name)}/${name}`);
  const json = name.replace(/\.html$/, '.json');
  if (await exists(path.join(root, json))) moves.set(json, `reports/${category(name)}/${json}`);
}
// 完成路径和目标冲突检查后再移动；绝不覆盖已归档报告。
for (const name of names) {
  for (const source of [name, name.replace(/\.html$/, '.json')].filter(source => moves.has(source))) {
    if (await exists(path.join(root, moves.get(source)))) throw Error('Report destination already exists: ' + moves.get(source));
  }
}
await fs.mkdir(archiveRoot, {recursive: true});
const nav = '<nav data-report-navigation style="padding:12px 20px;background:#eef2f7;color:#1e293b;font:14px/1.7 sans-serif">'
  + '<a href="../../index.html">验收首页</a> · <a href="../index.html">全部报告</a> · <a href="../../data/test-plan.json">统一测试计划</a>'
  + '<br>历史／阶段报告仅适用其记录的输入；包外证据属于本机附件，其他电脑可能不可用。</nav>';
for (const name of names) {
  const source = path.join(root, name), relative = moves.get(name), target = path.join(root, relative);
  const original = await fs.readFile(source), record = {from: name, to: relative, original_sha256: sha(original), links_rebased: 0, unavailable_links: []};
  let html = original.toString('utf8');
  // 两份历史诊断报告原本就没有result.html，明确保留缺失事实。
  if (/^heap-product-(?:postquery-idle|single-query)-20261016\.html$/.test(name)) {
    html = html.replace(/<a\b[^>]*\shref="result\.html"[^>]*>([\s\S]*?)<\/a>/g, (_, label) => {
      record.unavailable_links.push('result.html');
      return '<span class="source-missing" title="原附件缺失：result.html">' + label + '（原附件缺失）</span>';
    });
  }
  html = html.replace(/(\s(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi, (match, prefix, quote, raw) => {
    let updated = raw;
    if (/^[a-z]:[\\/]/i.test(raw)) updated = pathToFileURL(raw).href;
    else if (!/^(?:#|\/|[a-z][a-z0-9+.-]*:)/i.test(raw)) {
      const [, pathname, suffix = ''] = raw.match(/^([^?#]*)([?#].*)?$/);
      const absolute = path.resolve(root, decodeURIComponent(pathname.replaceAll('&amp;', '&')));
      const oldRelative = path.relative(root, absolute).replaceAll('\\', '/');
      const mapped = moves.get(oldRelative);
      const finalTarget = mapped ? path.join(root, mapped) : absolute;
      updated = path.relative(path.dirname(target), finalTarget).replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/') + suffix;
    }
    if (updated !== raw) record.links_rebased++;
    return prefix + quote + updated + quote;
  });
  if (/<body\b[^>]*>/i.test(html)) html = html.replace(/<body\b[^>]*>/i, opening => opening + '\n' + nav);
  else {
    const contentStart = html.search(/<(?:h[1-6]|main|header|section|pre|p|article|div)\b/i);
    if (contentStart < 0) throw Error('Report has no content insertion point: ' + name);
    html = html.slice(0, contentStart) + nav + html.slice(contentStart);
  }
  record.relocated_sha256 = sha(Buffer.from(html));
  // 原HTML留在已忽略的audit，便于追溯呈现修改；同名JSON只移动不重写。
  await fs.writeFile(path.join(archiveRoot, name), original, {flag: 'wx'});
  await fs.mkdir(path.dirname(target), {recursive: true});
  if (sha(await fs.readFile(source)) !== record.original_sha256) throw Error('Report changed during organization: ' + name);
  await fs.rename(source, target);
  await fs.writeFile(target, html);
  const jsonName = name.replace(/\.html$/, '.json');
  if (moves.has(jsonName)) {
    const jsonSource = path.join(root, jsonName), jsonBytes = await fs.readFile(jsonSource);
    record.companion = {from: jsonName, to: moves.get(jsonName), sha256: sha(jsonBytes)};
    await fs.rename(jsonSource, path.join(root, moves.get(jsonName)));
  }
  migration.records.push(record);
  // 每份完成后落盘，后续文件失败时仍保留已完成路径的追溯记录。
  migration.revised_at = '2026-10-21';
  await fs.writeFile(path.join(root, migrationFile), JSON.stringify(migration, null, 2) + '\n');
}
// 维护计划中的报告引用改为包根相对路径，批次ID与结果内容不变。
const planFile = path.join(root, 'data/test-plan.json');
let planText = await fs.readFile(planFile, 'utf8');
for (const name of names) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  planText = planText.replace(new RegExp('(?<![/\\\\A-Za-z0-9_.-])' + escaped + '(?![A-Za-z0-9_.-])', 'g'), moves.get(name));
}
await fs.writeFile(planFile, planText);
migration.revised_at = '2026-10-21';
await fs.writeFile(path.join(root, migrationFile), JSON.stringify(migration, null, 2) + '\n');
console.log(JSON.stringify({reports_moved: names.length, categories: Object.fromEntries(['product', 'b14', 'memory', 'tooling'].map(key => [key, names.filter(name => category(name) === key).length])), links_rebased: migration.records.reduce((sum, record) => sum + record.links_rebased, 0)}, null, 2));
