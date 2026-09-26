#!/usr/bin/env node
/*
 * 团购网站每日体检 / 自动修复
 * ------------------------------------------------------------
 * 用法：
 *   node tools/health-check.js --check    只检查，有问题退出码 1
 *   node tools/health-check.js --repair   自动修复安全问题（有改动时退出码 2）
 *
 * 自动修复只动 products.json 里的数据，绝不改代码：
 *   1. 产品引用了不存在的分类 -> 自动补进 categories
 *   2. 产品 id 重复           -> 自动重新编号
 *   3. 有档次但缺 price 字段   -> 用最低档价格补上
 *   4. 档次价格缺失/非正数     -> 用最低档价格补上
 * 其余问题（价格无效、图片丢失、页面报错等）只报告，不擅自修改。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const SITE = process.env.SITE_URL || 'https://lianchuzhong.github.io/tg';
const MODE = process.argv.includes('--repair') ? 'repair' : 'check';

const problems = [];
const fixes = [];
const notes = [];

const problem = (level, msg) => problems.push({ level, msg });
const note = (msg) => notes.push(msg);

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fetchStatus(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

/* ============ 1. 检查线上站点 ============ */
async function checkSite() {
  const pages = [SITE + '/', SITE + '/products.json'];
  for (const u of pages) {
    const r = await fetchStatus(u);
    if (r.error) problem('严重', `线上地址无法访问 ${u}（${r.error}）`);
    else if (r.status !== 200) problem('严重', `线上地址返回 HTTP ${r.status}：${u}`);
    else note(`线上正常 ${r.status} ${u}`);
  }
}

/* ============ 2. 检查 index.html 关键结构 ============ */
function checkHTML() {
  const f = path.join(ROOT, 'index.html');
  if (!fs.existsSync(f)) { problem('严重', '缺少 index.html'); return; }
  const html = fs.readFileSync(f, 'utf8');

  const must = [
    ['id="plist"', '产品列表容器'],
    ['id="catbar"', '分类栏'],
    ['id="cc"', '购物车容器'],
    ['id="of"', '主订单表单'],
    ['id="fof"', '悬浮购物车表单'],
    ['function add(', '加入预订函数'],
    ['function submitOrder(', '下单函数'],
    ['function openDetail(', '详情弹窗函数'],
    ['function fsubmit(', '悬浮表单提交函数'],
    ['function saveReceipt(', '订单存根生成函数'],
    ['function copyPay(', '付款号复制函数'],
    ['function vLog(', '访客记录函数'],
    ['function shOpen(', '分享功能'],
    ['function onSearch(', '搜索功能'],
    ['function setTier(', '档次选择'],
    ['products.json', '产品数据引用'],
  ];
  for (const [needle, label] of must) {
    if (html.indexOf(needle) === -1) problem('严重', `index.html 缺少${label}（找不到 "${needle}"）`);
  }

  // 关键函数定义不能重复（重复通常是合并冲突留下的）
  for (const fn of ['function add(', 'function submitOrder(', 'function renderProducts(', 'function vLog(']) {
    const n = html.split(fn).length - 1;
    if (n > 1) problem('严重', `index.html 里 "${fn}" 重复定义了 ${n} 次`);
  }

  // 数量显示必须是变量，不能写死 0（曾经导致顾客多订 3 倍的 bug）
  if (/<span id="q'\+p\.id\+'">0<\/span>/.test(html)) {
    problem('严重', 'index.html 数量显示写死为 0（会导致顾客下单数量错误）');
  }
  if (!/atob\(_o\.map|K\.t\s*=/.test(html)) {
    problem('警告', 'index.html 里找不到 GitHub 令牌配置，下单功能可能不可用');
  }
}

/* ============ 3. 检查 + 修复 products.json ============ */
function checkData() {
  const f = path.join(ROOT, 'products.json');
  if (!fs.existsSync(f)) { problem('严重', '缺少 products.json'); return false; }

  let data;
  try {
    data = readJSON(f);
  } catch (e) {
    problem('严重', `products.json 不是合法 JSON：${e.message}`);
    return false;
  }

  if (!Array.isArray(data.products)) { problem('严重', 'products.json 缺少 products 数组'); return false; }
  if (!Array.isArray(data.categories)) { problem('严重', 'products.json 缺少 categories 数组'); return false; }
  if (data.products.length === 0) { problem('严重', 'products.json 里一个产品都没有'); return false; }

  const catIds = new Set(data.categories.map(c => c.id));
  const usedCats = new Set();

  /* --- 修复 1：补齐缺失的分类 --- */
  for (const p of data.products) {
    const c = p.category || '';
    if (c) usedCats.add(c);
  }
  for (const c of usedCats) {
    if (!catIds.has(c)) {
      if (MODE === 'repair') {
        data.categories.push({ id: c, name: c });
        catIds.add(c);
        fixes.push(`补齐缺失的分类 "${c}"`);
      } else {
        problem('警告', `产品引用了不存在的分类 "${c}"`);
      }
    }
  }

  /* --- 修复 2：重复 id 重新编号 --- */
  const seen = new Map();
  let nextId = 1;
  for (const p of data.products) nextId = Math.max(nextId, (Number(p.id) || 0) + 1);
  for (const p of data.products) {
    const id = Number(p.id);
    if (!Number.isInteger(id) || id <= 0) {
      if (MODE === 'repair') { p.id = nextId; fixes.push(`产品 "${p.name || '(无名称)'}" 的 id 无效，改为 ${nextId}`); nextId++; }
      else problem('严重', `产品 "${p.name || '(无名称)'}" 的 id 无效：${p.id}`);
      continue;
    }
    if (seen.has(id)) {
      if (MODE === 'repair') { p.id = nextId; fixes.push(`产品 "${p.name || '(无名称)'}" id 重复(${id})，改为 ${nextId}`); nextId++; }
      else problem('严重', `产品 id 重复：${id}（${seen.get(id)} 与 ${p.name || '(无名称)'}）`);
    } else {
      seen.set(id, p.name || '(无名称)');
    }
  }

  /* --- 修复 3/4：价格 --- */
  for (const p of data.products) {
    if (!p.name || !String(p.name).trim()) {
      problem('严重', `产品 id=${p.id} 没有名称`);
    }

    const tiers = Array.isArray(p.tiers) ? p.tiers : null;
    let tierPrices = [];
    if (tiers) {
      if (tiers.length === 0) {
        problem('警告', `产品 "${p.name}" 的 tiers 是空数组`);
      }
      tiers.forEach((t, i) => {
        if (!t.name || !String(t.name).trim()) problem('警告', `产品 "${p.name}" 第 ${i + 1} 档没有名称`);
        const ok = typeof t.price === 'number' && isFinite(t.price) && t.price > 0;
        if (!ok) {
          const good = tiers.find(x => typeof x.price === 'number' && x.price > 0);
          if (MODE === 'repair' && good) {
            t.price = good.price;
            fixes.push(`产品 "${p.name}" 第 ${i + 1} 档价格无效，改为 ${good.price}`);
            tierPrices.push(good.price);
          } else {
            problem('严重', `产品 "${p.name}" 第 ${i + 1} 档价格无效：${t.price}`);
          }
        } else tierPrices.push(t.price);
      });
    }

    const priceOk = typeof p.price === 'number' && isFinite(p.price) && p.price > 0;
    if (!priceOk) {
      if (tierPrices.length) {
        const min = Math.min.apply(null, tierPrices);
        if (MODE === 'repair') { p.price = min; fixes.push(`产品 "${p.name}" 缺 price，按最低档补为 ${min}`); }
        else problem('警告', `产品 "${p.name}" 缺 price，但有档次价格可推导`);
      } else {
        problem('严重', `产品 "${p.name || 'id=' + p.id}" 的 price 无效：${p.price}`);
      }
    }

    if (p.price != null && typeof p.price === 'number' && p.price <= 0) {
      problem('严重', `产品 "${p.name}" 价格小于等于 0：${p.price}`);
    }
  }

  /* --- 图片文件检查（只报告，不改数据） --- */
  const refs = new Set();
  for (const p of data.products) {
    if (p.img) refs.add(p.img);
    if (p.icon && String(p.icon).indexOf('.') > -1) refs.add(p.icon);
    (p.detail || []).forEach(s => { if (s.img) refs.add(s.img); });
  }
  const missing = [];
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r)) continue;
    if (!fs.existsSync(path.join(ROOT, r))) missing.push(r);
  }
  if (missing.length) {
    problem('严重', `有 ${missing.length} 张图片文件不存在：${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
  } else {
    note(`图片文件齐全（${refs.size} 张）`);
  }

  if (MODE === 'repair' && fixes.length) {
    // 保留原有缩进风格，末尾补换行
    const orig = fs.readFileSync(f, 'utf8');
    const indentMatch = orig.match(/\n(\s+)"products"/);
    const indent = indentMatch ? indentMatch[1] : '  ';
    fs.writeFileSync(f, JSON.stringify(data, null, indent) + '\n', 'utf8');
  }
  return true;
}

/* ============ 输出 ============ */
function report() {
  const L = [];
  L.push('# 团购网站每日体检报告');
  L.push('');
  L.push('- 时间：' + new Date().toLocaleString('zh-CN'));
  L.push('- 站点：' + SITE);
  L.push('- 模式：' + (MODE === 'repair' ? '检查 + 自动修复' : '仅检查'));
  L.push('');
  if (notes.length) { L.push('## 正常项'); L.push(''); notes.forEach(n => L.push('- ✅ ' + n)); L.push(''); }
  if (fixes.length) { L.push('## 已自动修复'); L.push(''); fixes.forEach(n => L.push('- 🔧 ' + n)); L.push(''); }
  if (problems.length) {
    L.push('## 需要人工处理');
    L.push('');
    problems.forEach(p => L.push(`- ${p.level === '严重' ? '❌' : '⚠️'} **[${p.level}]** ${p.msg}`));
    L.push('');
  } else {
    L.push('## 结论');
    L.push('');
    L.push('全部检查通过，未发现问题。');
    L.push('');
  }
  return L.join('\n');
}

(async () => {
  await checkSite();
  checkHTML();
  checkData();

  const md = report();
  const outFile = path.join(ROOT, '健康报告.md');
  fs.writeFileSync(outFile, md, 'utf8');

  console.log(md);

  if (fixes.length) {
    console.log('CHANGED=1');
    process.exit(2);
  }
  if (problems.length) {
    console.log('PROBLEMS=' + problems.length);
    process.exit(1);
  }
  console.log('ALL_OK=1');
  process.exit(0);
})();
