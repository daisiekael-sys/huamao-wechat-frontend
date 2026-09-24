/* 贡献者工作台 前端 SPA
 * 一个入口 · 三个角色空间（大众参与者 / 内部成员 / 顶层管理者）
 * 所有权限在服务端判定；前端只负责"看不见就不渲染" */
'use strict';

/* ---------- 全局状态 ---------- */
const S = {
  demoMode: false,
  user: null, memberships: [], org: null, orgRole: null,
  page: 'home', sub: {}, data: {}, sse: null,
};

/* ---------- 工具 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 生成可放进 HTML 属性的单引号 JS 字符串字面量（detailModal 会做反向解码）
const escAttr = s => "'" + esc(s) + "'";
const fmt = n => Number(n || 0).toLocaleString('zh-CN');
const fmtMoney = n => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const dt = s => s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const dOnly = s => s ? new Date(s).toLocaleDateString('zh-CN') : '—';

/* ---------- 移动端信息熵管理（iOS 版面轻量化） ---------- */
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
/** 桌面端原样返回；移动端把次要区块收进折叠抽屉（一屏只留主线） */
function mCollapse(summaryText, innerHtml, { open = false } = {}) {
  if (!isMobile()) return innerHtml;
  return `<details class="m-collapse"${open ? ' open' : ''}><summary><span>${summaryText}</span></summary><div>${innerHtml}</div></details>`;
}

/** 问号圈：长说明收纳，点击查看（i = S._hints 序号） */
function hintBtn(title, text) {
  S._hints = S._hints || [];
  const i = S._hints.push({ title, text }) - 1;
  return `<button type="button" class="hint-q md:hidden" title="查看说明" onclick="hintShow(${i + STATIC_HINTS.length})">?</button>`;
}
const STATIC_HINTS = [{ title: '关于支付', text: '<p><b>资金路径</b>：公司进账 → 平台完成分账计算（确认冻结的不可变快照）→ 生成打款批次并下载对应平台的批量付款文件 → 商户平台上传打款（或线下转账）→ 回执登记。</p><p>成员需先在「我的资料」绑定<b>实名 + 支付宝账号</b>；生成批次时会固化每人的收款账号与税后金额。</p><p>走 API 自动打款（跳过手动上传）需要组织方的商户号与支付合规资质，明确后接入——批次结构已预留通道字段。</p>' }, { title: '成员与角色说明', text: '<p><b>分工</b>：成员加入时自报，老板在此调整；标签可自定义、删除（可撤销）。</p><p><b>位阶</b>：决定权限（顶层管理者＞内部成员＞大众参与者）。</p><p><b>排序</b>：跟随排行榜（按有效积分）。</p>' }, { title: '两套权重体系', text: '<p><b>活动板块权重</b>：用于个人活动完成度汇总（统计口径）。</p><p><b>分利类目权重</b>：仅用于资金分配（分利口径）。</p><p>两套体系各自独立，不能混用——统计是统计，分钱是分钱。</p>' },
    { title: '导入格式说明', text: '<p>表格列（从左到右）：<b>任务名称｜类别｜积分下限｜积分上限｜次数(可空=不限)｜频率说明</b></p><p>类别支持：媒体 / 运营 / 项目 / 资源。</p><p><b>次数</b>填了就是限定次数任务：名额被领取完后自动从参与者广场消失。</p>' }];
function hintShow(i) {
  const h = i < STATIC_HINTS.length ? STATIC_HINTS[i] : (S._hints || [])[i - STATIC_HINTS.length];
  if (!h) return;
  openModal(`<h3 class="font-bold text-gray-800 mb-2">${esc(h.title)}</h3><div class="text-sm text-gray-600 leading-relaxed space-y-1">${h.text}</div>`);
}

function toast(msg, type = 'ok', actionLabel, actionFn) {
  const colors = { ok: 'bg-green-600', err: 'bg-red-500', warn: 'bg-primary-soft0' };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.ok} text-white text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-xs flex items-center gap-3`;
  el.innerHTML = `<span class="flex-1">${esc(msg)}</span>` + (actionLabel ? `<button class="underline font-bold flex-shrink-0">${esc(actionLabel)}</button>` : '');
  if (actionLabel && actionFn) el.querySelector('button').onclick = () => { actionFn(); el.remove(); };
  $('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), actionLabel ? 8000 : 3200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let j = {};
  try { j = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || j.ok === false) {
    const e = new Error(j.error || `请求失败(${res.status})`);
    e.status = res.status;
    throw e;
  }
  return j.data;
}

function closeModal() { $('modal').classList.remove('active'); $('modal-body').innerHTML = ''; }
function openModal(html) { $('modal-body').innerHTML = html; $('modal').classList.add('active'); }
// 移动端抽屉（替代部分弹窗）
let _drawerTimer = null;
function openDrawer(html) {
  let overlay = $('drawer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'drawer-overlay';
    overlay.className = 'drawer-overlay';
    overlay.innerHTML = `<div class="drawer-panel" onclick="event.stopPropagation()">${html}<button class="tab-btn w-full mt-4" onclick="closeDrawer()">关闭</button></div>`;
    overlay.onclick = closeDrawer;
    document.body.appendChild(overlay);
  } else {
    overlay.querySelector('.drawer-panel').innerHTML = html + '<button class="tab-btn w-full mt-4" onclick="closeDrawer()">关闭</button>';
  }
  overlay.classList.add('active');
}
function closeDrawer() {
  const overlay = $('drawer-overlay');
  if (overlay) overlay.classList.remove('active');
}

/* ---------- 启动 ---------- */
(async function init() {
  try {
    S.demoMode = (await api('GET', '/api/health')).demo === true;
    $('demo-login').hidden = !S.demoMode;
    // ===== 微信小程序登录桥：自动用 wx.code 换 session =====
    const wxc = new URLSearchParams(location.search).get('wxcode');
    if (wxc) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('wxcode');
      history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      try {
        const r = await api('POST', '/api/auth/wxlogin', { code: wxc });
        S.user = r.user; S.memberships = (await api('GET', '/api/me')).memberships || [];
      } catch (e) { toast('微信登录失败：' + e.message, 'err'); }
    } else {
      const me = await api('GET', '/api/me');
      S.user = me.user; S.memberships = me.memberships || [];
    }
  } catch { S.user = null; }
  if (!S.user) { await backToOrgs('discover'); return; }
  await landAfterLogin();
  subscribeEvents();
  if (!$('view-welcome').classList.contains('active')) await handleCheckHash(); // 手机扫现场二维码直达
})();

/** 现场二维码链路：#/check?a=<活动>&k=<checkin|checkout>&t=<令牌> */
async function handleCheckHash() {
  const m = location.hash.match(/^#\/check\?a=([^&]+)&k=(checkin|checkout)&t=([A-Za-z0-9]+)/);
  if (!m) return;
  const [, aid, kind, token] = m;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await api('POST', `/api/activities/${aid}/qcheckin`, { kind, token });
    toast(r.already ? '你已经打过卡了' : (kind === 'checkin' ? '扫码签到成功 ✓' : '扫码签退成功 ✓'));
    if (S.org) go('home');
  } catch (e) {
    openModal(`<h3 class="font-bold text-gray-800 mb-2">扫码签到未完成</h3>
      <p class="text-sm text-red-500">${esc(e.message)}</p>
      <p class="text-xs text-gray-400 mt-2">${e.status === 401 ? '请先登录（演示页可用一键登录），再重新扫码。' : '如有疑问请联系现场团队成员。'}</p>`);
  }
}

/* SSE：任何数据变更 → 重新拉取当前页（旧窗口自动更新） */
function subscribeEvents() {
  if (S.sse) S.sse.close();
  S.sse = new EventSource('/api/events');
  S._v = undefined; // 首条消息只校准版本号，不触发刷新
  S.sse.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (S._v === undefined) { S._v = msg.v; return; } // 首条：校准，不刷新
      if (msg.v !== S._v) {
        S._v = msg.v;
        if (S.org) refreshPage(true);
      }
    } catch { /* ignore */ }
  };
}

/* ---------- 认证 ---------- */
let authMode = 'login';
function switchAuth(m) {
  authMode = m;
  $('auth-tab-login').classList.toggle('active', m === 'login');
  $('auth-tab-register').classList.toggle('active', m === 'register');
  $('auth-name-row').style.display = m === 'register' ? 'block' : 'none';
  $('auth-submit').textContent = m === 'login' ? '进入工作台' : '注册并进入';
}
async function doAuth() {
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  try {
    if (authMode === 'register' && !$('auth-password').value) throw new Error('请填写密码');
    const data = await api('POST', authMode === 'login' ? '/api/auth/login' : '/api/auth/register',
      authMode === 'login' ? { username, password } : { username, password, display_name: $('auth-display').value.trim() });
    S.user = data.user;
    S.memberships = data.memberships || (await api('GET', '/api/me')).memberships || [];
    toast(`欢迎，${S.user.display_name}`);
    S.spaceTab = 'discover'; S.org = null; S.welcomeInterests = null; S.welcomeHome = null; S.publicWork = []; S.discoveryTopic = undefined;
    await landAfterLogin();
    subscribeEvents();
    if (!$('view-welcome').classList.contains('active')) handleCheckHash();
  } catch (e) { toast(e.message, 'err'); }
}
async function quickLogin(u, p) { $('auth-username').value = u; $('auth-password').value = p; authMode = 'login'; switchAuth('login'); doAuth(); }
async function doLogout() {
  await api('POST', '/api/auth/logout').catch(() => {});
  location.reload();
}

/* ---------- 视图切换 ---------- */
function showView(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
  $('view-' + v).classList.add('active');
  // 世界侧栏：登录后桌面端全局常驻（个人空间 ↔ 社区任何页面都能互切）
  const switcher = $('community-switch');
  if (switcher) switcher.hidden = (v === 'auth' || v === 'welcome' || !S.user);
  const rail = $('rail');
  if (rail) rail.style.display = ((v === 'auth' || v === 'welcome' || !S.user) || window.innerWidth < 768) ? 'none' : 'flex';
  document.body.classList.toggle('rail-open', v !== 'auth' && v !== 'welcome' && !!S.user && window.innerWidth >= 768);
}

/** 平台认证花标：蓝=企业认证（工商核验通过） 绿=平台资金复核认证；未认证不展示 */
function orgBadge(o) {
  const lv = (o && o.verify_level) || '';
  const meta = {
    blue: { bg: '#2563EB', tip: '演示认证标记 · 尚未接入真实工商核验' },
    green: { bg: '#16A34A', tip: '演示资金标记 · 不代表真实资金复核' },
  }[lv];
  if (!meta) return '';
  return `<span class="vbadge" style="background:${meta.bg}" title="${meta.tip}">✿</span>`;
}

/** 我的资料：自定义头像 + 全局昵称（组织内昵称由老板在成员页设置） */
const DEMO_ACCOUNTS = [
  ['boss', 'boss123456', '花老板', '顶层管理者视角', 'huamao'],
  ['opslead', 'ops123456', '喵小美', '内部成员视角', 'huamao'],
  ['m1', 'm1123456', '橘团团', '大众参与者视角', 'huamao'],
  ['laoshan', 'boss123456', '老杉', '顶层管理者视角', 'nanshan'],
  ['luxiaoxi', 'luxiaoxi123', '鹿小溪', '内部成员视角', 'nanshan'],
  ['xiaoman', 'xiaoman123', '小满', '大众参与者视角', 'nanshan'],
];
const DEMO_SET = new Set(DEMO_ACCOUNTS.map(a => a[0]));
function communityDemoAccounts() {
  return S.demoMode && S.org && DEMO_SET.has(S.user?.username)
    ? DEMO_ACCOUNTS.filter(a => a[4] === S.org.slug && a[0] !== S.user.username) : [];
}
async function switchCommunityDemo(username) {
  const account = communityDemoAccounts().find(a => a[0] === username);
  if (!account || S.demoSwitchPending) return;
  const orgId = S.org.id;
  S.demoSwitchPending = true;
  try {
    const data = await api('POST', '/api/auth/login', { username: account[0], password: account[1] });
    closeUserMenu(); closeModal(); closeDrawer();
    if (S.sse) S.sse.close();
    Object.assign(S, { user: data.user, memberships: data.memberships || [], org: null, orgRole: null,
      myNick: null, sub: {}, data: {}, publicWork: [], welcomeInterests: null, welcomeHome: null });
    S.memberships = (await api('GET', '/api/me')).memberships || [];
    await enterOrg(orgId);
    subscribeEvents();
  } catch (e) {
    toast('演示视角切换失败：' + e.message, 'err');
    if (!S.org) await backToOrgs();
  }
  finally { S.demoSwitchPending = false; }
}
/** 身份菜单（顶栏头像）：资料 / 切换组织 / 演示身份 / 退出登录——身份处就有出路 */
function closeUserMenu() {
  const m = $('user-menu');
  if (m) m.remove();
  document.removeEventListener('click', menuOutside, true);
}
function menuOutside(e) {
  const m = $('user-menu');
  if (m && !m.contains(e.target)) closeUserMenu();
}
function toggleUserMenu() {
  if ($('user-menu')) { closeUserMenu(); return; }
  const menu = document.createElement('div');
  menu.id = 'user-menu';
  menu.className = 'fixed cat-card rounded-2xl p-2.5 w-56 shadow-lg';
  menu.style.top = '54px';
  menu.style.right = '10px';
  menu.style.zIndex = 70;
  menu.innerHTML = `<div class="px-2 pb-2 mb-1 border-b border-gray-100">
      <div class="text-sm font-bold text-gray-800">${esc((S.org && S.myNick) || S.user.display_name)}</div>
      <div class="text-[10px] text-gray-400">${S.org ? '当前在 ' + esc(S.org.name) : '个人空间'}</div>
    </div>
    <button class="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50" onclick="closeUserMenu();openProfile()">👤 我的资料 / 收款方式</button>
    <button class="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50" onclick="closeUserMenu();showWelcome()">重新认识花猫 · 新手指南</button>
    ${S.org ? '<button class="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-gray-50" onclick="closeUserMenu();backToOrgs()">🏘 返回个人空间</button>' : ''}
    ${communityDemoAccounts().length ? '<div class="border-t border-gray-100 my-1"></div><div class="px-3 py-1 text-[10px] text-gray-400">🧪 本社区演示视角</div><p class="px-3 text-[10px] text-gray-400">切换到本社区的演示账号，体验对应权限。</p>' + communityDemoAccounts().map(a => `<button class="w-full text-left text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50" onclick="switchCommunityDemo('${a[0]}')">${a[2]} · ${a[3]}</button>`).join('') : ''}
    <div class="border-t border-gray-100 my-1"></div>
    <button class="w-full text-left text-sm px-3 py-2 rounded-lg text-red-500 hover:bg-red-50" onclick="closeUserMenu();doLogout()">⏻ 退出登录</button>`;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', menuOutside, true), 0);
}
function openProfile() {
  S._profLogo = S.user.avatar_url || '';
  openModal('<h3 class="font-bold text-gray-800 mb-4">我的资料</h3>' +
  '<div class="flex items-center gap-4 mb-4">' +
    '<div id="pf-avatar" class="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-white text-xl font-bold" style="background:' + (S.user.avatar_url ? 'transparent' : S.user.avatar_color) + '">' +
      (S._profLogo ? '<img src="' + esc(S._profLogo) + '" class="w-full h-full object-cover">' : esc((S.myNick || S.user.display_name)[0])) +
    '</div>' +
    '<div>' +
      '<label class="tab-btn cursor-pointer">上传头像<input type="file" accept="image/*" class="hidden" onchange="profLogo(this)"></label>' +
      (S._profLogo ? '<button class="text-xs text-gray-400 underline ml-2" onclick="profLogoClear()">移除</button>' : '') +
      '<p class="text-[11px] text-gray-400 mt-1">不上传则显示昵称首字 + 专属底色</p>' +
    '</div>' +
  '</div>' +
  '<div class="mb-3"><label class="text-xs text-gray-500">全局昵称（所有组织可见）</label>' +
    '<input id="pf-name" value="' + esc(S.user.display_name) + '"></div>' +
  '<div class="border-t border-gray-100 pt-3 mt-3 mb-3">' +
    '<p class="text-xs text-gray-500 font-semibold mb-2">💳 收款方式（分利打款用）</p>' +
    '<div class="grid grid-cols-2 gap-2 mb-1.5">' +
      '<input id="pf-pay-name" placeholder="实名校验名" maxlength="30" value="' + esc(S.user.pay_real_name || '') + '">' +
      '<input id="pf-pay-account" placeholder="' + esc(S.user.pay_account || '支付宝账号/手机号') + '" maxlength="64">' +
    '</div>' +
    '<button type="button" class="text-[11px] underline c-primary mb-1.5" style="padding:0 !important;width:auto;display:inline-block" onclick="alipayAuthModal()">演示支付宝绑定流程（非真实授权，正式环境不可用）</button>' +
    '<p class="text-[11px] text-gray-400">' +
      (S.user.pay_bound ? '已绑定（账号 ' + esc(S.user.pay_account) + '）；留空保存 = 不修改。' : '尚未绑定：填写实名 + 支付宝账号后保存。') +
      '账号与实名仅用于打款批次，任何列表都不展示。' +
      (S.user.pay_bound ? '<button type="button" class="underline c-primary ml-1" onclick="S._payClear=true;toast(\'已标记解除，点保存生效\',\'warn\')">解除绑定</button>' : '') +
    '</p>' +
  '</div>' +
  '<p class="text-[11px] text-gray-400 mb-4">组织内昵称由老板在「老板空间 → 成员与角色」设置' + (S.myNick ? '，当前组织显示「' + esc(S.myNick) + '」' : '') + '。</p>' +
  '<button class="cat-btn w-full py-2 rounded-xl" onclick="saveProfile()">保存</button>' +
  '<button type="button" class="w-full mt-4 py-2 rounded-xl text-sm text-red-500 bg-white border border-red-200" onclick="doLogout()">退出登录</button>');
}
function profLogo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('请选择图片文件', 'err');
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    S._profLogo = c.toDataURL('image/jpeg', .85);
    openProfile();
  };
  img.src = URL.createObjectURL(file);
}
function profLogoClear() { S._profLogo = ''; openProfile(); }
async function saveProfile() {
  try {
    const body = { display_name: $('pf-name').value.trim(), avatar_url: S._profLogo };
    if ($('pf-pay-name') && $('pf-pay-name').value.trim()) body.pay_real_name = $('pf-pay-name').value.trim();
    const acct = $('pf-pay-account') ? $('pf-pay-account').value.trim() : '';
    if (acct) body.pay_account = acct; // 留空 = 不修改收款账号
    if (S._payClear) { body.pay_account = ''; body.pay_real_name = ''; S._payClear = false; }
    const r = await api('PUT', '/api/me/profile', body);
    S.user = r.user;
    toast('资料已保存');
    closeModal(); renderShell();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 组织 ---------- */
async function renderOrgs() {
  const { orgs } = await api('GET', '/api/orgs');
  S.explore = orgs; // 同步探索页缓存
  if (!$('my-orgs') && !$('all-orgs')) return; // 标签未激活时容器不存在，跳过渲染
  const mine = new Map(S.memberships.map(m => [m.org_id, m]));
  /* 小卡多列：手机 2 列、桌面 3-4 列（信息只留"这是谁+你的身份+规模"，详情悬停可见） */
  if ($('my-orgs')) $('my-orgs').innerHTML = S.memberships.map(m => {
    const o = orgs.find(x => x.id === m.org_id);
    if (!o) return '';
    const av = o.logo_url ? `<img src="${esc(o.logo_url)}" class="w-8 h-8 rounded-lg object-cover flex-shrink-0">` : `<div class="avatar w-8 h-8 text-xs rounded-lg flex-shrink-0" style="background:${o.theme_color}">${esc(o.name[0])}</div>`;
    return `<div class="cat-card rounded-xl p-3 cursor-pointer hover:shadow-md transition" onclick="enterOrg('${o.id}')" title="${esc(o.intro)}">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="relative inline-flex flex-shrink-0">${av}${orgBadge(o)}</span>
        <div class="min-w-0"><div class="font-semibold text-gray-800 text-sm truncate">${esc(o.name)}</div>
        <div class="text-[10px] text-gray-400">${roleName(m.role)}</div></div>
      </div>
      <div class="text-[10px] text-gray-400">${o.members} 成员 · ${o.open_activities} 个进行中活动</div>
      ${m.can_invite ? `<button class="text-[10px] underline text-gray-400 mt-1" onclick="event.stopPropagation();memberInviteModal('${o.id}')">邀请成员</button>` : ''}
    </div>`;
  }).join('') || '<p class="text-sm text-gray-400">还没有加入任何组织</p>';
  if ($('all-orgs')) $('all-orgs').innerHTML = orgs.filter(o => !mine.has(o.id)).map(o => `
    <div class="cat-card rounded-xl p-3">
      <div class="flex items-center gap-2 mb-1">
        <span class="relative inline-flex flex-shrink-0">
          ${o.logo_url ? `<img src="${esc(o.logo_url)}" class="w-8 h-8 rounded-lg object-cover flex-shrink-0">` : `<div class="avatar w-8 h-8 text-xs rounded-lg flex-shrink-0" style="background:${o.theme_color}">${esc(o.name[0])}</div>`}
          ${orgBadge(o)}
        </span>
        <div class="font-semibold text-sm text-gray-800 truncate">${esc(o.name)}</div>
      </div>
      <p class="text-[11px] text-gray-400 line-clamp-1 mb-1.5" title="${esc(o.intro)}">${esc(o.intro)}</p>
      <div class="text-[10px] text-gray-400 mb-2">${o.followers} 人关注 · ${o.members} 位共建成员 · ${o.open_activities} 个活动</div>
      <div class="flex gap-1.5">
        <button class="tab-btn text-[11px] px-2 py-1" onclick="openOrgPreview('${o.id}')">看看</button>
        <button class="cat-secondary text-[11px] px-2 py-1 rounded-lg" onclick="followOrg('${o.id}')">关注</button>
      </div>
    </div>`).join('') || '<p class="text-sm text-gray-400 col-span-4">暂无其他组织</p>';
}
function roleName(r) {
  let labels = null;
  try { labels = S.org?.role_labels ? JSON.parse(S.org.role_labels) : null; } catch { labels = null; }
  return (labels && labels[r]) || ({ owner: '顶层管理者', internal: '内部成员', participant: '大众参与者' }[r] || r);
}

/** 共建申请：关注与活动报名都不触发；获批后才进入成员名册。 */
function openJoinCard(orgId) {
  openModal(`<h3 class="font-bold text-gray-800 mb-1">申请成为共建成员</h3>
  <p class="text-xs text-gray-400 mb-4">关注或报名活动不需要申请。此申请由主理人审核；批准后才进入长期共建成员名册，仍不授予内部运营或管理权限。</p>
  <div class="space-y-3">
    <div><label class="text-xs text-gray-500">申请说明（可选）</label><textarea id="jc-note" maxlength="300" rows="3" placeholder="例如：想长期参与内容共建或活动执行"></textarea></div>
    <button class="cat-btn w-full py-2 rounded-xl" onclick="doJoinCard('${orgId}')">提交共建申请</button>
  </div>`);
  setTimeout(() => $('jc-note')?.focus(), 100);
}
async function doJoinCard(orgId) {
  try {
    await api('POST', `/api/orgs/${orgId}/join-applications`, { note: $('jc-note').value.trim() });
    closeModal(); toast('共建申请已提交；关注与活动报名不受影响');
  } catch (e) { toast(e.message, 'err'); }
}
async function followOrg(orgId, unfollow = false) {
  try { await api(unfollow ? 'DELETE' : 'POST', `/api/orgs/${orgId}/follow`); toast(unfollow ? '已取消关注' : '已关注，可在发现页继续看活动'); await showExplore(); }
  catch (e) { toast(e.message, 'err'); }
}
/** 创建组织三步向导：① 组织信息 ② 品牌外观（配套色卡/自定义/logo） ③ 积分与启动 */
function openOrgWizard() {
  if (!S._wiz || S._wiz._done) {
    S._wiz = { step: 1, name: '', slug: '', intro: '', suitableFor: '', keywords: '', baseLocation: '', baseLat: null, baseLng: null, paletteKey: 'jvshong', primary: '#F97C2F', brandName: '橘颂', logo: null, currency: '积分', template: true, ownerNick: S.user.display_name, demo: S.demoMode };
  }
  S._wizStep = S._wiz.step || 1;
  S._wiz.pname = S._wiz.name || '你的组织';
  S._wiz.currency = S._wiz.currency || '积分';
  openModal(wizHtml());
}
function wizHtml() {
  const step = S._wiz.step;
  const steps = ['组织信息', '品牌外观', '积分与启动'];
  const head = `<div class="flex items-center gap-2 mb-5">${steps.map((nm, i) => `
    <div class="flex items-center gap-1.5">
      <span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === i + 1 ? 'bg-primary text-white' : step > i + 1 ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}">${step > i + 1 ? '✓' : i + 1}</span>
      <span class="text-xs ${step === i + 1 ? 'font-bold text-gray-800' : 'text-gray-400'}">${nm}</span>
    </div>${i < 2 ? '<span class="w-6 h-px bg-gray-200"></span>' : ''}`).join('')}</div>`;
  let body = '';
  if (step === 1) body = `
    <div class="space-y-3">
      <div><label class="text-xs text-gray-500">组织名称 *</label><input value="${esc(S._wiz.name)}" placeholder="如：花猫社区" oninput="S._wiz.name=this.value; S._wiz.pname=this.value"></div>
      <div><label class="text-xs text-gray-500">标识（URL 用，小写字母/数字/短横线）</label><input value="${esc(S._wiz.slug)}" placeholder="huamao" oninput="S._wiz.slug=this.value"></div>
      <div><label class="text-xs text-gray-500">这个社区具体在做什么 *</label><textarea rows="3" placeholder="用事实说明：组织什么活动、协作解决什么问题、会产出什么" oninput="S._wiz.intro=this.value">${esc(S._wiz.intro)}</textarea></div>
      <div><label class="text-xs text-gray-500">适合谁加入或关注 *</label><input value="${esc(S._wiz.suitableFor || '')}" placeholder="如：想把 AI 用进制造现场的青年研发者、学生与创业者" oninput="S._wiz.suitableFor=this.value"></div>
      <div><label class="text-xs text-gray-500">关键词（逗号分隔，供其他用户发现）</label><input value="${esc(S._wiz.keywords)}" placeholder="社区,协作" oninput="S._wiz.keywords=this.value"></div>
      <div><label class="text-xs text-gray-500">常驻城市 / 基地</label><div class="flex gap-2"><input value="${esc(S._wiz.baseLocation)}" placeholder="如：株洲·万丰湖（不填具体门牌）" oninput="S._wiz.baseLocation=this.value"><button type="button" class="tab-btn text-xs flex-shrink-0" onclick="baseGeoUse()">标记当前位置</button></div><p id="wiz-base-geo" class="text-[10px] text-gray-400 mt-1">用于附近推荐和活动地点默认值；单场活动可另改具体公园、楼栋或线上地点。</p></div>
    </div>`;
  else if (step === 2) body = `
    <p class="text-xs text-gray-400 mb-3">选一套<b class="text-gray-600">配套色卡</b>——每套都是背景/主色/强调的完整搭配，由平台审美把关；也保留完全自定义。</p>
    ${brandPickerHtml('wiz')}`;
  else body = `
    <div class="space-y-4">
      <div><label class="text-xs text-gray-500">积分叫什么（将出现在所有界面）</label><input value="${esc(S._wiz.currency)}" oninput="S._wiz.currency=this.value"></div>
      <div><label class="text-xs text-gray-500">你（核心负责人）在这个组织的昵称</label><input value="${esc(S._wiz.ownerNick || '')}" placeholder="${esc(S.user.display_name)}" oninput="S._wiz.ownerNick=this.value"></div>
      <label class="flex items-start gap-2.5 bg-gray-50 rounded-xl p-3.5 cursor-pointer">
        <input type="checkbox" ${S._wiz.template ? 'checked' : ''} onchange="S._wiz.template=this.checked" class="!w-4 !h-4 mt-0.5">
        <span class="text-sm text-gray-600">使用默认起步模板：自动生成四大分类任务库（媒体/运营/项目/资源）、配套分利类目与规则 v1，创建后可自行增删改</span>
      </label>
      ${S.demoMode ? `<label class="flex items-start gap-2.5 bg-gray-50 rounded-xl p-3.5 cursor-pointer">
        <input type="checkbox" ${S._wiz.demo ? 'checked' : ''} onchange="S._wiz.demo=this.checked" class="!w-4 !h-4 mt-0.5">
        <span class="text-sm text-gray-600">生成示例数据：演示成员（中间成员/参与者，各起昵称）、活动与签到、成果与积分流水、项目与分红草稿——方便开张即确认，随时可删</span>
      </label>` : ''}
      <div class="text-xs text-gray-400">创建后你将成为该组织的顶层管理者；外观随时可在「老板空间 → 组织品牌」调整，对所有成员即时生效。</div>
    </div>`;
  const foot = `<div class="flex gap-2 mt-5">
    ${step > 1 ? '<button class="tab-btn px-4" onclick="wizGo(-1)">上一步</button>' : '<button class="tab-btn px-4" onclick="closeModal()">取消</button>'}
    <button class="cat-btn px-6 py-2 rounded-xl text-sm ml-auto" onclick="wizGo(1)">${step < 3 ? '下一步' : '创建我的组织'}</button>
  </div>`;
  return `<h3 class="font-bold text-gray-800 mb-4">创建组织</h3>${head}${body}${foot}`;
}
function wizGo(dir) {
  if (dir > 0 && S._wiz.step === 3) return createOrg();
  if (dir > 0 && S._wiz.step === 1) {
    if (!S._wiz.name.trim() || !S._wiz.intro.trim() || !S._wiz.suitableFor.trim()) return toast('请先说清社区在做什么、适合谁', 'err');
    if (!S._wiz.slug.trim()) S._wiz.slug = 'org-' + Math.random().toString(36).slice(2, 6);
  }
  S._wiz.step = Math.min(3, Math.max(1, S._wiz.step + dir));
  S._wizStep = S._wiz.step;
  S._wiz.pname = S._wiz.name || '你的组织';
  openModal(wizHtml());
}
async function createOrg() {
  const w = S._wiz;
  const brand = bpExport('wiz');
  try {
    const { id } = await api('POST', '/api/orgs', {
      name: w.name, slug: w.slug, intro: w.intro, suitable_for: w.suitableFor, keywords: w.keywords, base_location: w.baseLocation, base_lat: w.baseLat, base_lng: w.baseLng,
      theme_color: brand.primary, currency_name: w.currency || '猫粮', logo_url: w.logo || '', brand,
      owner_nickname: (w.ownerNick || '').trim() || undefined, demo: S.demoMode && !!w.demo, with_tasks: !!w.template,
    });
    w._done = true;
    closeModal();
    toast(`「${w.name}」已开张，这就是你自己的组织了`);
    const me = await api('GET', '/api/me');
    S.memberships = me.memberships;
    await enterOrg(id);
  } catch (e) { toast(e.message, 'err'); }
}

function baseGeoUse() {
  if (!navigator.geolocation) return toast('浏览器不支持定位，请只填写常驻城市/基地名称', 'err');
  navigator.geolocation.getCurrentPosition(pos => {
    S._wiz.baseLat = Number(pos.coords.latitude.toFixed(5)); S._wiz.baseLng = Number(pos.coords.longitude.toFixed(5));
    const hint = $('wiz-base-geo'); if (hint) hint.textContent = '已标记基地坐标；对外仍只展示你填写的城市/基地名称。';
    toast('基地坐标已标记');
  }, () => toast('未能获取当前位置，仍可只填写常驻城市/基地名称', 'warn'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
}

/** 老板空间 · 组织品牌：随时调整外观，全员即时生效 */
function bossBrand() {
  if (!S._br || S._br._orgId !== S.org.id) {
    let b = null;
    try { b = S.org.brand ? JSON.parse(S.org.brand) : null; } catch { b = null; }
    S._br = { _orgId: S.org.id, paletteKey: (b && b.key) || 'custom', primary: (b && b.primary) || S.org.theme_color || '#F97C2F', brandName: (b && b.name) || '自定义', logo: S.org.logo_url || null, currency: S.org.currency_name, intro: S.org.intro || '', keywords: S.org.keywords || '' };
    S._br.pname = S.org.name;
  }
  /* 企业认证花标：联想式工商核验（真实接入企查查等 API 后全自动） */
  const vi = (() => { try { return S.org.verify_info ? JSON.parse(S.org.verify_info) : null; } catch { return null; } })();
  const lv = S.org.verify_level || '';
  const LVN = { blue: '演示标记 · 未实际认证', green: '演示标记 · 未实际复核' };
  const verifyCard = `<div class="cat-card rounded-2xl p-5 mb-4">
    <div class="flex items-start justify-between flex-wrap gap-2">
      <div class="flex items-center gap-3 min-w-0">
        <span class="relative inline-flex flex-shrink-0">
          ${S.org.logo_url ? `<img src="${esc(S.org.logo_url)}" class="w-10 h-10 rounded-xl object-cover">` : `<span class="avatar w-10 h-10" style="background:${S.org.theme_color}">${esc(S.org.name[0])}</span>`}
          ${orgBadge(S.org)}
        </span>
        <div class="min-w-0">
          <h3 class="font-semibold text-gray-800 text-sm">认证花标 ${lv ? `<span class="badge" style="background:var(--hm-primary-soft);color:var(--hm-primary-deep)">${LVN[lv] || lv}</span>` : '<span class="badge bg-gray-100 text-gray-400">未认证</span>'}</h3>
          <p class="text-[11px] text-gray-400 mt-0.5">${lv
            ? `${esc(vi ? vi.name : '')}${vi && vi.credit_code ? ' · ' + esc(vi.credit_code) : ''}${vi && vi.verified_at ? ' · 核验于 ' + dOnly(vi.verified_at) : ''}`
            : '未认证的组织不展示花标；认证后组织卡与预览页带标，成员与参与方更信任分利打款'}</p>
        </div>
      </div>
      ${lv !== 'green' ? `<button class="cat-btn px-4 py-2 rounded-xl text-sm flex-shrink-0" onclick="verifyModal()">${lv ? '升级核验 / 重新认证' : '发起企业认证'}</button>` : ''}
    </div>
    <p class="text-[11px] text-gray-400 mt-2.5 leading-relaxed">此处为演示流程，企业资料由模拟数据生成，不代表工商认证或资金安全。正式环境暂不开放认证，需接入真实核验服务。</p>
  </div>`;
  return `${S._brDirty ? `<div class="rounded-xl p-3 mb-4 text-sm flex items-center justify-between" style="background:var(--hm-primary-soft)">
    <span class="c-primary-deep">正在预览「${esc(S._br.brandName || '新配色')}」——整个界面已切换，满意再保存</span>
    <button class="text-xs underline c-primary" onclick="undoBrand()">撤销预览</button>
  </div>` : ''}
  ${verifyCard}
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h3 class="font-semibold text-gray-800 text-sm mb-1">品牌外观</h3>
    <p class="text-xs text-gray-400 mb-4">点击色卡或自定义颜色，整个界面立即预览；预览满意后再保存，保存后对全部成员即时生效（品牌是配置，不是代码）。</p>
    ${brandPickerHtml('br')}
    <button class="cat-btn w-full py-2.5 rounded-xl mt-4" onclick="saveBrand()">${S._brDirty ? '保存品牌设置（当前为预览）' : '保存品牌设置'}</button>
  </div>
  <div class="cat-card rounded-2xl p-5">
    <h3 class="font-semibold text-gray-800 text-sm mb-3">组织信息</h3>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <div><label class="text-xs text-gray-500">积分名称</label><input value="${esc(S._br.currency)}" oninput="S._br.currency=this.value"></div>
      <div><label class="text-xs text-gray-500">关键词（逗号分隔）</label><input value="${esc(S._br.keywords)}" oninput="S._br.keywords=this.value"></div>
      <div><label class="text-xs text-gray-500">一句话介绍</label><input value="${esc(S._br.intro)}" oninput="S._br.intro=this.value" class="md:col-span-2"></div>
    </div>
    <button class="cat-secondary w-full py-2.5 rounded-xl mt-4" onclick="saveBrand()">保存组织信息</button>
  </div>`;
}
function bossBrandRefresh() { go('boss', { tab: 'org' }, true); }
function undoBrand() {
  S._brDirty = false;
  S._br._orgId = null; // 触发从已保存品牌重初始化
  applyBrand();
  go('boss', { tab: 'org' }, true);
  toast('已撤销预览，恢复原品牌');
}
async function saveBrand() {
  try {
    const brand = bpExport('br');
    const st = S._br;
    await api('PUT', `/api/orgs/${S.org.id}/brand`, {
      brand, logo_url: st.logo || '', currency_name: st.currency, intro: st.intro, keywords: st.keywords,
    });
    const d = await api('GET', `/api/orgs/${S.org.id}`);
    S.org = d.org; S.orgRole = d.role;
    S._brDirty = false;
    applyBrand(); renderShell();
    S._br._orgId = null; // 触发重初始化
    toast('品牌已更新，对全员即时生效');
    go('boss', { tab: 'org' }, true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 进入组织工作台 ---------- */
async function enterOrg(orgId) {
  closeUserMenu();
  try {
    const d = await api('GET', `/api/orgs/${orgId}`);
    S.org = d.org; S.orgRole = d.role; S.counts = d.counts;
    const mm = S.memberships.find(x => x.org_id === orgId);
    S.myNick = mm?.nickname || null;
    applyBrand(); // 品牌即配置：进入组织即换肤
    applyOrgIcon(); // 图标位跟随组织（favicon/标题/系统主题色）
    localStorage.setItem('hm_last_org', orgId);
    api('PUT', '/api/me/last-org', { org_id: orgId }).catch(() => {}); // 服务端记忆
    await loadLayout();
    showView('app');
    renderShell();
    // 优先进入第一个可见板块（老板默认落在老板空间）
    const first = navList()[0] || 'home';
    await go(first);
    refreshNotices(); // 世界侧栏徽标 + 移动端返回钮红点（异步，不阻塞进入）
  } catch (e) {
    // 可控失败（fail-safe）：社区不存在/已移除/无权/会话过期 → 清掉陈旧引用，
    // 永远回到"个人空间"这条活路——个人空间属于用户本人，永远存在
    localStorage.removeItem('hm_last_org');
    S.org = null;
    if (e.status === 401) { showView('auth'); return; }
    toast(e.status === 404 ? '该社区不存在或已被移除，已回到你的个人空间' : '进入社区失败，已回到你的个人空间', 'warn', e.status !== 404 ? '重试' : null, e.status !== 404 ? () => enterOrg(orgId) : null);
    await backToOrgs();
  }
}
async function backToOrgs(tab) {
  closeUserMenu();
  S.org = null; S.orgRole = null; S.myNick = null;
  S.spaceTab = typeof tab === 'string' ? tab : (S.spaceTab || 'discover');
  applyBrand();
  document.title = '贡献者工作台';
  $('favicon').removeAttribute('href');
  $('apple-touch').removeAttribute('href');
  $('meta-theme').content = '#F97C2F';
  showView('orgs');
  await renderMySpace();
  if (S.user) { renderRail(); subscribeEvents(); refreshNotices(); }
}

const PAGES = [
  { id: 'home', name: '活动', icon: '📅', min: 'participant' },
  { id: 'tasks', name: '共建任务', icon: '🎯', min: 'participant' },
  { id: 'mall', name: '兑换商城', icon: '🛍', min: 'participant' },
  { id: 'mine', name: '我的贡献', icon: '🎒', min: 'participant' },
  { id: 'board', name: '贡献阶梯', icon: '🪜', min: 'participant' },
  { id: 'team', name: '协作', icon: '🤝', min: 'internal' },
  { id: 'boss', name: '管理', icon: '👑', min: 'owner' },
];
const RANK = { participant: 1, internal: 2, owner: 3 };

/* 每个身份的默认工作台（主观建议）：老板=管理/宏观数据最前，贴心收起任务广场（可自定义加回）；
   内部成员=协作最前；参与者=发现与参与最前 */
const DEFAULT_LAYOUTS = {
  owner: ['home', 'tasks', 'team', 'boss', 'mine'],
  internal: ['home', 'tasks', 'team', 'mine', 'board'],
  participant: ['home', 'tasks', 'mine', 'board'],
};
const TEAM_TABS = [['review', '📋 待审核'], ['acts', '📅 活动管理'], ['library', '📚 任务库'], ['projects', '🧩 项目协作']];
const BOSS_TABS = [['stats', '📊 全局统计'], ['dist', '💰 分利模拟'], ['members', '👥 成员与角色'], ['audit', '🛡 审计与数据'], ['org', '🎨 组织品牌']];
const SUB_TAB_NAMES = { review: '待审核', acts: '活动管理', create: '新建活动', library: '任务库', projects: '项目协作', stats: '全局统计', dist: '分利模拟', members: '成员与角色', audit: '审计与数据' };

function allowedPages(role) { return PAGES.filter(p => RANK[role] >= RANK[p.min]); }
function navList() {
  const allowed = allowedPages(S.orgRole).map(p => p.id);
  if (!S.layout || !Array.isArray(S.layout.nav)) return (DEFAULT_LAYOUTS[S.orgRole] || allowed).filter(id => allowed.includes(id));
  const saved = S.layout.nav.filter(id => allowed.includes(id)); // 未出现的 = 用户隐藏
  // 兜底：布局被清空/全部隐藏时回到默认，保证功能永远可达
  return saved.length ? saved : (DEFAULT_LAYOUTS[S.orgRole] || allowed).filter(id => allowed.includes(id));
}
function subList(kind) {
  const defs = kind === 'teamSub' ? TEAM_TABS : BOSS_TABS;
  const ids = defs.map(d => d[0]);
  const saved = (S.layout && Array.isArray(S.layout[kind])) ? S.layout[kind].filter(id => ids.includes(id)) : [];
  return [...saved, ...ids.filter(id => !saved.includes(id))];
}
async function loadLayout() {
  try { const d = await api('GET', `/api/me/layout?org=${S.org.id}`); S.layout = d.layout || {}; }
  catch { S.layout = {}; }
}
async function saveLayout() {
  try { await api('PUT', `/api/orgs/${S.org.id}/layout`, { layout: S.layout }); }
  catch (e) { toast(e.message, 'err'); }
}

/* 拖动排序（桌面拖拽；移动端用自定义面板里的箭头） */
let _dragTab = null;
function tabDragStart(e, key) { _dragTab = key; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', key); } catch (_) { /* 浏览器拒绝 dataTransfer 时放弃携带数据，拖拽本身仍可用 */ } } }
async function tabDrop(e, key, kind) {
  e.preventDefault();
  if (!_dragTab || _dragTab === key) { _dragTab = null; return; }
  const from = _dragTab; _dragTab = null;
  if (kind === 'nav') {
    const arr = navList();
    const i = arr.indexOf(from), j = arr.indexOf(key);
    if (i < 0 || j < 0) return;
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    S.layout.nav = arr;
    await saveLayout();
    renderShell();
  } else {
    const arr = subList(kind);
    const i = arr.indexOf(from), j = arr.indexOf(key);
    if (i < 0 || j < 0) return;
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    S.layout[kind] = arr;
    await saveLayout();
    go(S.page, S.sub, true);
  }
}

/** 自定义工作台面板：勾选显隐 + 调序（受限板块根本不在列表里） */
function openLayoutModal() {
  const allowed = allowedPages(S.orgRole);
  const visible = navList();
  const hidden = allowed.map(p => p.id).filter(id => !visible.includes(id));
  openModal(`<h3 class="font-bold text-gray-800 mb-1">自定义我的工作台</h3>
  <p class="text-xs text-gray-400 mb-3">电脑端可拖动、手机端用 ↑↓ 箭头调整顺序；勾选决定是否显示；改动<b>即时生效</b>并同步所有设备。你的身份没有权限的板块不会出现在这里。</p>
  <div id="lay-list">${[...visible, ...hidden].map(id => PAGES.find(p => p.id === id)).map(p => `
    <div class="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5 mb-2" draggable="true"
      ondragstart="tabDragStart(event,'${p.id}')" ondragover="event.preventDefault()" ondrop="layDrop(event,'${p.id}')">
      <label class="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" ${visible.includes(p.id) ? 'checked' : ''} onchange="layToggle('${p.id}', this.checked)" class="!w-4 !h-4">
        <span>${p.icon} ${p.name}${hidden.includes(p.id) ? ' <span class="text-[10px] text-gray-400">（已收起）</span>' : ''}</span>
      </label>
      <span class="flex gap-1.5">
        <button type="button" class="text-sm px-2.5 py-1.5 bg-white rounded-lg border" onclick="layMove('${p.id}',-1)">↑</button>
        <button type="button" class="text-sm px-2.5 py-1.5 bg-white rounded-lg border" onclick="layMove('${p.id}',1)">↓</button>
      </span>
    </div>`).join('')}</div>
  <div class="flex gap-2 mt-3">
    <button class="tab-btn flex-1" onclick="layReset()">恢复默认</button>
    <button class="cat-btn flex-1 py-2 rounded-xl text-sm" onclick="closeModal();renderShell()">完成</button>
  </div>`);
}
function layDrop(e, id) {
  e.preventDefault();
  if (!_dragTab || _dragTab === id) { _dragTab = null; return; }
  const from = _dragTab; _dragTab = null;
  const visible = navList();
  const hidden = allowedPages(S.orgRole).map(p => p.id).filter(x => !visible.includes(x));
  const all = [...visible, ...hidden];
  const i = all.indexOf(from), j = all.indexOf(id);
  if (i < 0 || j < 0) return;
  all.splice(j, 0, all.splice(i, 1)[0]);
  S.layout.nav = all.filter(x => visible.includes(x));
  saveLayout();
  renderShell();
  openLayoutModal();
}
function layToggle(id, on) {
  let arr = navList();
  if (on && !arr.includes(id)) arr.push(id);
  if (!on) arr = arr.filter(x => x !== id);
  S.layout.nav = arr;
  saveLayout();
  renderShell(); // ★ 实时刷新底部/顶部导航，不用等关闭弹窗
  if (!navList().includes(S.page)) go(navList()[0] || 'home', {}, true); // 收起的是当前所在页 → 回到第一个可见板块
  openLayoutModal();
}
function layMove(id, dir) {
  const visible = navList();
  const hidden = allowedPages(S.orgRole).map(p => p.id).filter(x => !visible.includes(x));
  const all = [...visible, ...hidden];
  const i = all.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  all.splice(j, 0, all.splice(i, 1)[0]);
  S.layout.nav = all.filter(x => visible.includes(x));
  saveLayout();
  renderShell(); // 排序即时生效
  openLayoutModal();
}
async function layReset() {
  delete S.layout.nav;
  await saveLayout();
  renderShell(); openLayoutModal();
}

/* ====================================================================
   世界侧栏（Discord 式跨社区穿梭）+ 跨组织通知（目的性原则）
   规则：① 侧栏只显示"你加入过的"社区，预览不留存；② 通知只聚合
   "你选择了的事"（报名的活动/你的成果/你管理的队列），跨社区发现
   只存在于个人空间推荐卡——单社区用户看到的永远只有"自己+一个世界"。
   ==================================================================== */
function renderRail() {
  const rail = $('rail');
  if (!rail || !S.user || $('view-welcome').classList.contains('active') || $('view-auth').classList.contains('active')) return;
  const switcher = $('community-switch');
  if (switcher) {
    switcher.hidden = false;
    switcher.innerHTML = `<button class="community-chip" aria-current="${!S.org}" onclick="backToOrgs('discover')"><span class="community-face">我</span>全局发现 / 我的</button>` +
      (S.memberships || []).map(m => `<button class="community-chip" aria-current="${S.org?.id === m.org_id}" onclick="enterOrg('${m.org_id}')"><span class="community-face">${m.logo_url ? `<img src="${esc(m.logo_url)}" alt="">` : esc(m.name[0])}</span>${esc(m.name)}</button>`).join('') +
      `<button class="community-chip" onclick="showExplore()">＋ 发现社区</button>`;
  }
  rail.style.display = window.innerWidth < 768 ? 'none' : 'flex';
  document.body.classList.toggle('rail-open', window.innerWidth >= 768);
  const noticesOf = orgId => (S.notices && S.notices.orgs && S.notices.orgs[orgId] && S.notices.orgs[orgId].count) || 0;
  const face = (url, color, ch, cls) => url
    ? `<img src="${esc(url)}" class="${cls || ''}" alt="">`
    : `<span class="rail-face ${cls || ''}" style="background:${color}">${esc(ch)}</span>`;
  const orgBtns = (S.memberships || []).map(m => {
    const n = noticesOf(m.org_id);
    const active = S.org && S.org.id === m.org_id;
    return `<button class="rail-btn ${active ? 'rail-active' : ''}" onclick="enterOrg('${m.org_id}')">
      ${face(m.logo_url, m.theme_color, (m.nickname || m.name)[0])}
      ${n ? `<span class="rail-badge">${n > 9 ? '9+' : n}</span>` : ''}
      <span class="rail-tip">${esc(m.nickname ? m.nickname + ' · ' : '')}${esc(m.name)}${n ? ' · ' + n + ' 件待处理' : ''}</span>
    </button>`;
  }).join('');
  rail.innerHTML = `
    <div class="flex flex-col items-center gap-0.5">
      <button class="rail-btn ${!S.org ? 'rail-active' : ''}" onclick="backToOrgs('discover')" title="">
        ${face(S.user.avatar_url, S.user.avatar_color, S.user.display_name[0])}
        <span class="rail-tip">全局发现 · 我的空间</span>
      </button>
      <span class="text-[9px] ${!S.org ? 'c-primary-deep font-bold' : 'text-gray-400'}">我的空间</span>
    </div>
    <div class="w-8 h-px bg-gray-300/60 my-1 flex-shrink-0"></div>
    ${orgBtns}
    <div class="flex flex-col items-center gap-0.5">
      <button class="rail-btn rail-add" onclick="showExplore()">＋<span class="rail-tip">发现社区 / 创建社区</span></button>
      <span class="text-[9px] text-gray-400">发现</span>
    </div>`;
}
/* 尺寸切换（旋转/拉窗口）时同步侧栏显隐与内容让位，防止错位遮挡 */
let _rzT = null;
window.addEventListener('resize', () => {
  clearTimeout(_rzT);
  _rzT = setTimeout(() => {
    if (!S.user || $('view-welcome').classList.contains('active')) return;
    renderRail();
    if (!S.org) renderMySpace();
  }, 150);
});
async function refreshNotices() {
  if (!S.user) return;
  try { S.notices = await api('GET', '/api/me/notices'); }
  catch { S.notices = S.notices || null; }
  renderRail();
  const total = S.notices ? S.notices.total : 0;
  // 微信式贴角提醒：红点紧贴图标右上角——手机端贴在"‹ 空间"返回钮与右上角头像上
  const dot = $('ws-back-dot');
  if (dot) dot.style.display = total ? 'block' : 'none';
  const adot = $('ws-avatar-dot');
  if (adot) adot.style.display = total ? 'block' : 'none';
}
/** 从通知/待办跳转：切到对应世界并直达板块；收款收集类直接打开资料弹窗 */
async function jumpNotice(orgId, page, sub) {
  if (page === 'profile') { openProfile(); return; }
  await enterOrg(orgId);
  go(page || 'home', sub || {});
}
/** 组织预览（先看后加，预览不留存） */
async function openOrgPreview(orgId) {
  const d = await api('GET', `/api/orgs/${orgId}/preview`);
  const o = d.org;
  openModal(`<div class="flex items-center gap-3 mb-2">
      <span class="relative inline-flex flex-shrink-0">
        ${o.logo_url ? `<img src="${esc(o.logo_url)}" class="w-11 h-11 rounded-xl object-cover">` : `<span class="avatar w-11 h-11" style="background:${o.theme_color}">${esc(o.name[0])}</span>`}
        ${orgBadge(o)}
      </span>
      <div><h3 class="font-bold text-gray-800">${esc(o.name)}</h3>
      <p class="text-[11px] text-gray-400">${o.base_location ? '📍 ' + esc(o.base_location) + ' · ' : ''}${d.followers} 人关注 · ${d.members} 位共建成员 · 已举办 ${d.activity_count} 场</p></div>
    </div>
    <p class="text-sm text-gray-600 mb-2">${esc(o.intro || '这个社区还没有介绍。')}</p>
    <p class="text-xs text-gray-500 mb-3"><b>适合谁：</b>${esc(o.suitable_for || '暂未说明')}</p>
    ${d.open_activities.length ? `<div class="text-xs font-semibold text-gray-500 mb-1.5">开放招募中的活动</div>
      <div class="space-y-1.5 mb-3 max-h-48 overflow-y-auto">${d.open_activities.map(a => `
        <div class="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
          <div class="min-w-0"><div class="text-sm text-gray-800 truncate">${esc(a.title)}</div>
          <div class="text-[10px] text-gray-400">${TYPE_CN[a.activity_type] || ''} · ${dt(a.start_at)} · ${esc(a.location || o.base_location || '地点待公布')} · ${a.reg_count} 人已报名</div><div class="text-[11px] text-gray-500 truncate mt-0.5">${esc(a.description)}</div></div>
          ${a.output_reg ? '<span class="badge bg-green-100 text-green-700 flex-shrink-0">🪙 有产出</span>' : ''}
        </div>`).join('')}</div>`
      : '<p class="text-xs text-gray-400 mb-3">暂无开放招募的活动。</p>'}
    <p class="text-[11px] text-gray-400 mb-3">关注只接收该社区公开动态；报名只关联一场活动；两者都不会进入共建成员名册。</p>
    ${d.role
      ? `<button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="closeModal();enterOrg('${orgId}')">进入该社区</button>`
      : `<div class="flex gap-2"><button class="cat-btn flex-1 py-2 rounded-xl text-sm" onclick="followOrg('${orgId}',${d.followed ? 'true' : 'false'});closeModal()">${d.followed ? '取消关注' : '关注社区'}</button><button class="tab-btn flex-1 py-2 rounded-xl text-sm" onclick="closeModal();openJoinCard('${orgId}')">${d.application === 'pending' ? '共建申请处理中' : '申请共建'}</button></div>`}`);
}

/* ---------- 发现社区（Discord 式探索：搜索 + 关键词标签 + 大卡预览） ---------- */
async function showExplore() {
  if (!S.user) return;
  const { orgs } = await api('GET', '/api/orgs');
  S.explore = orgs;
  showView('explore');
  window.scrollTo(0, 0);
  exploreFilter();
}
function exploreKeywords() {
  const counts = {};
  for (const o of S.explore || []) {
    for (const k of String(o.keywords || '').split(/[,，]/)) {
      const k2 = k.trim();
      if (k2) counts[k2] = (counts[k2] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
}
function exploreFilter() {
  if (!S.explore) return;
  const q = ($('exp-q') ? $('exp-q').value : '').trim().toLowerCase();
  const kw = S._expKw || '';
  const mine = new Map(S.memberships.map(m => [m.org_id, m]));
  let list = (S.explore || []).filter(o => !mine.has(o.id));
  if (q) list = list.filter(o => (o.name + o.intro + o.keywords).toLowerCase().includes(q));
  if (kw) list = list.filter(o => String(o.keywords || '').includes(kw));
  const chips = exploreKeywords().map(([k, n]) =>
    `<button class="tab-btn ${kw === k ? 'active' : ''}" onclick="expKw('${esc(k)}')">${esc(k)} <span class="opacity-60">${n}</span></button>`).join('');
  $('exp-chips').innerHTML = chips ? chips + (kw ? '<button class="tab-btn" onclick="expKw(\'\')">清除</button>' : '') : '';
  $('exp-grid').innerHTML = list.map(o => {
    const av = o.logo_url ? `<img src="${esc(o.logo_url)}" class="w-12 h-12 rounded-xl object-cover ring-2 ring-white">` : `<span class="avatar w-12 h-12 text-base ring-2 ring-white" style="background:${o.theme_color}">${esc(o.name[0])}</span>`;
    return `<div class="cat-card rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition" onclick="openOrgPreview('${o.id}')">
      <div class="h-14" style="background:linear-gradient(135deg,${o.theme_color} 0%,${shade(o.theme_color, -28)} 100%)"></div>
      <div class="px-4 pb-4 -mt-6">
        <span class="relative inline-flex">${av}${orgBadge(o)}</span>
        <div class="font-bold text-gray-800 mt-1.5">${esc(o.name)}</div>
        <p class="text-xs text-gray-500 line-clamp-2 min-h-[32px] mt-0.5">${esc(o.intro)}</p>
        <div class="text-[11px] text-gray-400 mt-2">${o.base_location ? '📍 ' + esc(o.base_location) + ' · ' : ''}${o.followers} 人关注 · ${o.members} 位共建成员 · 已举办 ${o.activity_count} 场</div>
        ${o.next_activity_title ? `<div class="text-[11px] text-gray-500 mt-1 truncate">最近：${esc(o.next_activity_title)} · ${dt(o.next_activity_at)}${o.next_activity_location ? ' · ' + esc(o.next_activity_location) : ''}</div>` : '<div class="text-[11px] text-gray-400 mt-1">暂无公开活动</div>'}
        <div class="flex gap-1.5 mt-3">
          <button class="tab-btn text-xs px-3 py-1.5" onclick="event.stopPropagation();openOrgPreview('${o.id}')">看看</button>
          <button class="cat-secondary text-xs px-3 py-1.5 rounded-lg" onclick="event.stopPropagation();followOrg('${o.id}')">关注</button>
        </div>
      </div>
    </div>`;
  }).join('') || `<div class="cat-card rounded-2xl p-10 text-center text-gray-400 col-span-full">没有找到匹配的社区——换个关键词试试</div>`;
}
function expKw(k) { S._expKw = S._expKw === k ? '' : k; exploreFilter(); }

function renderShell() {
  if (!S.org) return; // 未进入社区时不渲染组织顶栏（个人空间有自己的资料条）
  $('ws-logo').innerHTML = S.org.logo_url
    ? `<img src="${esc(S.org.logo_url)}" class="w-9 h-9 rounded-xl object-cover shadow-sm ring-1 ring-black/5" alt="${esc(S.org.name)}">`
    : `<div class="w-9 h-9 rounded-xl bg-primary text-white font-bold flex items-center justify-center text-sm">${esc(S.org.name[0])}</div>`;
  $('ws-org-name').textContent = S.org.name;
  const myName = S.myNick || S.user.display_name;
  $('ws-user-name').textContent = myName;
  $('ws-avatar').style.background = S.user.avatar_url ? 'transparent' : S.user.avatar_color;
  $('ws-avatar').innerHTML = S.user.avatar_url
    ? '<img src="' + esc(S.user.avatar_url) + '" class="w-full h-full object-cover rounded-full">'
    : esc(myName[0]);
  $('ws-avatar').classList.add('cursor-pointer');
  $('ws-avatar').onclick = toggleUserMenu; // 头像 = 身份菜单（资料/切换/退出）
  const roleNames = { owner: '顶层管理者', internal: '内部成员', participant: '大众参与者' };
  $('ws-role-badge').innerHTML = `<span class="badge" style="background:${S.org.theme_color}18;color:${S.org.theme_color}">${roleNames[S.orgRole] || '未加入'}</span> <span class="text-gray-400 context-copy">· 当前社区</span>${communityDemoAccounts().length ? ' <button type="button" class="underline" onclick="toggleUserMenu()">切换演示视角</button>' : ''}`;
  const visible = navList();
  const pageOf = id => PAGES.find(p => p.id === id);
  const tabHtml = p =>
    `<button class="tab-btn ${S.page === p.id ? 'active' : ''}" draggable="true"
      ondragstart="tabDragStart(event,'${p.id}')" ondragover="event.preventDefault()" ondrop="tabDrop(event,'${p.id}','nav')"
      onclick="go('${p.id}')">${p.icon} ${p.name}</button>`;
  $('nav-desktop').innerHTML = visible.map(id => tabHtml(pageOf(id))).join('');
  const mobile = visible.slice(0, 5);
  /* 底部导航只放页面快捷口；自定义入口在顶栏 ⚙（设置类功能的通用心智位置） */
  $('nav-mobile').innerHTML = mobile.map(id => { const p = pageOf(id); return `
    <button aria-current="${S.page === p.id ? 'page' : 'false'}" class="flex flex-col items-center gap-0.5 px-2 py-1 ${S.page === p.id ? 'c-primary' : 'text-gray-400'}" onclick="go('${p.id}')">
      <span class="text-lg leading-none">${p.icon}</span><span class="text-[10px]">${p.name}</span></button>`; }).join('');
  renderRail();
}

async function refreshPage(silent) {
  if (!S.org || !S.page) return;
  await go(S.page, S.sub, true);
  refreshNotices();
  if (!silent) toast('已刷新');
}

async function go(page, sub = {}, isRefresh = false) {
  if (!S.org) { toast('请先进入一个社区', 'warn'); return; } // 防御：未进入社区时不渲染组织板块
  if (S._brDirty && !(page === 'boss' && sub.tab === 'org')) {
    S._brDirty = false;
    applyBrand(); // 离开品牌页未保存：自动放弃预览
  }
  S.page = page; S.sub = sub;
  renderShell();
  const main = $('ws-main');
  main.innerHTML = `<div class="text-center text-gray-400 py-16">加载中…</div>`;
  try {
    const html = await RENDER[page](sub);
    main.innerHTML = html;
    bindPage(page);
    window.scrollTo(0, 0);
  } catch (e) {
    // 可控失败：任何页面级错误都给出"回个人空间"与"重试"两条出路（个人空间永远存在）
    main.innerHTML = `<div class="text-center py-16"><p class="text-red-500 mb-3">${esc(e.message)}</p>
      <div class="flex gap-2 justify-center flex-wrap">
        <button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="backToOrgs()">返回我的空间</button>
        <button class="tab-btn px-4 py-2" onclick="go(S.page, S.sub, true)">重试</button>
      </div></div>`;
  }
}


/* ==================== 品牌系统：配套色卡 + 自定义 ====================
 * 色卡 = 平台方的审美价值：每一套都是完整搭配（背景/主色/强调），以文艺名字命名。
 * 组织选择色卡或自定义后，品牌包（brand JSON）存入组织记录，进入组织即注入 CSS 变量。 */
const PALETTES = [
  { key: 'jvshong', name: '橘颂', mood: '元气与亲切 · 内容社区、青年社群', bg: '#FAF6EF', primary: '#F97C2F', deep: '#E8620C', light: '#FF9A3D', accent: '#3DBBA8', accent_deep: '#2FA89B' },
  { key: 'jilan', name: '霁蓝', mood: '干净克制 · 职场协作、学习型组织', bg: '#F7F9FC', primary: '#2563EB', deep: '#1E40AF', light: '#60A5FA', accent: '#14B8A6', accent_deep: '#0D9488' },
  { key: 'doukou', name: '豆蔻', mood: '低饱和的温柔 · 亲子与生活社区', bg: '#FBF8F3', primary: '#8FA387', deep: '#5F7459', light: '#B4C4AC', accent: '#C9A88C', accent_deep: '#A98468' },
  { key: 'jiaoyang', name: '骄阳', mood: '醒目有记忆点 · 打卡与创作激励', bg: '#FFF7ED', primary: '#F97316', deep: '#EA580C', light: '#FDBA74', accent: '#F59E0B', accent_deep: '#D97706' },
  { key: 'bohe', name: '薄荷', mood: '清凉治愈 · 健康与习惯养成', bg: '#F0FDFA', primary: '#14B8A6', deep: '#0D9488', light: '#5EEAD4', accent: '#0EA5E9', accent_deep: '#0284C7' },
  { key: 'chuying', name: '初樱', mood: '甜美亲和 · 女性向与育儿社群', bg: '#FFF1F2', primary: '#F472B6', deep: '#DB2777', light: '#F9A8D4', accent: '#FB7185', accent_deep: '#E11D48' },
  { key: 'nuanmu', name: '暖木', mood: '温暖踏实 · 读书会与生活玩家', bg: '#FAF6F0', primary: '#B08968', deep: '#7F5539', light: '#D4B483', accent: '#8A9A5B', accent_deep: '#6B7A3F' },
  { key: 'mushanzi', name: '暮山紫', mood: '烟光凝紫 · 有格调的知识型社区', bg: '#F6F5FF', primary: '#6366F1', deep: '#4F46E5', light: '#A5B4FC', accent: '#A78BFA', accent_deep: '#7C3AED' },
];

/* CSS 标准命名色 148 种（自定义模式 · 精准选色参考表） */
const CSSNAMED = [['aliceblue','#F0F8FF'],['antiquewhite','#FAEBD7'],['aqua','#00FFFF'],['aquamarine','#7FFFD4'],['azure','#F0FFFF'],['beige','#F5F5DC'],['bisque','#FFE4C4'],['black','#000000'],['blanchedalmond','#FFEBCD'],['blue','#0000FF'],['blueviolet','#8A2BE2'],['brown','#A52A2A'],['burlywood','#DEB887'],['cadetblue','#5F9EA0'],['chartreuse','#7FFF00'],['chocolate','#D2691E'],['coral','#FF7F50'],['cornflowerblue','#6495ED'],['cornsilk','#FFF8DC'],['crimson','#DC143C'],['darkblue','#00008B'],['darkcyan','#008B8B'],['darkgoldenrod','#B8860B'],['darkgray','#A9A9A9'],['darkgreen','#006400'],['darkkhaki','#BDB76B'],['darkmagenta','#8B008B'],['darkolivegreen','#556B2F'],['darkorange','#FF8C00'],['darkorchid','#9932CC'],['darkred','#8B0000'],['darksalmon','#E9967A'],['darkseagreen','#8FBC8F'],['darkslateblue','#483D8B'],['darkslategray','#2F4F4F'],['darkturquoise','#00CED1'],['darkviolet','#9400D3'],['deeppink','#FF1493'],['deepskyblue','#00BFFF'],['dimgray','#696969'],['dodgerblue','#1E90FF'],['firebrick','#B22222'],['floralwhite','#FFFAF0'],['forestgreen','#228B22'],['fuchsia','#FF00FF'],['gainsboro','#DCDCDC'],['ghostwhite','#F8F8FF'],['gold','#FFD700'],['goldenrod','#DAA520'],['gray','#808080'],['green','#008000'],['greenyellow','#ADFF2F'],['honeydew','#F0FFF0'],['hotpink','#FF69B4'],['indianred','#CD5C5C'],['indigo','#4B0082'],['ivory','#FFFFF0'],['khaki','#F0E68C'],['lavender','#E6E6FA'],['lavenderblush','#FFF0F5'],['lawngreen','#7CFC00'],['lemonchiffon','#FFFACD'],['lightblue','#ADD8E6'],['lightcoral','#F08080'],['lightcyan','#E0FFFF'],['lightgoldenrodyellow','#FAFAD2'],['lightgray','#D3D3D3'],['lightgreen','#90EE90'],['lightpink','#FFB6C1'],['lightsalmon','#FFA07A'],['lightseagreen','#20B2AA'],['lightskyblue','#87CEFA'],['lightslategray','#778899'],['lightsteelblue','#B0C4DE'],['lightyellow','#FFFFE0'],['lime','#00FF00'],['limegreen','#32CD32'],['linen','#FAF0E6'],['maroon','#800000'],['mediumaquamarine','#66CDAA'],['mediumblue','#0000CD'],['mediumorchid','#BA55D3'],['mediumpurple','#9370DB'],['mediumseagreen','#3CB371'],['mediumslateblue','#7B68EE'],['mediumspringgreen','#00FA9A'],['mediumturquoise','#48D1CC'],['mediumvioletred','#C71585'],['midnightblue','#191970'],['mintcream','#F5FFFA'],['mistyrose','#FFE4E1'],['moccasin','#FFE4B5'],['navajowhite','#FFDEAD'],['navy','#000080'],['oldlace','#FDF5E6'],['olive','#808000'],['olivedrab','#6B8E23'],['orange','#FFA500'],['orangered','#FF4500'],['orchid','#DA70D6'],['palegoldenrod','#EEE8AA'],['palegreen','#98FB98'],['paleturquoise','#AFEEEE'],['palevioletred','#DB7093'],['papayawhip','#FFEFD5'],['peachpuff','#FFDAB9'],['peru','#CD853F'],['pink','#FFC0CB'],['plum','#DDA0DD'],['powderblue','#B0E0E6'],['purple','#800080'],['rebeccapurple','#663399'],['red','#FF0000'],['rosybrown','#BC8F8F'],['royalblue','#4169E1'],['saddlebrown','#8B4513'],['salmon','#FA8072'],['sandybrown','#F4A460'],['seagreen','#2E8B57'],['seashell','#FFF5EE'],['sienna','#A0522D'],['silver','#C0C0C0'],['skyblue','#87CEEB'],['slateblue','#6A5ACD'],['slategray','#708090'],['snow','#FFFAFA'],['springgreen','#00FF7F'],['steelblue','#4682B4'],['tan','#D2B48C'],['teal','#008080'],['thistle','#D8BFD8'],['tomato','#FF6347'],['turquoise','#40E0D0'],['violet','#EE82EE'],['wheat','#F5DEB3'],['white','#FFFFFF'],['whitesmoke','#F5F5F5'],['yellow','#FFFF00'],['yellowgreen','#9ACD32']];

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 };
}
function rgbToHex(r, g, b) {
  const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + c(r) + c(g) + c(b)).toUpperCase();
}
function rgba(hex, a) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
/** p>0 变亮，p<0 变暗（-100~100） */
function shade(hex, p) {
  const { r, g, b } = hexToRgb(hex);
  const t = p < 0 ? 0 : 255, q = Math.abs(p) / 100;
  return rgbToHex(r + (t - r) * q, g + (t - g) * q, b + (t - b) * q);
}
function hueShift(hex, deg) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), L = (max + min) / 2;
  let H = 0, S = 0;
  if (max !== min) {
    const d = max - min;
    S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) H = ((G - B) / d + (G < B ? 6 : 0));
    else if (max === G) H = (B - R) / d + 2;
    else H = (R - G) / d + 4;
    H *= 60;
  }
  H = (H + deg + 360) % 360;
  const C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((H / 60) % 2 - 1)), m = L - C / 2;
  const seg = Math.floor(H / 60) % 6;
  const tab = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]];
  return rgbToHex((tab[seg][0] + m) * 255, (tab[seg][1] + m) * 255, (tab[seg][2] + m) * 255);
}
/** 由单一主色推导一整套品牌变量（自定义模式的自动搭配） */
function deriveBrand(primary) {
  primary = String(primary || '#F97C2F').toUpperCase();
  const accent = hueShift(primary, 150);
  return { key: 'custom', name: '自定义配色', primary, deep: shade(primary, -24), light: shade(primary, 20), accent, accent_deep: shade(accent, -18), bg: shade(primary, 94) };
}

/** 把品牌包写入 CSS 变量（预览与生效共用） */
function applyVars(b) {
  const r = document.documentElement.style;
  r.setProperty('--hm-primary', b.primary);
  r.setProperty('--hm-primary-deep', b.deep);
  r.setProperty('--hm-primary-light', b.light);
  r.setProperty('--hm-accent', b.accent);
  r.setProperty('--hm-accent-deep', b.accent_deep);
  r.setProperty('--hm-cream', b.bg || '#FAF6EF');
  r.setProperty('--hm-primary-soft', rgba(b.primary, .12));
  r.setProperty('--hm-primary-faint', rgba(b.primary, .18));
}
/** 把组织的品牌包注入 CSS 变量（品牌即配置：进入组织即换肤） */
function applyBrand() {
  const o = S.org || {};
  let b = null;
  try { b = o.brand ? JSON.parse(o.brand) : null; } catch { b = null; }
  if (!b || !b.primary) b = deriveBrand(o.theme_color || '#F97C2F');
  S.brand = b;
  applyVars(b);
}
/** 图标位跟随组织：favicon（有 logo 用 logo，无则生成主色首字 SVG）+ 标签页标题 + 系统主题色 */
function applyOrgIcon() {
  const o = S.org; if (!o) return;
  const link = document.getElementById('favicon');
  if (!link) return;
  if (o.logo_url) {
    link.type = o.logo_url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    link.href = o.logo_url;
  } else {
    link.type = 'image/svg+xml';
    const c = o.theme_color || '#F97C2F';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="' + c + '"/><text x="32" y="44" font-size="34" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">' + esc(o.name[0]) + '</text></svg>';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  document.title = o.name + ' · 贡献者工作台';
  const mt = document.getElementById('meta-theme');
  if (mt) mt.content = o.theme_color || '#F97C2F';
  // iOS 添加到主屏幕时取当前图标（安装时固定，故先进入组织再添加）
  const at = document.getElementById('apple-touch');
  if (at) at.href = o.logo_url || link.href;
}

/** 预览一套尚未保存的品牌包（只改变界面，不落数据） */
function previewBrand(b) { S.brand = b; applyVars(b); }

/** 品牌选择器（创建向导与品牌设置共用）：色卡卡片区 + 自定义区 + logo 上传 + 实时预览 */
function brandPickerHtml(pre) {
  const st = S['_' + pre];
  const cards = PALETTES.map(p => `
    <button type="button" class="text-left rounded-xl p-3 border-2 transition ${st.paletteKey === p.key ? 'b-primary-soft bg-primary-soft' : 'border-gray-100 bg-white'}" onclick="bpPick('${pre}','${p.key}')">
      <div class="flex items-center gap-1.5 mb-1.5">
        <span class="w-4 h-4 rounded-full" style="background:${p.primary}"></span>
        <span class="w-4 h-4 rounded-full" style="background:${p.deep}"></span>
        <span class="w-4 h-4 rounded-full" style="background:${p.accent}"></span>
        <span class="w-6 h-4 rounded" style="background:${p.bg};border:1px solid #eee"></span>
      </div>
      <div class="text-sm font-semibold ${st.paletteKey === p.key ? 'c-primary-deep' : 'text-gray-700'}">${p.name}</div>
      <div class="text-[11px] text-gray-400 leading-snug mt-0.5">${p.mood}</div>
    </button>`).join('');
  const rgb = hexToRgb(st.primary);
  const named = CSSNAMED.map(([n, h]) => `<button type="button" title="${n} ${h}" class="w-6 h-6 rounded border border-black/10" style="background:${h}" onclick="bpSet('${pre}','${h}')"></button>`).join('');
  return `
  <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">${cards}</div>
  <details class="rounded-xl border border-gray-200 p-3 mb-4" ${st.paletteKey === 'custom' ? 'open' : ''}>
    <summary class="text-sm text-gray-600 cursor-pointer select-none">自定义配色（进阶）：取色器 / RGB 数值 / 148 种标准命名色</summary>
    <div class="mt-3 space-y-3">
      <div class="flex items-center gap-3 flex-wrap">
        <input type="color" value="${st.primary}" oninput="bpSet('${pre}', this.value)" class="!w-14 !h-10 !p-1">
        <div class="flex items-center gap-1 text-xs text-gray-500">R<input id="${pre}-r" type="number" min="0" max="255" value="${rgb.r}" class="!w-16 text-center" oninput="bpRGB('${pre}')">G<input id="${pre}-g" type="number" min="0" max="255" value="${rgb.g}" class="!w-16 text-center" oninput="bpRGB('${pre}')">B<input id="${pre}-b" type="number" min="0" max="255" value="${rgb.b}" class="!w-16 text-center" oninput="bpRGB('${pre}')"></div>
        <code class="text-xs text-gray-400">${st.primary}</code>
      </div>
      <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 bg-gray-50 rounded-lg">${named}</div>
    </div>
  </details>
  <div class="flex items-center gap-3 flex-wrap">
    <div class="flex items-center gap-2">
      <div class="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center">
        ${st.logo ? `<img src="${st.logo}" class="w-full h-full object-cover">` : `<span class="text-gray-300 text-xs">无</span>`}
      </div>
      <label class="tab-btn cursor-pointer">上传 logo<input type="file" accept="image/*" class="hidden" onchange="bpLogo('${pre}', this)"></label>
      ${st.logo ? `<button type="button" class="text-xs text-gray-400 underline" onclick="bpLogoClear('${pre}')">移除</button>` : ''}
    </div>
    <div class="ml-auto flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
      <span class="avatar w-8 h-8 text-xs" style="background:${st.primary}">${esc((st.pname || '组').slice(0, 1))}</span>
      <span class="text-sm font-medium" style="color:${st.primary}">${esc(st.pname || '你的组织')} · ${st.currency || '积分'}</span>
      <span class="px-2 py-1 rounded-lg text-xs text-white" style="background:linear-gradient(135deg,${st.primary},${st.deep})">主按钮</span>
      <span class="px-2 py-1 rounded-lg text-xs text-white" style="background:linear-gradient(135deg,${st.accent},${st.accent_deep})">次按钮</span>
    </div>
  </div>`;
}
function bpState(pre) { return S['_' + pre]; }
function bpPick(pre, key) {
  const p = PALETTES.find(x => x.key === key);
  const st = bpState(pre);
  st.paletteKey = key; st.primary = p.primary; st.brandName = p.name;
  bpRefresh(pre);
}
function bpSet(pre, hex) {
  const st = bpState(pre);
  st.paletteKey = 'custom'; st.primary = String(hex).toUpperCase(); st.brandName = '自定义配色';
  bpRefresh(pre);
}
function bpRGB(pre) {
  const r = Math.max(0, Math.min(255, Number($(pre + '-r')?.value) || 0));
  const g = Math.max(0, Math.min(255, Number($(pre + '-g')?.value) || 0));
  const b = Math.max(0, Math.min(255, Number($(pre + '-b')?.value) || 0));
  bpSet(pre, rgbToHex(r, g, b));
}
function bpLogo(pre, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('请选择图片文件', 'err');
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
    bpState(pre).logo = c.toDataURL('image/jpeg', .85);
    bpRefresh(pre);
    toast('logo 已就绪（自动压缩至 256×256）');
  };
  img.onerror = () => toast('图片读取失败', 'err');
  img.src = URL.createObjectURL(file);
}
function bpLogoClear(pre) { bpState(pre).logo = null; bpRefresh(pre); }
/** 重绘品牌选择器所在区域 */
function bpRefresh(pre) {
  const b = bpExport(pre);
  previewBrand(b); // 点选即整界面预览
  if (pre === 'br') S._brDirty = true;
  if (pre === 'wiz') { S._wizStep = 2; openOrgWizard(); }
  else bossBrandRefresh();
}
/** 从选择器状态导出 brand 对象 */
function bpExport(pre) {
  const st = bpState(pre);
  const base = st.paletteKey === 'custom' ? deriveBrand(st.primary) : PALETTES.find(p => p.key === st.paletteKey);
  return { key: base.key, name: base.name, primary: base.primary, deep: base.deep, light: base.light, accent: base.accent, accent_deep: base.accent_deep, bg: base.bg || deriveBrand(base.primary).bg };
}

/* ================= 页面渲染器 ================= */
const RENDER = {};

/* ---------- 活动（大众首页）：最近活动横卡 + 接下来小方格 + 日历 + 往期 ---------- */
const MODE_TXT = { qr: '扫码签到', geo: '地缘打卡' };
const RULE_TXT = { none: '无签到要求', checkin: '到场签到', checkin_checkout: '到场+退场', checkout_only: '仅退场打卡' };

/** 活动的签到方式说明文字 */
function modeDesc(a) {
  if (a.checkin_rule === 'none') return '本活动无签到要求';
  const geo = a.checkin_mode === 'geo' && a.geo_lat != null ? ` · 半径${a.geo_radius}米` : '';
  return `${MODE_TXT[a.checkin_mode] || '扫码签到'} · ${RULE_TXT[a.checkin_rule]}${geo}`;
}

/** 参与者视角的行动按钮（按活动的签到方式渲染） */
function actCTA(a, size = 'sm') {  const nowMs = Date.now();
  const startMs = new Date(a.start_at).getTime();
  const endMs = a.end_at ? new Date(a.end_at).getTime() : startMs + 6 * 3600e3;
  const cls = size === 'lg' ? 'px-4 py-2 rounded-xl text-sm' : 'px-3 py-1.5 rounded-lg text-xs';
  if (a.status !== 'published') {
    return a.status === 'finished'
      ? `<span class="text-xs text-gray-400">已归档${a.finish_note ? ' · ' + esc(a.finish_note) : ''}</span>` : '';
  }
  if (startMs > nowMs) {
    if (S.orgRole === 'owner') return `<span class="text-[11px] text-gray-400">👑 组织者身份 · 无需报名</span>`;
    return a.my_registered
      ? `<button class="cat-btn ${cls}" onclick="act('${a.id}','register')">已报名 ✓</button>
         <button class="text-xs text-gray-400 underline mt-1" onclick="act('${a.id}','cancel')">取消报名</button>`
      : `<button class="cat-btn ${cls}" onclick="act('${a.id}','register')">报名</button>`;
  }
  // 进行中 / 已开始：按方式签到
  const my = a.my_checkin;
  const needIn = ['checkin', 'checkin_checkout'].includes(a.checkin_rule) && (!my || !my.checkin_at);
  const needOut = (a.checkin_rule === 'checkout_only' || (a.checkin_rule === 'checkin_checkout' && my && my.checkin_at)) && !my?.checkout_at;
  let html = '';
  const isGeo = a.checkin_mode === 'geo';
  if (needIn) {
    html += isGeo
      ? `<button class="cat-btn ${cls}" onclick="geoCheck('${a.id}','checkin')">📍 地缘打卡签到</button>`
      : `<button class="cat-btn ${cls}" onclick="qrCheckModal('${a.id}','checkin')">扫码签到</button>`;
  }
  if (needOut) {
    html += isGeo
      ? `<button class="cat-btn ${cls}" onclick="geoCheck('${a.id}','checkout')">📍 地缘打卡签退</button>`
      : `<button class="cat-btn ${cls}" onclick="qrCheckModal('${a.id}','checkout')">扫码签退</button>`;
  }
  if (!needIn && !needOut) {
    html = my && (my.checkin_at || my.checkout_at)
      ? `<span class="text-xs text-green-600 font-medium">✓ 已完成${a.checkin_rule === 'checkout_only' ? '退场' : my.checkout_at ? '到场+退场' : '到场'}打卡</span>`
      : `<span class="text-xs text-gray-400">本活动无签到要求</span>`;
  }
  return html;
}

/** 产出登记入口（参与者）：开启登记的活动卡片上出现——录了就显示状态，没录就给通道 */
function outputEntryHtml(a) {
  if (!a.output_reg) return '';
  if (a.my_output) {
    return a.my_output.status === 'confirmed'
      ? '<span class="badge bg-green-100 text-green-700">成果已确认</span>'
      : '<span class="badge bg-yellow-100 text-yellow-700">成果待确认</span>';
  }
  if (!(a.my_checkin && (a.my_checkin.checkin_at || (a.checkin_rule === 'checkout_only' && a.my_checkin.checkout_at))) && !a.my_registered) return '';
  return `<button class="cat-secondary text-xs px-3 py-1.5 rounded-lg" onclick="outputModal('${a.id}')">📷 登记成果</button>`;
}

RENDER.home = async () => {
  const [actData, taskData] = await Promise.all([
    api('GET', `/api/orgs/${S.org.id}/activities`),
    api('GET', `/api/orgs/${S.org.id}/tasks`).catch(() => ({ tasks: [] })),
  ]);
  const { activities } = actData;
  S.data.homeTasks = (taskData.tasks || []).filter(t => t.status === 'published');
  S.data.homeActs = activities;
  const CURRENCY = S.org.currency_name;
  const GRACE = 3 * 3600e3; // 开始3小时内仍视为"当前"
  const live = activities
    .filter(a => a.status === 'published' && new Date(a.end_at || a.start_at).getTime() >= Date.now() - GRACE)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = activities
    .filter(a => !live.includes(a))
    .sort((a, b) => b.start_at.localeCompare(a.start_at));

  /* VIP · 评价卡弹出时机（设计定案）：① 签退完成即弹 ② 仅签到的活动按设定结束时间到期弹出（计时器）；
     都是可控打扰：星级/文字/照片全可选，叉掉可从「已参与」找回 */
  const needFb = activities.filter(a =>
    (a.status === 'finished' || new Date(a.end_at || a.start_at).getTime() < Date.now())
    && a.my_checkin && (a.my_checkin.checkin_at || (a.checkin_rule === 'checkout_only' && a.my_checkin.checkout_at))
    && (!a.my_feedback || (!a.my_feedback.stars && !a.my_feedback.text && !a.my_feedback.dismissed_at)));
  scheduleFbTimers(activities); // ② 仅签到的活动：按设定结束时间排程到期弹出（计时器）
  const needFbHtml = needFb.length ? `<div class="cat-card rounded-2xl p-4 mb-5 flex items-center justify-between gap-3" style="border-left:4px solid var(--hm-accent)">
    <div class="min-w-0"><div class="text-sm font-medium text-gray-800">${needFb.length > 1 ? `有 ${needFb.length} 场活动` : '为「' + esc(needFb[0].title) + '」'}留个星级吧</div>
      <div class="text-[11px] text-gray-400 mt-0.5">可选 · 你的反馈也是个人画像的素材；跳过随时可在「已参与」找回</div></div>
    <div class="flex gap-2 flex-shrink-0"><button class="cat-btn text-xs px-3 py-1.5 rounded-lg" onclick="feedbackModal('${needFb[0].id}', { auto: 1 })">去评价</button>
      <button class="text-xs text-gray-400 underline" onclick="dismissFeedback('${needFb[0].id}')">跳过</button></div>
  </div>` : '';
  const hero = live[0];
  const smalls = live.slice(1, 5);

  /* 最近活动：横向长卡片（邀请卡） */
  let heroHtml = '';
  if (hero) {
    const d = new Date(hero.start_at);
    const week = '日一二三四五六'[d.getDay()];
    const special = hero.special_flag ? `<span class="badge" style="background:${hero.color_tag || '#7C3AED'}22;color:${hero.color_tag || '#7C3AED'}">⭐ 特大型</span>` : '';
    heroHtml = `<div class="hero-act rounded-2xl p-5 md:p-6 mb-5 shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center gap-4">
        <div class="text-center md:text-left md:w-28 flex-shrink-0">
          <div class="text-3xl font-bold" style="color:var(--hm-primary-deep)">${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}</div>
          <div class="text-xs text-gray-500 mt-0.5">周${week} · ${dt(hero.start_at).slice(-5)}</div>
          <span class="badge bg-white/70 c-primary mt-1">最近的一场</span>
        </div>
        <div class="flex-1 min-w-0 md:border-l md:b-primary-soft md:pl-5">
          <div class="flex items-center gap-2 flex-wrap mb-1">${special}
            <span class="badge bg-green-100 text-green-700">邀请你参加</span>
            <span class="text-[11px] text-gray-400">${modeDesc(hero)}</span></div>
          <h3 class="font-bold text-gray-800 text-lg leading-snug">${esc(hero.title)}</h3>
          <p class="text-sm text-gray-500 mt-0.5 line-clamp-2">${esc(hero.description)}</p>
          <div class="text-xs text-gray-500 mt-2">🕒 ${dt(hero.start_at)} · 📍 ${esc(hero.location || '线上')} · 报名 ${hero.reg_count}${hero.capacity ? '/' + hero.capacity : ''} 人</div>
          <div class="text-xs text-gray-400">有效参与得 ${hero.points_on_complete} ${CURRENCY}</div>
        </div>
        <div class="flex md:flex-col gap-2 items-center md:items-end flex-shrink-0">${actCTA(hero, 'lg')}${outputEntryHtml(hero)}</div>
      </div></div>`;
  }

  /* 接下来的活动：小方格横排 */
  const smallHtml = smalls.length ? `<h3 class="text-sm font-semibold text-gray-500 mb-2">接下来的几场</h3>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">${smalls.map(a => {
      const d = new Date(a.start_at);
      return `<div class="cat-card rounded-xl p-3.5">
        <div class="text-xs font-bold mb-0.5" style="color:var(--hm-primary-deep)">${d.getMonth() + 1}/${d.getDate()} ${dt(a.start_at).slice(-5)}</div>
        <div class="text-sm font-medium text-gray-800 line-clamp-2 min-h-[40px]">${a.special_flag ? '⭐ ' : ''}${esc(a.title)}</div>
        <div class="text-[10px] text-gray-400 mt-1">${modeDesc(a)}</div>
        <div class="mt-2 flex flex-wrap gap-1.5">${actCTA(a)}${outputEntryHtml(a)}</div>
      </div>`;
    }).join('')}</div>` : '';

  /* 日历：一眼看到哪天有什么 */
  const today = new Date();
  const calY = S.cal?.y ?? today.getFullYear();
  const calM = S.cal?.m ?? today.getMonth();
  S.cal = { y: calY, m: calM };
  const firstDow = new Date(calY, calM, 1).getDay();
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const byDay = {};
  activities.forEach(a => {
    const d = new Date(a.start_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (byDay[key] = byDay[key] || []).push(a);
  });
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const list = byDay[`${calY}-${calM}-${d}`] || [];
    const isToday = d === today.getDate() && calM === today.getMonth() && calY === today.getFullYear();
    const sel = S.calDate && S.calDate.y === calY && S.calDate.m === calM && S.calDate.d === d;
    cells += `<button onclick="calPick(${d})" class="cal-day relative rounded-lg py-1.5 text-sm ${sel ? 'bg-primary-soft0 text-white font-bold' : isToday ? 'bg-primary-soft c-primary-deep font-bold' : list.length ? 'bg-white hover:bg-primary-soft text-gray-700' : 'text-gray-300'}">
      ${d}
      ${list.length ? `<span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">${list.slice(0, 3).map(a => `<span class="w-1.5 h-1.5 rounded-full" style="background:${a.special_flag ? (a.color_tag || '#7C3AED') : 'var(--hm-primary)'}"></span>`).join('')}</span>` : ''}
    </button>`;
  }
  const picked = S.calDate && S.calDate.y === calY && S.calDate.m === calM
    ? byDay[`${calY}-${calM}-${S.calDate.d}`] || [] : null;
  const calHtml = `<div class="cat-card rounded-2xl p-5 mb-6">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-gray-700">${calY} 年 ${calM + 1} 月 · 活动日历</h3>
      <div class="flex gap-1.5">
        <button class="tab-btn" onclick="calNav(-1)">‹ 上月</button>
        <button class="tab-btn" onclick="calNav(0)">本月</button>
        <button class="tab-btn" onclick="calNav(1)">下月 ›</button>
      </div>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-400 mb-1">${'日一二三四五六'.split('').map(x => `<div>${x}</div>`).join('')}</div>
    <div class="grid grid-cols-7 gap-1">${cells}</div>
    ${picked ? `<div class="mt-4 pt-4 border-t b-primary-soft">
      <div class="text-xs text-gray-500 mb-2">${calM + 1} 月 ${S.calDate.d} 日 · ${picked.length} 场活动</div>
      <div class="space-y-2">${picked.map(a => `
        <div class="flex items-center justify-between bg-primary-soft rounded-xl px-3 py-2.5">
          <div class="min-w-0"><div class="text-sm font-medium text-gray-800 truncate">${a.special_flag ? '⭐ ' : ''}${esc(a.title)}</div>
          <div class="text-[11px] text-gray-400">${dt(a.start_at)} · ${esc(a.location || '线上')}</div></div>
          <div class="flex gap-1.5 flex-wrap justify-end flex-shrink-0 ml-2">${actCTA(a)}</div>
        </div>`).join('')}</div>
    </div>` : '<div class="text-[11px] text-gray-400 mt-3">点击日期查看当天活动 · 圆点代表有活动（紫色=特大型）</div>'}
  </div>`;

  /* 往期活动 */
  const pastHtml = past.length ? `<h3 class="text-sm font-semibold text-gray-500 mb-2">往期活动</h3>
    <div class="space-y-2">${past.map(a => `
      <div class="cat-card rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0"><span class="text-sm text-gray-600">${a.special_flag ? '⭐ ' : ''}${esc(a.title)}</span>
          <span class="text-[11px] text-gray-400 ml-2">${dOnly(a.start_at)} · 到场 ${a.checkin_count}</span></div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          ${a.status === 'finished' ? '<span class="badge bg-gray-100 text-gray-500">已归档</span>' : '<span class="badge bg-blue-50 text-blue-500">进行中</span>'}
          ${outputEntryHtml(a)}
        </div>
      </div>`).join('')}</div>` : '';

  return `<div class="work-heading"><h2>一起，把事情做成</h2><p>${esc(S.org.name)} · 在这里认领任务、参与活动，留下你的贡献。</p></div>
  <div class="work-shortcuts">
    <button onclick="go('tasks')"><b>认领任务 ↗</b><span>找到能出力的事</span></button>
    <button onclick="go('tasks',{state:'mine'})"><b>我认领的</b><span>继续完成与交付</span></button>
    <button onclick="go('mine')"><b>贡献与收益</b><span>查看记录与明细</span></button>
  </div>
  ${(() => {
    const avail = (S.data.homeTasks || []).filter(t => t.status === 'published').slice(0, 3);
    if (!avail.length) return '';
    return `<div class="cat-card rounded-2xl p-4 mb-5">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-bold text-gray-700">⚡ 今日可做</h3>
        <button class="text-xs underline" style="color:var(--hm-primary)" onclick="go('tasks')">全部任务 ›</button>
      </div>
      <div class="space-y-2">${avail.map(t => `
        <div class="flex items-center justify-between px-3 py-2.5 bg-gray-50/80 rounded-xl">
          <div class="min-w-0"><span class="text-sm font-medium text-gray-700 truncate block">${esc(t.name)}</span>
            <span class="text-[10px] text-gray-400">${t.points_min === t.points_max ? '+' + t.points_min : '+' + t.points_min + '~' + t.points_max} ${S.org.currency_name}</span></div>
          <button class="text-xs px-3 py-1.5 rounded-lg flex-shrink-0 font-medium" style="background:var(--hm-primary-soft);color:var(--hm-primary-deep)" onclick="go('tasks')">去做</button>
        </div>`).join('')}</div>
    </div>`;
  })()}
  ${needFbHtml}
  ${heroHtml || `<div class="cat-card rounded-2xl p-8 text-center text-gray-400 mb-5">暂无即将开始的活动<br><button class="cat-btn px-4 py-2 rounded-xl text-sm mt-3" onclick="go('tasks')">先去任务广场看看</button></div>`}
  ${smallHtml}
  ${calHtml}
  ${pastHtml}`;
};

/** 日历导航：-1 上月 / 0 本月 / 1 下月 */
function calNav(dir) {
  if (dir === 0) { const t = new Date(); S.cal = { y: t.getFullYear(), m: t.getMonth() }; }
  else { let { y, m } = S.cal; m += dir; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.cal = { y, m }; }
  S.calDate = null;
  go('home');
}
function calPick(d) {
  S.calDate = { y: S.cal.y, m: S.cal.m, d };
  go('home');
}

/** 地缘打卡：浏览器定位 → 服务端距离核验 */
function geoCheck(id, kind) {
  if (!navigator.geolocation) return toast('当前浏览器不支持定位，请用扫码方式', 'err');
  toast('正在获取定位…', 'warn');
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const r = await api('POST', `/api/activities/${id}/qcheckin`, { kind, lat: pos.coords.latitude, lng: pos.coords.longitude });
      toast(r.already ? '你已经打过卡了' : (kind === 'checkin' ? '地缘打卡成功 ✓' : '地缘签退成功 ✓'));
      go('home');
      if (kind === 'checkout' && !r.already) openFeedbackAuto(id); // ① 签退完成即弹评价卡
    } catch (e) { toast(e.message, 'err'); }
  }, err => toast('定位失败：' + err.message + '（可改用扫码签到）', 'err'), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
}

/** 扫码签到（演示走法）：输入现场屏幕上的 6 位核验码 */
function qrCheckModal(id, kind) {
  openModal(`<h3 class="font-bold text-gray-800 mb-1">${kind === 'checkin' ? '到场扫码' : '退场扫码'}</h3>
  <p class="text-xs text-gray-400 mb-4">用手机相机扫描活动现场的二维码即可自动完成；在电脑上演示时，可输入团队成员屏幕上展示的现场核验码。</p>
  <input id="qc-code" maxlength="6" placeholder="现场核验码（6位）" class="text-center text-2xl tracking-[0.5em] font-bold" style="letter-spacing:0.4em">
  <button class="cat-btn w-full py-2.5 rounded-xl mt-4" onclick="doQCheck('${id}','${kind}')">确认${kind === 'checkin' ? '签到' : '签退'}</button>`);
  setTimeout(() => $('qc-code')?.focus(), 100);
}
async function doQCheck(id, kind) {
  try {
    const r = await api('POST', `/api/activities/${id}/qcheckin`, { kind, code: $('qc-code').value });
    closeModal();
    toast(r.already ? '你已经打过卡了' : (kind === 'checkin' ? '扫码签到成功 ✓' : '扫码签退成功 ✓'));
    go('home');
    if (kind === 'checkout' && !r.already) openFeedbackAuto(id); // ① 签退完成即弹评价卡
  } catch (e) { toast(e.message, 'err'); }
}
/** 评价卡自动弹出（去重：一次会话同一活动只弹一次） */
function openFeedbackAuto(actId) {
  try {
    const key = 'fbauto_' + actId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* 隐私模式下忽略去重 */ }
  setTimeout(() => { if (S.org) feedbackModal(actId, { auto: 1 }); }, 900);
}

async function act(id, action) {
  try {
    const map = { register: '报名成功', cancel: '已取消报名', checkin: '签到成功', checkout: '签退成功' };
    await api('POST', `/api/activities/${id}/${action === 'cancel' ? 'cancel-registration' : action}`);
    toast(map[action]);
    await go('home');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 任务广场 ---------- */
RENDER.tasks = async () => {
  const [{ tasks }, { submissions }] = await Promise.all([
    api('GET', `/api/orgs/${S.org.id}/tasks`),
    api('GET', `/api/orgs/${S.org.id}/submissions`),
  ]);
  const cats = [...new Set(tasks.map(t => t.category_code))];
  S.data.tasks = tasks;
  const filter = S.sub.cat || 'all';
  const state = S.sub.state || 'available';
  const list = tasks.filter(t => (filter === 'all' || t.category_code === filter) && (state === 'mine' ? t.my_claimed > 0 : !t.my_claimed && (!t.slots || t.claimed_count < t.slots)));
  const catName = { media: '媒体类', ops: '运营类', project: '项目类', resource: '资源类' };
  const chips = ['all', ...cats].map(c =>
    `<button class="tab-btn ${filter === c ? 'active' : ''}" onclick="go('tasks',{cat:'${c}',state:'${state}'})">${c === 'all' ? '全部' : esc(tasks.find(t => t.category_code === c).category_name)}</button>`).join('');
  const cards = list.map(t => {
    const range = t.points_min === t.points_max ? `${t.points_min} ${S.org.currency_name}/${t.unit}` : `${t.points_min} - ${t.points_max} ${S.org.currency_name}/${t.unit}`;
    const limited = t.slots > 0;
    const remaining = limited ? Math.max(0, t.slots - t.claimed_count) : null;
    const mine = t.my_claimed > 0;
    let action = '';
    if (mine) action = `<span class="badge bg-green-100 text-green-700 mb-1">✓ 已领取</span>
        <button class="cat-btn px-4 py-2 rounded-xl text-sm w-full" onclick="submitModal('${t.id}')">提交成果</button>`;
    else if (limited && remaining <= 0) action = `<span class="badge bg-gray-100 text-gray-500">已领完</span>`;
    else action = `<button class="cat-btn px-4 py-2 rounded-xl text-sm w-full" onclick="claimPlazaTask('${t.id}')">认领任务</button>
        <button class="text-xs text-gray-400 underline mt-1" onclick="claimThenSubmit('${t.id}')">领取并提交</button>`;
    const slotTxt = limited ? `<div class="text-xs mt-1 ${remaining <= 0 ? 'text-red-400' : 'text-gray-400'}">名额：限 ${t.slots} 次 · 已领 ${t.claimed_count} · 剩余 ${remaining}${remaining <= 0 ? '（名额已满，认领者仍可提交）' : ''}</div>` : '';
    return `<div class="cat-card task-card rounded-2xl p-5${limited && remaining <= 0 && !mine ? ' opacity-60' : ''}">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <span class="badge" style="background:${t.category_color}22;color:${t.category_color}">${esc(t.category_name)}</span>
            <span class="text-[11px] text-gray-400">${({ todo: '打卡', project: '项目制', deliverable: '成果交付', duration: '时长类' }[t.form])}</span>
            ${mine ? '<span class="badge bg-green-100 text-green-700">我负责的</span>' : ''}
          </div>
          <h3 class="font-semibold text-gray-800">${esc(t.name)}</h3>
          <p class="text-sm text-gray-500 mt-0.5">${esc(t.description)}</p><p class="text-xs text-gray-600 mt-2">${esc(audienceName(t.audience))} · 验收：${esc(t.acceptance || '请联系发布方确认')}</p><p class="text-xs text-gray-600 mt-1">回报：${esc(t.reward_terms || '历史任务尚未补充兑现规则')}</p>
          <div class="text-sm mt-2"><span class="c-primary font-semibold">${range}</span>
            <span class="text-xs text-gray-400 ml-2">${esc(t.frequency_note)}</span></div>
          <div class="text-xs text-gray-400 mt-1">${limited ? `限 ${t.slots} 次任务 · ` : ''}已被确认完成 ${t.approved_count} 次</div>
          ${slotTxt}
        </div>
        <div class="task-actions">${action}</div>
      </div></div>`;
  }).join('');
  const mine = submissions.filter(s => ['pending', 'approved', 'rejected'].includes(s.status)).slice(0, 10);
  return `<div class="work-heading"><h2>共建任务</h2><p>先认领，再协作。完成后提交成果，由社区确认贡献。</p></div>
  <div class="task-state-tabs" aria-label="任务状态">
    <button aria-pressed="${state === 'available'}" onclick="go('tasks',{state:'available'})">可认领</button>
    <button aria-pressed="${state === 'mine'}" onclick="go('tasks',{state:'mine'})">我认领的 · ${tasks.filter(t => t.my_claimed > 0).length}</button>
  </div>
  <div class="flex gap-2 mb-4 overflow-x-auto pb-1">${chips}</div>
  <div class="space-y-3">${cards || `<div class="cat-card rounded-2xl p-8 text-center text-sm text-gray-500">${state === 'mine' ? '还没有认领任务。选一件你擅长的事，从这里开始。' : '这个分类暂时没有可认领任务，试试其他分类。'}</div>`}</div>
  <h3 class="text-sm font-semibold text-gray-500 mt-8 mb-3">我的提交记录</h3>
  <div class="space-y-2">${mine.map(s => `
    <div class="cat-card rounded-xl p-3 flex items-center justify-between text-sm">
      <div><span class="font-medium">${esc(s.title)}</span>
        <span class="text-xs text-gray-400 ml-2">${dt(s.created_at)}</span></div>
      ${s.status === 'approved' ? `<span class="c-primary font-bold">+${s.points_awarded} ${S.org.currency_name}</span>`
        : s.status === 'pending' ? '<span class="badge bg-yellow-100 text-yellow-700">待审核</span>'
        : s.status === 'rejected' ? '<span class="badge bg-red-100 text-red-600">未通过</span>' : '<span class="badge bg-gray-100 text-gray-500">已冲正</span>'}
    </div>`).join('') || '<p class="text-xs text-gray-400">还没有提交过成果</p>'}</div>`;
};

async function claimPlazaTask(id) {
  try { const r = await api('POST', `/api/tasks/${id}/claim`); toast(r.already ? '你已领取过该任务' : '领取成功，完成后记得提交成果'); await go('tasks', {state:'mine'}); }
  catch (e) { toast(e.message, 'err'); }
}
async function claimThenSubmit(id) {
  try { await api('POST', `/api/tasks/${id}/claim`); } catch (e) { /* 已领取则直接打开提交 */ }
  submitModal(id);
}
function submitModal(taskId) {
  const t = S.data.tasks.find(x => x.id === taskId);
  if (!t) return;
  const token = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  openModal(`<h3 class="font-bold text-gray-800 mb-1">提交成果</h3>
  <p class="text-xs text-gray-400 mb-4">${esc(t.name)} · ${t.points_min}-${t.points_max} ${S.org.currency_name}（审核时确定具体分值）</p>
  <div class="space-y-3">
    <div><label class="text-xs text-gray-500">成果标题</label><input id="sm-title" value="${esc(t.name)}"></div>
    <div><label class="text-xs text-gray-500">成果说明 / 链接（证据）</label><textarea id="sm-evidence" rows="4" placeholder="链接、数据、简要说明——审核者将依据此内容确认"></textarea></div>
    <button class="cat-btn w-full py-2 rounded-xl" onclick="doSubmit('${taskId}','${token}')">提交（进入待审核）</button>
    <p class="text-[11px] text-gray-400 text-center">提交后会由内部成员审核；审核通过才会计入积分（事后确认原则）</p>
  </div>`);
}
async function doSubmit(taskId, token) {
  try {
    await api('POST', `/api/orgs/${S.org.id}/submissions`, {
      task_id: taskId, title: $('sm-title').value.trim(), evidence: $('sm-evidence').value.trim(), client_token: token,
    });
    closeModal(); toast('已提交，等待审核');
    await go('tasks');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 我的资产（数字资产随身携带） ---------- */
RENDER.mine = async () => {
  const d = await api('GET', `/api/users/${S.user.id}/assets?org_id=${S.org.id}`);
  S.data.mine = d;
  const v = d.org_view;
  const pf = d.portfolio;
  if (!v) return `<div class="flex items-center justify-between gap-2 flex-wrap mb-4">
      <h2 class="text-lg font-bold text-gray-800">我的资产</h2>
      <button class="text-xs underline" style="color:var(--hm-primary)" onclick="backToOrgs()">个人空间 · 跨组织的你 ›</button>
    </div>
    <div class="cat-card rounded-2xl p-8 text-center text-gray-400">还未在 ${esc(S.org.name)} 产生记录<br><br>
    <button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="go('tasks')">去任务广场看看</button></div>`;
  const maxCat = Math.max(...v.by_category.map(c => c.points), 1);
  /* 视觉区：把自我介绍（昵称+等级徽记+积分）升级为"身份卡"质感 */
  const perkHtml = (v.level.perk || '').split(/[,，、\s]+/).filter(Boolean).map(p =>
    `<span class="id-chip">✦ ${esc(p)}</span>`).join(' ');
  const idCard = `
  <div class="id-card p-5 text-center md:col-span-1" style="min-height:230px">
    <div class="id-ring"></div>
    <div class="relative z-10 flex flex-col items-center">
      <span class="id-medallion mb-2">${esc(S.org.name[0])}</span>
      <div class="avatar w-16 h-16 text-xl mx-auto mb-2 ring-2 ring-white/70 shadow-md" style="background:${S.user.avatar_color}">${esc(S.user.display_name[0])}</div>
      <div class="font-bold text-gray-800 text-[15px]">${esc(S.user.display_name)}</div>
      <div class="flex items-center justify-center gap-2 mt-1.5">
        <span class="id-badge"><b>${esc(v.level.level)}</b><span>LV</span></span>
      </div>
      <div class="flex items-center gap-2 mt-2">
        <span class="id-strip">${S.org.currency_name} ${fmt(v.total_points)}</span>
      </div>
      <div class="id-no text-[11px] mt-2.5" style="color:#a07640">NO.${esc(String(S.user.id).slice(0,8))} · 入籍 ${dOnly(S.user.created_at)}</div>
      <div class="w-full mt-3">
        ${v.level.next_level
          ? `<div class="flex justify-between text-[10px] mb-1" style="color:#93672c"><span>距 ${esc(v.level.next_level)}</span><span>还需 ${fmt(v.level.points_to_next)}</span></div>
             <div class="id-progress"><i style="width:${v.level.progress}%"></i></div>`
          : '<div class="text-[11px] text-center mt-2" style="color:#93672c">已在最高一级 🎉</div>'}
      </div>
      ${perkHtml ? `<div class="flex flex-wrap justify-center gap-1.5 mt-3">${perkHtml}</div>` : ''}
      <span class="id-floor">喵</span>
    </div>
  </div>`;
  /* 双层资产的第一层桥梁：组织内视角页顶部就有去个人空间的显式入口 */
  return `<div class="flex items-center justify-between gap-2 flex-wrap mb-4">
    <h2 class="text-lg font-bold text-gray-800">我的资产 · ${esc(S.org.name)}</h2>
    <button class="text-xs underline" style="color:var(--hm-primary)" onclick="backToOrgs()">个人空间 · 跨组织的你 ›</button>
  </div>
  <div class="grid md:grid-cols-3 gap-4 mb-5">
    ${idCard}
    <div class="cat-card rounded-2xl p-5 md:col-span-2">
      <h3 class="font-semibold text-gray-800 text-sm mb-3">积分构成</h3>
      <div class="space-y-3">${v.by_category.map(c => `
        <div><div class="flex justify-between text-xs mb-1"><span style="color:${c.color}">${esc(c.name)} · ${c.count} 次</span><span class="font-semibold" style="color:${c.color}">${fmt(c.points)}</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(c.points / maxCat * 100)}%;background:${c.color}"></div></div></div>`).join('')}</div>
    </div>
  </div>
  ${(() => {
    const ledgerTable = `<div class="overflow-x-auto"><table class="tbl">
      <thead><tr><th>时间</th><th>事由</th><th>类型</th><th style="text-align:right">变动</th><th style="text-align:right">余额</th></tr></thead>
      <tbody>${v.ledger.map(l => `<tr>
        <td class="text-gray-400 whitespace-nowrap">${dt(l.created_at)}</td><td>${esc(l.note)}</td>
        <td>${{ award: '<span class="badge bg-green-100 text-green-700">获得</span>', revoke: '<span class="badge bg-red-100 text-red-600">冲正</span>', adjust: '<span class="badge bg-blue-100 text-blue-700">调整</span>' }[l.type]}</td>
        <td style="text-align:right" class="font-bold ${l.delta > 0 ? 'c-primary' : 'text-red-500'}">${l.delta > 0 ? '+' : ''}${fmt(l.delta)}</td>
        <td style="text-align:right" class="text-gray-500">${fmt(l.balance_after)}</td></tr>`).join('')}</tbody>
    </table></div>`;
    /* 手机信息熵：流水明细收进抽屉，主线只留积分构成 */
    return mCollapse(`积分流水 · 最近 ${v.ledger.length} 条<span class="cnt">只追加 · 不可篡改</span>`,
      `<div class="cat-card rounded-2xl p-5" style="margin:0"><h3 class="font-semibold text-gray-800 text-sm mb-3">积分流水（只追加 · 不可篡改 · 可追溯）</h3>${ledgerTable}</div>`);
  })()}
  <div class="cat-card rounded-2xl p-5 mb-5">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-gray-800 text-sm">成长履历</h3>
      <button class="text-xs underline" style="color:var(--hm-primary)" onclick="copyGrowthText()">复制分享文本</button>
    </div>
    <div class="tl">
      <div class="tl-node tl-milestone">
        <div class="tl-title">加入 ${esc(S.org.name)}</div>
        <div class="tl-sub">获得永久编号，开始积累${S.org.currency_name}</div>
      </div>
      ${v.by_category.filter(c => c.count > 0).map(c => `
        <div class="tl-node">
          <span class="tl-title" style="color:${c.color}">${esc(c.name)} · ${c.count} 次</span>
          <span class="tl-sub">累计 ${fmt(c.points)} ${S.org.currency_name}</span>
          <span class="tl-flag">里程碑</span>
        </div>`).join('')}
      <div class="tl-node tl-milestone">
        <div class="tl-title" style="color:var(--hm-accent-deep)">当前等级 ${v.level.level}</div>
        <div class="tl-sub">累计 ${fmt(v.total_points)} ${S.org.currency_name}${v.level.points_to_next ? ' · 距下一级还需 ' + fmt(v.level.points_to_next) : ''}</div>
        <span class="tl-flag" style="background:var(--hm-accent-deep)">进行中</span>
      </div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-5">
    <h3 class="font-semibold text-gray-800 text-sm mb-2">${S.org.currency_name}规则</h3>
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50/60"><span class="text-green-600 font-bold">+</span><span class="text-gray-600">签到 <b class="text-green-600">+20</b></span></div>
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50/60"><span class="text-green-600 font-bold">+</span><span class="text-gray-600">发布供需 <b class="text-green-600">+10</b></span></div>
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50/60"><span class="text-red-500 font-bold">−</span><span class="text-gray-600">报名未签到 <b class="text-red-500">−10</b></span></div>
      <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50/60"><span class="text-red-500 font-bold">−</span><span class="text-gray-600">违规内容 <b class="text-red-500">−50</b></span></div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5">
    <div class="flex items-center justify-between mb-1">
      <h3 class="font-semibold text-gray-800 text-sm">跨组织数字资产</h3>
      <button class="text-xs underline" style="color:var(--hm-primary)" onclick="backToOrgs()">打开个人空间 ›</button>
    </div>
    <p class="text-xs text-gray-400 mb-3">以你本人归属的已确认成果，加入新组织时可携带（不含原组织敏感数据）</p>
    <div class="grid sm:grid-cols-2 gap-3">${pf.by_org.map(o => `
      <div class="p-3 bg-gray-50 rounded-xl flex items-center justify-between">
        <div class="flex items-center gap-2"><div class="avatar w-8 h-8 text-xs" style="background:${o.theme_color}">${esc(o.org_name[0])}</div>
        <div><div class="text-sm font-medium">${esc(o.org_name)}</div><div class="text-[11px] text-gray-400">${o.approved_count} 项已确认成果</div></div></div>
        <div class="text-right"><div class="font-bold c-primary">${fmt(o.points)}</div><div class="text-[10px] text-gray-400">累计${S.org.currency_name}</div></div>
      </div>`).join('') || '<p class="text-xs text-gray-400">暂无</p>'}</div>
  </div>`;
};

/* ---------- 兑换商城 ---------- */
RENDER.mall = async () => {
  const d = await api('GET', `/api/orgs/${S.org.id}/mall`);
  const cur = S.org.currency_name;
  const catNames = { physical: '实物周边', benefit: '活动权益', virtual: '虚拟服务' };
  const items = d.items.map(item => {
    const afford = d.points >= item.cost;
    return `<div class="cat-card rounded-2xl p-5 flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${item.color}"></span>
          <span class="badge bg-gray-100 text-gray-500">${catNames[item.category] || item.category}</span>
          ${item.stock <= 5 ? `<span class="badge bg-red-50 text-red-400 text-[10px]">仅剩 ${item.stock}</span>` : ''}
        </div>
        <h3 class="font-semibold text-gray-800">${esc(item.name)}</h3>
        <p class="text-sm text-gray-500 mt-0.5">${esc(item.description)}</p>
        <div class="text-lg font-bold mt-2" style="color:var(--hm-primary)">${item.cost} <span class="text-xs text-gray-400 font-normal">${cur}</span></div>
      </div>
      <button class="${afford ? 'cat-btn' : 'bg-gray-100 text-gray-400'} px-4 py-2 rounded-xl text-sm flex-shrink-0 self-center"
        ${afford ? `onclick="exchangeItem('${item.id}')"` : 'disabled'}>${afford ? '兑换' : '猫粮不足'}</button>
    </div>`;
  }).join('');
  const orders = d.myOrders.length ? `
    <h3 class="text-sm font-semibold text-gray-500 mt-6 mb-3">我的兑换记录</h3>
    <div class="space-y-2">${d.myOrders.map(o => `
      <div class="cat-card rounded-xl px-4 py-3 flex items-center justify-between text-sm">
        <div><span class="font-medium">${esc(o.item_name)}</span>
          <span class="text-xs text-gray-400 ml-2">${dt(o.created_at)}</span></div>
        <div class="flex items-center gap-2">
          <span class="font-bold" style="color:var(--hm-primary)">-${o.cost} ${cur}</span>
          <span class="badge ${o.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : o.status === 'shipped' ? 'bg-blue-50 text-blue-500' : 'bg-green-100 text-green-700'}">${{ pending: '待发货', shipped: '已发货', completed: '已完成' }[o.status]}</span>
        </div>
      </div>`).join('')}</div>` : '';
  return `<h2 class="text-lg font-bold text-gray-800 mb-1">兑换商城</h2>
  <p class="text-xs text-gray-400 mb-4">用${cur}兑换权益与周边 · 当前余额 <b class="c-primary text-base">${fmt(d.points)}</b> ${cur}</p>
  <div class="space-y-3">${items}</div>
  ${orders}`;
};

async function exchangeItem(itemId) {
  try {
    const r = await api('POST', `/api/orgs/${S.org.id}/mall/exchange`, { item_id: itemId });
    toast(`兑换成功！消耗 ${r.cost} ${S.org.currency_name}`);
    await go('mall');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 排行榜 ---------- */
RENDER.board = async () => {
  const { leaderboard, my_rank } = await api('GET', `/api/orgs/${S.org.id}/leaderboard`);
  const podium = leaderboard.slice(0, 3);
  const myEntry = leaderboard.find(r => r.user_id === S.user.id);
  const cur = S.org.currency_name;

  /* 阶梯（ladder）：跟自己的等级走，替代"超过 X%""距上一名"的竞争框架 */
  const STEPS = ['萌新', 'L1', 'L2', 'L3', 'L4'];
  let ladderHtml = '';
  if (myEntry) {
    const idx = Math.max(0, STEPS.indexOf(myEntry.level.level.split(' ')[0]));
    ladderHtml = `<div class="cat-card rounded-2xl p-4 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-1 mb-2">
        <h3 class="text-sm font-semibold text-gray-700">🪜 你的阶梯</h3>
        <span class="text-[11px] text-gray-400">跟自己比，每一步都算数 · 我的位次：第 ${my_rank || '—'} 名</span>
      </div>
      <div class="flex items-center gap-1 text-[10px] mb-2 flex-wrap">
        ${STEPS.map((s, i) => `
          <span class="px-2 py-1 rounded-lg font-medium ${i < idx ? 'bg-green-100 text-green-700' : i === idx ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-300'}">${s}</span>
          ${i < STEPS.length - 1 ? '<span class="text-gray-300">›</span>' : ''}`).join('')}
      </div>
      ${myEntry.level.next_level ? `<div class="flex items-center gap-2">
        <div class="progress-bar flex-1"><div class="progress-fill" style="width:${myEntry.level.progress}%"></div></div>
        <span class="text-[11px] text-gray-400 flex-shrink-0">距 ${myEntry.level.next_level} 还需 ${fmt(myEntry.level.points_to_next)} ${cur}</span>
      </div>` : '<div class="text-[11px] text-gray-400">已在最高一级 🎉</div>'}
    </div>`;
  }

  /* 立体领奖台：1/2/3 立柱高度差异化 + 渐变色 + 名次柱顶高光 */
  const META = {
    1: { cls: 'pod-gold',   dark: 0 },
    2: { cls: 'pod-silver', dark: 1 },
    3: { cls: 'pod-bronze', dark: 0 },
  };
  const HEAD = { 1: 14, 2: 70, 3: 100 };
  const podHead = (r, place) => `<span class="relative inline-block">
      ${r.avatar_url ? `<img src="${esc(r.avatar_url)}" class="pod-face rounded-full object-cover ring-2 ring-white shadow-sm" style="width:${place === 1 ? 62 : 50}px;height:${place === 1 ? 62 : 50}px">` : `<span class="pod-face avatar rounded-full ring-2 ring-white shadow-sm" style="width:${place === 1 ? 62 : 50}px;height:${place === 1 ? 62 : 50}px;background:${r.avatar_color};font-size:${place === 1 ? 19 : 15}px">${esc(r.display_name[0])}</span>`}
      <span class="${META[place].dark ? 'pod-medal2' : 'pod-medal2'}" style="${META[place].dark ? 'background:linear-gradient(135deg,#cfd8e4,#8f9db1);' : 'background:linear-gradient(135deg,#ffe39a,#e0a51f);'}" title="第 ${place} 名">${place}</span>
    </span>`;
  const podiumHtml = podium.length ? `
    <div class="cat-card rounded-2xl px-4 pt-5 pb-2 mb-4" style="background:linear-gradient(160deg,#fffdf8,#fef3e2);border-color:#f0e0c4">
      <div class="pod-stage max-w-md mx-auto">
        <div class="pod-col pod-silver${leaderboard.length === 1 ? ' pod-solo' : ''}">
          <div class="pod-head">${podHead(podium[1], 2)}</div>
          <div class="text-[11px] font-semibold text-gray-600 text-center mt-1">${esc(podium[1].display_name)}</div>
          <div class="pod-platform" style="height:32px">2</div>
        </div>
        <div class="pod-col pod-gold">
          <div class="pod-head">${podHead(podium[0], 1)}</div>
          <div class="text-[12px] font-bold text-gray-800 text-center mt-1">${esc(podium[0].display_name)}</div>
          <div class="pod-platform" style="height:46px">1</div>
        </div>
        <div class="pod-col pod-bronze${leaderboard.length === 2 ? ' pod-solo' : ''}">
          <div class="pod-head">${podHead(podium[2], 3)}</div>
          <div class="text-[11px] font-semibold text-gray-600 text-center mt-1">${esc(podium[2].display_name)}</div>
          <div class="pod-platform" style="height:22px">3</div>
        </div>
      </div>
      <p class="text-[10px] text-gray-400 text-center mt-2">按有效积分排列 · 致谢每一份投入</p>
    </div>` : '';

  const lbRows = leaderboard.map((r, i) => `<tr class="${r.user_id === S.user.id ? 'bg-primary-soft' : ''}">
      <td>${i < 3 ? `<span class="rank-${i + 1} w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold inline-block">${i + 1}</span>` : `<span class="text-gray-400 w-6 inline-block">${i + 1}</span>`}</td>
      <td class="font-medium"><span class="inline-flex items-center gap-2">${r.avatar_url ? '<img src="' + esc(r.avatar_url) + '" class="w-6 h-6 rounded-full object-cover">' : '<span class="avatar w-6 h-6 text-[10px]" style="background:' + r.avatar_color + '">' + esc(r.display_name[0]) + '</span>'}${esc(r.display_name)}${r.user_id === S.user.id ? ' <span class="text-[10px] text-gray-400">(我)</span>' : ''}</span></td>
      <td><span class="badge bg-primary-soft c-primary-deep">${r.level.level}</span></td>
      <td style="text-align:right" class="font-bold c-primary">${fmt(r.total_points)}</td>
      <td class="text-xs text-gray-400">${esc(r.level.perk)}</td></tr>`).join('');
  /* 手机信息熵：完整榜单收进抽屉 */
  const lbBlock = mCollapse(`完整榜单 · <span class="cnt">${leaderboard.length}</span> 人`,
    `<div class="cat-card rounded-2xl p-2 overflow-x-auto" style="margin:0"><table class="tbl">
    <thead><tr><th>排名</th><th>贡献者</th><th>等级</th><th style="text-align:right">${cur}</th><th>等级权益</th></tr></thead>
    <tbody>${lbRows}</tbody></table></div>`);
  return `<h2 class="text-lg font-bold text-gray-800 mb-4">贡献阶梯 <span class="text-xs text-gray-400 font-normal">致谢投入 · 跟自己的阶梯走</span></h2>
  ${ladderHtml}
  ${podiumHtml}
  ${lbBlock}`;
};

/* ---------- 团队空间（内部成员） ---------- */
RENDER.team = async () => {
  const tabs = subList('teamSub');
  const names = Object.fromEntries(TEAM_TABS.map(([k, n]) => [k, n]));
  const sub = S.sub.tab || tabs[0];
  const chips = tabs.map(k => `<button class="tab-btn ${sub === k ? 'active' : ''}" draggable="true"
    ondragstart="tabDragStart(event,'${k}')" ondragover="event.preventDefault()" ondrop="tabDrop(event,'${k}','teamSub')"
    onclick="go('team',{tab:'${k}'})">${names[k]}</button>`).join('')
    + `<span class="text-[10px] text-gray-300 self-center ml-1">拖动可排序</span>`;
  let body = '';
  if (sub === 'review') body = await teamReview();
  else if (sub === 'acts') body = await teamActs();
  else if (sub === 'create') body = teamCreate();
  else if (sub === 'library') body = await teamLibrary();
  else body = await teamProjects();
  return `<h2 class="text-lg font-bold text-gray-800 mb-4">团队空间 <span class="text-xs text-gray-400 font-normal">协作 · 核验 · 审核</span></h2>
  <div class="flex gap-2 mb-4 overflow-x-auto pb-1 items-center">${chips}</div>${body}`;
};

async function teamReview() {
  const { submissions } = await api('GET', `/api/orgs/${S.org.id}/submissions?status=pending`);
  S.data.pendingSubs = submissions; // 供 reviewModal 读取积分区间
  const canReject = S.orgRole === 'owner'; // 驳回（推翻成员提交）只有顶层管理者能做
  if (!submissions.length) return `<div class="cat-card rounded-2xl p-10 text-center text-gray-400">🎉 没有待审核的提交</div>`;
  return `<div class="space-y-3">${submissions.map(s => `
    <div class="cat-card rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="badge" style="background:${s.category_color}22;color:${s.category_color}">${esc(s.category_name || '未分类')}</span>
            <span class="text-xs text-gray-500">${esc(s.user_name)} · ${dt(s.created_at)}</span>
          </div>
          <div class="font-medium text-sm mt-1">${esc(s.title)}</div>
          <div class="text-xs text-gray-500 mt-1 bg-gray-50 rounded-lg p-2 break-all">${esc(s.evidence || '（无说明）')}</div>
          ${s.points_min != null ? `<div class="text-xs text-gray-400 mt-1">任务区间：${s.points_min} - ${s.points_max} ${S.org.currency_name}</div>` : ''}
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          <button class="bg-green-600 text-white text-xs px-4 py-1.5 rounded-lg" onclick="reviewModal('${s.id}',true)">通过…</button>
          ${canReject ? `<button class="bg-red-100 text-red-600 text-xs px-4 py-1.5 rounded-lg" onclick="reviewModal('${s.id}',false)">驳回</button>`
            : `<span class="text-[10px] text-gray-300 text-center">驳回需顶层管理者</span>`}
        </div>
      </div></div>`).join('')}</div>`;
}

function reviewModal(id, approve) {
  if (!approve) { doReview(id, false); return; }
  // 获取任务积分区间，构建滑条
  const sub = (S.data.pendingSubs || []).find(s => s.id === id) ||
    (S.data.allSubs || []).find(s => s.id === id);
  const t = sub || {};
  const min = t.points_min != null ? t.points_min : 0;
  const max = t.points_max != null ? t.points_max : 500;
  const range = max - min;
  openModal(`<h3 class="font-bold text-gray-800 mb-4">审核通过 · 确认积分</h3>
  <div class="space-y-4">
    <div>
      <label class="text-xs text-gray-500 block mb-2">积分评定（区间 ${min}–${max}，滑动选择；点数字可超出区间）</label>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400 w-8 text-right flex-shrink-0">${min}</span>
        <div class="relative flex-1">
          <input id="rv-slider" type="range" min="${min}" max="${max}" value="${Math.round((min + max) / 2)}" class="slider w-full" oninput="rvSlider(this.value)">
          <div class="flex justify-between text-[9px] text-gray-300 mt-0.5"><span>${min}</span><span>${max}</span></div>
        </div>
        <input id="rv-points" type="number" value="${Math.round((min + max) / 2)}" class="!w-20 text-center font-bold c-primary text-base flex-shrink-0" onchange="rvNumOverride(this.value, ${min}, ${max})">
      </div>
      <p class="text-[10px] text-gray-300 mt-1">滑轨衡量的是百分比位置——不管区间多大，滑到中间就是中间值。直接改数字可以超出区间（特别优秀或特别差）。</p>
    </div>
    <div><label class="text-xs text-gray-500">分利类目（决定未来分利归属）</label>
      <select id="rv-profit"></select></div>
    <div><label class="text-xs text-gray-500">审核备注（可选）</label><input id="rv-note" placeholder="评语/依据"></div>
    <button class="cat-btn w-full py-2 rounded-xl" onclick="doReview('${id}',true)">确认发放（不可撤回，纠错走冲正）</button>
  </div>`);
  api('GET', `/api/orgs/${S.org.id}/categories`).then(({ profit_categories }) => {
    $('rv-profit').innerHTML = profit_categories.map(c => `<option value="${c.id}">${esc(c.name)}（${esc(c.tier)}）</option>`).join('');
  });
}
function rvSlider(v) { $('rv-points').value = v; }
function rvNumOverride(v, min, max) {
  const n = Number(v); if (!Number.isFinite(n)) return;
  $('rv-slider').value = Math.max(min, Math.min(max, n));
}
async function doReview(id, approve) {
  try {
    const body = { approve };
    if (approve) {
      body.points_awarded = Number($('rv-points').value);
      body.profit_category_id = $('rv-profit').value;
      body.note = $('rv-note').value;
    }
    const r = await api('POST', `/api/submissions/${id}/review`, body);
    closeModal();
    toast(appove_ok(r, approve));
    await go('team', { tab: 'review' });
  } catch (e) { toast(e.message, 'err'); }
}
const appove_ok = (r, approve) => approve ? `已通过，发放 ${r.points} ${S.org.currency_name}` : '已驳回';

async function teamActs() {
  const { activities } = await api('GET', `/api/orgs/${S.org.id}/activities`);
  let reviewBlock = '';
  try {
    const kb = await api('GET', `/api/orgs/${S.org.id}/review-cards`);
    if (kb.cards && kb.cards.length) {
      reviewBlock = `<div class="cat-card rounded-2xl p-4 mb-4">
        <div class="flex items-center justify-between mb-2">
          <div class="font-semibold text-indigo-700 text-sm">🧠 组织知识库 · 最近复盘卡</div>
          <span class="text-[10px] text-gray-400">依据活动记录生成 · 规则模板复盘</span>
        </div>
        <div class="space-y-2">${kb.cards.map(c => `
          <div class="flex items-center justify-between gap-2 bg-indigo-50/50 rounded-lg px-3 py-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-700 truncate">${esc(c.activity_title)}</div>
              <div class="text-[11px] text-gray-500 truncate">${esc(c.headline || '')}</div>
            </div>
            <button class="text-indigo-600 underline text-xs flex-shrink-0" onclick="orgReviewModal('${c.activity_id}')">查看</button>
          </div>`).join('')}</div>
      </div>`;
    }
  } catch (e) { /* 知识库接口不可用时静默 */ }
  return `${reviewBlock}<div class="cat-card rounded-2xl p-5 mb-4 flex items-center justify-between gap-3">
    <div><div class="font-semibold text-gray-800 text-sm">创建一场新活动</div>
      <div class="text-xs text-gray-400 mt-0.5">独立表单：基本信息 · 报名设置 · 签到方式与打卡点 · 激励</div></div>
    <button class="cat-btn px-5 py-2.5 rounded-xl text-sm flex-shrink-0" onclick="go('team',{tab:'create'})">＋ 创建活动</button>
  </div>
  <div class="space-y-3">${activities.map(a => `
    <div class="cat-card rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            ${a.special_flag ? '<span class="badge bg-purple-100 text-purple-700">⭐ 特大型</span>' : ''}
            <span class="badge ${a.status === 'published' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}">${{ published: '进行中', finished: '已归档', draft: '草稿' }[a.status]}</span>
            ${a.output_reg ? `<span class="badge" style="background:var(--hm-primary-soft);color:var(--hm-primary-deep)">产出登记${a.pending_outputs ? ` · ${a.pending_outputs} 待确认` : ''}</span>` : ''}
            ${a.open_recruit ? '<span class="badge bg-teal-50 text-teal-600">开放招募</span>' : ''}
            <span class="text-xs text-gray-400">${dt(a.start_at)} · 报名${a.reg_count} · 到场${a.checkin_count} · 签退${a.checkout_count}</span>
          </div>
          <div class="font-medium text-sm mt-1">${esc(a.title)}</div>
          <div class="text-[11px] text-gray-400 mt-0.5">${modeDesc(a)}</div>
        </div>
        <div class="flex flex-wrap md:flex-col gap-2 justify-end md:justify-start md:items-end flex-shrink-0 text-xs">
          ${a.checkin_rule !== 'none' && a.checkin_mode !== 'geo' ? `<button class="c-primary underline font-medium" onclick="qrModal('${a.id}')">现场二维码</button>` : ''}
          <button class="text-blue-600 underline" onclick="rosterModal('${a.id}')">签到核验</button>
          ${a.output_reg ? `<button class="text-green-600 underline" onclick="outputsModal('${a.id}')">产出确认${a.pending_outputs ? `（${a.pending_outputs}）` : ''}</button>` : ''}
          ${a.status === 'published' ? `<button class="text-purple-600 underline" onclick="flagModal('${a.id}',${a.special_flag ? 1 : 0})">${a.special_flag ? '取消特大型标记' : '标记特大型'}</button>
          <button class="text-red-500 underline" onclick="finishModal('${a.id}')">归档结算</button>` : ''}
          ${a.status === 'finished' ? `<button class="text-indigo-600 underline" onclick="orgReviewModal('${a.id}')">🧠 复盘卡</button>` : ''}
        </div>
      </div></div>`).join('')}</div>`;
}

/** 独立的活动创建页：分组表单 */
function teamCreate() {
  return `<div class="flex items-center justify-between mb-4">
    <h3 class="text-base font-bold text-gray-800">新建活动</h3>
    <button class="tab-btn" onclick="go('team',{tab:'acts'})">← 返回活动管理</button>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-3">① 基本信息</h4>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <input id="na-title" placeholder="活动名称 *">
      <input id="na-location" value="${esc(S.org.base_location || '')}" placeholder="活动地点（默认社区基地，可改为具体公园、楼栋或线上）">
      <input id="na-start" type="datetime-local" title="开始时间">
      <input id="na-end" type="datetime-local" title="结束时间（可选）">
      <textarea id="na-desc" rows="3" placeholder="参与者会做什么 *：用动词写清楚，例如“分组拆解真实制造问题，完成一个可演示原型”" class="md:col-span-2"></textarea>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-1">② 参与者如何度过这场活动</h4>
    <p class="text-[11px] text-gray-400 mb-3">开放招募时三项都必须填写；它们会直接展示给旁观者，不依赖活动标题猜意思。</p>
    <div class="space-y-3 text-sm">
      <div><label class="text-xs text-gray-500">关键流程 / 时段安排 *</label><textarea id="na-agenda" rows="4" placeholder="例如：14:00 签到与问题介绍\n14:30 分组实操\n16:30 展示与反馈"></textarea></div>
      <div><label class="text-xs text-gray-500">参加前需要准备什么 *</label><textarea id="na-preparation" rows="2" placeholder="例如：带电脑；无需 AI 基础；现场提供材料"></textarea></div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-3">③ 报名设置</h4>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <input id="na-capacity" type="number" value="0" placeholder="人数限制（0=不限，组织者不计入）">
      <input id="na-regdl" type="datetime-local" title="报名截止（可选）">
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-1">④ 签到设置 <span class="text-xs text-gray-400 font-normal">决定成员到场如何确认</span></h4>
    <div class="text-[11px] text-gray-400 mb-3">
      <span class="hidden md:inline">先选签到方式（二选一，选定后成员端只呈现这一种），再选打卡时点：时间要求度低 → 退场打卡即可；开头要求高 → 到场扫码；需全程在场 → 到场+退场都打。现场扫码会自动生成一次性二维码；地缘打卡需设置打卡点与半径。</span>
      <span class="md:hidden flex items-center gap-2"><span>先选方式，再选打卡时点</span>${hintBtn('打卡时点怎么选', `
        <p><b>时间要求度低</b>：附近打卡即可，或退场打卡/扫码（无需到场核验）。</p>
        <p><b>开头要求高</b>：到场扫码。</p>
        <p><b>需确保时间段内人数都在</b>：到场+退场都打卡（地缘和扫码都支持）。</p>
        <p>现场扫码会自动生成一次性二维码；地缘打卡需设置打卡点与半径。</p>`)}</span>
    </div>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <select id="na-mode" onchange="naModeToggle()">
        <option value="qr">现场扫码（生成一次性二维码）</option>
        <option value="geo">地缘打卡（定位核验）</option>
      </select>
      <div>
        <select id="na-rule"></select>
        <p id="na-rule-hint" class="text-[11px] text-gray-400 mt-1"></p>
      </div>
      <div class="md:col-span-2 text-[11px] text-gray-400" id="na-qr-hint" style="display:none">发布后自动生成一次性二维码，成员到场扫码即完成；核验码可给无法扫码的人手动输入。</div>
      <div class="md:col-span-2" id="na-geo-box">
        <div class="flex gap-2 items-center flex-wrap">
          <span class="text-xs text-gray-500 flex-shrink-0">打卡点</span>
          <input id="na-geo-text" placeholder="使用当前位置，或搜索一个地点" readonly class="flex-1 bg-gray-50" style="min-width:140px">
          <button class="cat-secondary text-xs px-3 py-2 rounded-lg flex-shrink-0" onclick="naGeoUse()">使用当前位置</button>
          <span class="text-xs text-gray-400 flex-shrink-0">半径</span>
          <input id="na-radius" type="number" value="300" class="!w-20 text-center flex-shrink-0">
          <span class="text-xs text-gray-400 flex-shrink-0">米</span>
        </div>
        <div class="flex gap-2 items-center flex-wrap mt-2">
          <input id="na-geo-search" placeholder="搜索地点（如：良渚 / 春熙路）" class="flex-1" style="min-width:160px">
          <button class="tab-btn flex-shrink-0" onclick="naGeoSearch()">搜索位置</button>
        </div>
        <div id="na-geo-results" class="mt-1.5 space-y-1"></div>
        <input type="hidden" id="na-geo-lat" value="${esc(S.org.base_lat ?? '')}"><input type="hidden" id="na-geo-lng" value="${esc(S.org.base_lng ?? '')}">
      </div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-3">⑤ 激励</h4>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <div class="flex gap-2 items-center">
        <span class="text-xs text-gray-500 flex-shrink-0">有效参与得</span>
        <input id="na-points" type="number" value="20" class="!w-24 text-center">
        <span class="text-xs text-gray-400">${S.org.currency_name}（按签到规则核验后自动发放）</span>
      </div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5 mb-4">
    <h4 class="font-semibold text-gray-800 text-sm mb-1">⑥ 成果与招募 <span class="text-xs text-gray-400 font-normal">目的性优先——不是所有活动都弹记录入口</span></h4>
    <div class="grid md:grid-cols-2 gap-3 text-sm">
      <div>
        <label class="text-xs text-gray-500 mb-1 block">活动性质</label>
        <select id="na-type" onchange="naTypeToggle()">
          <option value="watch">观看参与型（分享会、观影、交流…）</option>
          <option value="hands_on">动手实践型（工作坊、共建、实操…）</option>
          <option value="output">临场产出型（现场创作、路演、拍摄…）</option>
        </select>
        <p class="text-[11px] text-gray-400 mt-1">决定这场活动在个人画像里的"性质标签"</p>
      </div>
      <div class="space-y-2 pt-1">
        <label class="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" id="na-output" class="!w-4 !h-4 mt-0.5">
          <span>需要<b>产出登记卡</b>：参与者卡片上出现录入通道，确认后进入其「我的成果」，并成为个人画像分析的证据</span>
        </label>
        <label class="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
          <input type="checkbox" id="na-open" class="!w-4 !h-4 mt-0.5">
          <span><b>开放招募</b>：跨组织出现在参与者的个人空间推荐卡（非成员可发现并加入）</span>
        </label>
      </div>
    </div>
  </div>
  <div class="cat-card rounded-2xl p-5">
    <h4 class="font-semibold text-gray-800 text-sm mb-3">⑦ 发布</h4>
    <button class="cat-btn w-full py-2.5 rounded-xl" onclick="createActivity()">发布活动（生成签到二维码）</button>
  </div>`;
}

function naModeToggle() {
  const mode = $('na-mode').value;
  $('na-geo-box').style.display = mode === 'geo' ? 'block' : 'none';
  $('na-qr-hint').style.display = mode === 'qr' ? 'block' : 'none';
  const opts = mode === 'qr'
    ? [['checkin', '到场扫码'], ['checkout_only', '退场扫码（无需到场）'], ['checkin_checkout', '到场 + 退场都扫码']]
    : [['checkin', '到场打卡'], ['checkin_checkout', '到场 + 退场都打卡']];
  $('na-rule').innerHTML = opts.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  $('na-rule-hint').textContent = mode === 'qr'
    ? '发布后自动生成一次性二维码（活动管理里查看/重置）；退场扫码 = 仅在离场时核验参与。'
    : '成员到场后点"地缘打卡"，系统按与打卡点的距离核验。';
}
async function naGeoSearch() {
  const q = $('na-geo-search').value.trim();
  if (!q) return toast('请输入地点关键词', 'err');
  $('na-geo-results').innerHTML = '<div class="text-xs text-gray-400">搜索中…</div>';
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=zh-CN&q=' + encodeURIComponent(q));
    const list = await res.json();
    if (!list.length) { $('na-geo-results').innerHTML = '<div class="text-xs text-gray-400">没有找到，试试更具体的关键词</div>'; return; }
    $('na-geo-results').innerHTML = list.map(x =>
      `<button type="button" class="text-xs text-left w-full truncate px-2 py-1.5 rounded-lg bg-white border hover:bg-primary-soft" title="${esc(x.display_name)}" onclick="naGeoPick(${x.lat},${x.lon},this)">${esc(x.display_name)}</button>`).join('');
  } catch (e) {
    $('na-geo-results').innerHTML = '<div class="text-xs text-red-400">搜索失败（需要联网），可改用"使用当前位置"</div>';
  }
}
function naGeoPick(lat, lng, el) {
  $('na-geo-lat').value = lat; $('na-geo-lng').value = lng;
  $('na-geo-text').value = `${el.title}（${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}）`;
  $('na-geo-results').innerHTML = '';
  toast('打卡点已设置');
}
function naGeoUse() {
  if (!navigator.geolocation) return toast('浏览器不支持定位，请手动填经纬度', 'err');
  toast('正在获取当前位置…', 'warn');
  navigator.geolocation.getCurrentPosition(pos => {
    $('na-geo-lat').value = pos.coords.latitude.toFixed(6);
    $('na-geo-lng').value = pos.coords.longitude.toFixed(6);
    $('na-geo-text').value = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}（精度约 ${Math.round(pos.coords.accuracy)} 米）`;
    toast('打卡点已设置');
  }, err => toast('定位失败：' + err.message, 'err'), { enableHighAccuracy: true, timeout: 8000 });
}

/** 活动性质联动产出登记：动手/产出型默认开启，观看型默认关闭（仍可手动改） */
function naTypeToggle() {
  const t = $('na-type') ? $('na-type').value : 'watch';
  if ($('na-output')) $('na-output').checked = t !== 'watch';
}

async function createActivity() {
  try {
    const mode = $('na-mode').value;
    await api('POST', `/api/orgs/${S.org.id}/activities`, {
      title: $('na-title').value, location: $('na-location').value, description: $('na-desc').value, agenda: $('na-agenda').value, preparation: $('na-preparation').value,
      start_at: $('na-start').value ? new Date($('na-start').value).toISOString() : '',
      end_at: $('na-end').value ? new Date($('na-end').value).toISOString() : null,
      reg_deadline: $('na-regdl').value ? new Date($('na-regdl').value).toISOString() : null,
      capacity: Number($('na-capacity').value || 0), points_on_complete: Number($('na-points').value || 20),
      checkin_rule: $('na-rule').value || 'checkin', checkin_mode: mode,
      geo_lat: $('na-geo-lat').value ? Number($('na-geo-lat').value) : null,
      geo_lng: $('na-geo-lng').value ? Number($('na-geo-lng').value) : null,
      geo_radius: Number($('na-radius').value || 300),
      activity_type: $('na-type') ? $('na-type').value : 'watch',
      output_reg: $('na-output') ? $('na-output').checked : undefined,
      open_recruit: $('na-open') ? $('na-open').checked : false,
    });
    toast('活动已发布，现场二维码可在活动管理中查看');
    await go('team', { tab: 'acts' });
  } catch (e) { toast(e.message, 'err'); }
}

/** 现场二维码：每场活动唯一令牌，可重置；核验码供无相机场景手动输入 */
async function qrModal(actId) {
  const info = await api('GET', `/api/activities/${actId}/qrinfo`);
  const blocks = info.kinds.map(k => `
    <div class="text-center p-4 border b-primary-soft rounded-2xl mb-3 bg-primary-soft">
      <div class="text-xs font-semibold text-gray-600 mb-2">${k.kind === 'checkin' ? '🟠 到场扫码' : '🔵 退场扫码'} <span class="text-gray-300">|</span> ${MODE_TXT[info.checkin_mode] || ''}</div>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=230x230&data=${encodeURIComponent(k.url)}&bgcolor=255-253-249"
           alt="现场二维码" class="mx-auto rounded-xl border-4 border-white shadow-sm w-[220px] h-[220px]"
           onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'text-xs text-gray-400 p-4',innerText:'二维码图生成失败（需联网），可直接展示核验码'}))">
      <div class="mt-3 text-sm text-gray-500">现场核验码 <b class="c-primary text-2xl tracking-[0.3em] align-middle ml-1">${k.code}</b></div>
      <div class="text-[10px] text-gray-400 mt-1 break-all select-all">${esc(k.url)}</div>
      <button class="text-xs text-gray-400 underline mt-2" onclick="doQRotate('${actId}','${k.kind}')">重置此二维码（旧码立即失效）</button>
    </div>`).join('');
  openModal(`<h3 class="font-bold text-gray-800 mb-1">现场签到二维码 · ${esc(info.title)}</h3>
  <p class="text-xs text-gray-400 mb-3">${RULE_TXT[info.checkin_rule]} · 二维码每场活动唯一，重置后旧码立即失效。成员扫码自动完成打卡；也可口头告知核验码手动输入。</p>
  ${blocks}`);
}
async function doQRotate(actId, kind) {
  try { await api('POST', `/api/activities/${actId}/qrotate`, { kind }); toast('二维码已重置'); qrModal(actId); }
  catch (e) { toast(e.message, 'err'); }
}

async function rosterModal(actId) {
  const d = await api('GET', `/api/activities/${actId}`);
  const a = d.activity;
  const rows = (d.roster || []).map(r => `
    <tr><td>${esc(r.display_name)}</td>
    <td>${r.checkin_at ? '✅ ' + dt(r.checkin_at) : '—'}</td>
    <td>${r.checkout_at ? '✅ ' + dt(r.checkout_at) : '—'}</td>
    <td>${r.completion === null ? '<span class="text-gray-400">不计</span>' : r.completion + '%'}</td>
    <td>${!r.checkin_at && ['checkin', 'checkin_checkout'].includes(a.checkin_rule) ? `<button class="cat-btn text-xs px-2 py-1 rounded" onclick="proxyCheck('${actId}','${r.user_id}','checkin')">代签到</button>` : ''}
        ${!r.checkout_at && (a.checkin_rule === 'checkout_only' || (r.checkin_at && a.checkin_rule === 'checkin_checkout')) ? `<button class="cat-secondary text-xs px-2 py-1 rounded" onclick="proxyCheck('${actId}','${r.user_id}','checkout')">代签退</button>` : ''}</td></tr>`).join('');
  openModal(`<h3 class="font-bold text-gray-800 mb-1">签到核验 · ${esc(a.title)}</h3>
  <p class="text-xs text-gray-400 mb-3">${RULE_TXT[a.checkin_rule]}</p>
  <div class="overflow-x-auto"><table class="tbl"><thead><tr><th>成员</th><th>签到</th><th>签退</th><th>完成度</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
async function proxyCheck(actId, userId, kind) {
  try {
    await api('POST', `/api/activities/${actId}/${kind}`, { user_id: userId });
    toast('已代操作'); rosterModal(actId);
  } catch (e) { toast(e.message, 'err'); }
}
function flagModal(actId, cur) {
  openModal(`<h3 class="font-bold text-gray-800 mb-3">${cur ? '取消' : '设置'}特大型活动标记</h3>
  <p class="text-xs text-gray-400 mb-3">仅作颜色标记，不改变事务分类；分利时可由管理者确认为上级类块。</p>
  <div class="flex gap-2 items-center mb-3"><span class="text-xs text-gray-500">颜色</span><input id="fl-color" type="color" value="#7C3AED" class="w-16 h-9"></div>
  <button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="doFlag('${actId}',${cur ? 0 : 1})">${cur ? '取消标记' : '确认标记'}</button>`);
}
async function doFlag(actId, v) {
  try { await api('POST', `/api/activities/${actId}/flag`, { special_flag: !!v, color_tag: $('fl-color') ? $('fl-color').value : null });
    closeModal(); toast('已更新'); await go('team', { tab: 'acts' });
  } catch (e) { toast(e.message, 'err'); }
}
function finishModal(actId) {
  openModal(`<h3 class="font-bold text-gray-800 mb-2">归档并结算活动</h3>
  <p class="text-xs text-gray-500 mb-3">将按签到规则为完成度 100% 的成员自动发放积分（幂等，重复执行不会重复发分）。未满足签到/签退的不计。</p>
  <button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="doFinish('${actId}')">确认归档结算</button>`);
}
async function doFinish(actId) {
  try {
    const r = await api('POST', `/api/activities/${actId}/finish`, {});
    closeModal();
    toast(`已归档，${r.settled.length} 人获得积分`);
    // 自动复盘卡生成反馈
    if (r.review && r.review.id) {
      toast(`AI 已生成活动复盘卡，使用「复盘卡」按钮查看`, 'info');
    }
    await go('team', { tab: 'acts' });
  } catch (e) { toast(e.message, 'err'); }
}

/** 活动复盘卡查看（组织端VIP功能） */
async function orgReviewModal(actId) {
  const { review } = await api('GET', `/api/orgs/${S.org.id}/activities/${actId}/review`);
  if (!review) { toast('暂无复盘卡', 'err'); return; }

  const r = review;
  openModal(`<div class="space-y-4 max-h-[80vh] overflow-y-auto">
    <h3 class="font-bold text-gray-800 mb-2">活动复盘卡 · ${dt(r.report.meta.generated_at)}</h3>
    ${r.report.sections.map(s => `
      <div class="cat-card p-4">
        <h4 class="font-semibold text-gray-700 text-sm mb-2">${s.title}</h4>
        <p class="text-sm text-gray-600 whitespace-pre-line">${s.content}</p>
      </div>`).join('')}
    <div class="cat-card p-4 bg-indigo-50">
      <h4 class="font-semibold text-indigo-700 text-sm mb-2">AI 下一场建议模板</h4>
      <p class="text-sm text-gray-600 mb-2">标题：${r.report.template.title}</p>
      <p class="text-xs text-gray-500">时长：${r.report.template.duration_min} 分钟</p>
      <p class="text-xs text-gray-500">环节：${r.report.template.sections.join(' → ')}</p>
      <p class="text-xs text-gray-500">目标人数：${r.report.template.target_participants}</p>
    </div>
    <button class="cat-btn w-full py-2 rounded-xl" onclick="navigator.clipboard.writeText(JSON.stringify(r.report))">复制完整复盘数据</button>
  </div>`);
}

async function teamLibrary() {
  const { tasks } = await api('GET', `/api/orgs/${S.org.id}/tasks`);
  const { tx_categories } = await api('GET', `/api/orgs/${S.org.id}/categories`);
  S.data.txCats = tx_categories; S.data.libraryTasks = tasks;
    const taskRows = tasks.map(t => {
    const limited = t.slots > 0;
    const remain = limited ? Math.max(0, t.slots - t.claimed_count) : null;
    return `<tr><td class="font-medium">${esc(t.name)}</td>
      <td><span class="badge" style="background:${t.category_color}22;color:${t.category_color}">${esc(t.category_name)}</span></td>
      <td class="c-primary">${t.points_min}-${t.points_max}</td>
      <td>${limited ? `限 ${t.slots} 次 · 已领 ${t.claimed_count} · 剩 ${remain}` : '不限'}</td>
      <td>${t.approved_count}</td>
      <td>${t.status === 'published' ? '<span class="badge bg-green-100 text-green-700">上架</span>' : t.status === 'draft' ? '草稿' : '<span class="badge bg-gray-100 text-gray-500">已下架</span>'}</td>
      <td class="text-xs whitespace-nowrap">
        <button class="underline c-primary mr-1.5" onclick="editTaskTerms('${t.id}')">任务与回报</button>
        <button class="underline text-gray-400" onclick="if(confirm('确定删除「${esc(t.name)}」？未有人领取过才可删除'))taskDelete('${t.id}')">删除</button>
      </td></tr>`;
  }).join('');
  /* 两种模式：默认表单填写；点「表格直填」切换到分类分组可编辑表 */
  const mode = S._taskMode || 'form';
  /* 桌面端：范式表格直填——按分类分组，每个分类一个可编辑表，留一行空行，填完自动加一行 */
  const gridTable = !isMobile();
  const groupByCat = {};
  for (const t of tasks) (groupByCat[t.category_name] = groupByCat[t.category_name] || []).push(t);
  const catTables = gridTable ? (S.data.txCats || []).map(c => {
    const list = groupByCat[c.name] || [];
    const rows = list.map((t, i) => editableRow(t, c, i)).join('');
    return `<div class="mb-4">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="badge" style="background:${c.color}22;color:${c.color}">${esc(c.name)}</span>
        <span class="text-[10px] text-gray-400">${list.length} 个任务</span>
      </div>
      <table class="tbl" data-cat="${c.id}">
        <thead><tr><th>任务名称</th><th>积分区间</th><th>次数</th><th>频率说明</th><th>操作</th></tr></thead>
        <tbody id="tbl-${c.id}">${rows}${editableRow(null, c, list.length)}</tbody>
      </table>
    </div>`;
  }).join('') : '';
  function editableRow(t, c, i) {
    const isNew = !t;
    return `<tr data-task="${t ? t.id : ''}" class="editable-row ${isNew ? 'bg-yellow-50/40' : ''}">
      <td><input class="text-xs !px-2 !py-1 border-0" placeholder="任务名称" value="${t ? esc(t.name) : ''}" oninput="gridRowInput(this)"></td>
      <td class="whitespace-nowrap"><input class="text-xs !px-2 !py-1 !w-16 text-center border-0" placeholder="下限" type="number" value="${t ? t.points_min : ''}" oninput="gridRowInput(this)"> <span class="text-gray-300">–</span> <input class="text-xs !px-2 !py-1 !w-16 text-center border-0" placeholder="上限" type="number" value="${t ? t.points_max : ''}" oninput="gridRowInput(this)"></td>
      <td><input class="text-xs !px-2 !py-1 !w-12 text-center border-0" placeholder="不限" type="number" value="${t && t.slots > 0 ? t.slots : ''}" oninput="gridRowInput(this)"></td>
      <td><input class="text-xs !px-2 !py-1 border-0" placeholder="频率说明（可选）" value="${t ? esc(t.frequency_note) : ''}" oninput="gridRowInput(this)"></td>
      <td class="whitespace-nowrap"><span class="text-[10px] text-gray-300 mr-1 row-status">${t ? (t.status === 'published' ? '已上架' : t.status === 'draft' ? '草稿' : '已下架') : '新行'}</span>
        ${t ? `<button class="underline c-primary text-xs mr-1" onclick="editTaskTerms('${t.id}')">任务与回报</button><button class="underline c-primary text-xs mr-1" onclick="gridRowSave('${t.id}', this)">保存</button><button class="underline text-gray-400 text-xs" onclick="if(confirm('删除该任务？未有人领取过才可删'))taskDelete('${t.id}')">删除</button>` : `<button class="cat-btn text-xs px-2.5 py-1 rounded" onclick="gridRowSave(null, this)">＋ 入库</button>`}</td>
    </tr>`;
  }
  const importCard = gridTable
    ? `<div class="cat-card rounded-2xl p-4 mb-4">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h3 class="font-semibold text-gray-800 text-sm">📋 任务库 · 表格直填</h3>
          <div class="flex gap-2 items-center flex-wrap">
            <label class="tab-btn cursor-pointer text-xs">📥 导入 Word/CSV<input type="file" accept=".docx,.csv,text/csv" class="hidden" onchange="importCSVFile(this)"></label>
            <button class="text-xs underline text-gray-400" onclick="hintShow(3)">格式说明</button>
          </div>
        </div>
        <p class="text-[11px] text-gray-400">在下面表格里直接改——每个分类一组，留一行空行，填完一格会自动加新行；改完点「保存/入库」。也支持导入 Word(.docx) 表格或 CSV 文件。批量新增一律存为草稿，补齐「任务与回报」后发布。</p>
      </div>`
    : `<div class="desk-tip mb-4"><b>⌨ 批量编辑适合电脑操作</b>
        <p class="text-xs text-gray-500 mt-1.5 leading-relaxed">在电脑上打开工作台可表格直填、Word/CSV 导入；手机上用下面的表单逐条新增。</p></div>`;
  const listBlock = isMobile()
    ? `<details class="m-collapse"><summary><span>任务库清单 · <span class="cnt">${tasks.length}</span> 项</span></summary>
        <div class="space-y-2 pt-1">${tasks.map(t => `<div class="m-row flex items-center justify-between gap-2">
          <div class="min-w-0"><div class="text-sm font-medium truncate">${esc(t.name)}</div>
          <div class="text-[11px] text-gray-400 mt-0.5"><span class="badge" style="background:${t.category_color}22;color:${t.category_color}">${esc(t.category_name)}</span> ${t.points_min}-${t.points_max} · ${t.slots > 0 ? `限 ${t.slots} 次` : '不限'} · 已确认 ${t.approved_count}</div></div>
          <div class="flex flex-col gap-1 text-[11px]">
            <button class="underline c-primary" onclick="editTaskTerms('${t.id}')">任务与回报</button>
            <button class="underline text-gray-400" onclick="if(confirm('确定删除？未有人领取过才可删'))taskDelete('${t.id}')">删除</button>
          </div>
        </div>`).join('')}</div></details>`
    : '';
  setTimeout(catRenderPicker, 0);
  return `<div class="cat-card rounded-2xl p-5 mb-4">
    <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
      <h3 class="font-semibold text-gray-800 text-sm">＋ 快速新增一条</h3>
      <div class="flex gap-2 text-xs">
        <button class="tab-btn ${mode === 'form' ? 'active' : ''}" onclick="S._taskMode='form';go('team',{tab:'library'},true)">✏️ 表单填写</button>
        <button class="tab-btn ${mode === 'grid' ? 'active' : ''}" onclick="S._taskMode='grid';go('team',{tab:'library'},true)">📋 表格直填</button>
      </div>
    </div>
    <div id="nt-cat-picker" class="flex flex-wrap gap-1 mb-2"></div>
    ${mode === 'form' ? `<div class="grid md:grid-cols-2 gap-3 text-sm">
      <input id="nt-name" aria-label="任务名称" placeholder="任务名称">
      <input id="nt-freq" aria-label="频率说明" placeholder="频率说明">
      <div class="flex gap-2 items-center"><input id="nt-min" aria-label="最低积分" type="number" placeholder="最低分"><span class="text-gray-400">-</span><input id="nt-max" aria-label="最高积分" type="number" placeholder="最高分"><span class="text-xs text-gray-400">${S.org.currency_name}</span></div>
      <div class="flex gap-2 items-center"><input id="nt-slots" aria-label="认领名额" type="number" value="0" class="!w-20 text-center"><span class="text-xs text-gray-400">次数（0=不限）</span></div>
      <input id="nt-desc" placeholder="要做什么、交付什么" aria-label="任务内容" class="md:col-span-2">
      ${taskTermsFields()}
      <button class="tab-btn" onclick="createTask('draft')">先存草稿</button>
      <button class="cat-btn py-2 rounded-xl md:col-span-2" onclick="createTask()">入库并发布</button>
    </div>` : `<div class="cat-card rounded-2xl p-4"><h3 class="font-semibold text-gray-800 text-sm mb-2">🗂 分类任务表 · 点表格直接改</h3>${catTables}</div>`}
  </div>
  ${importCard}
  ${listBlock}`;
}
async function createTask(status = 'published') {
  try {
    await api('POST', `/api/orgs/${S.org.id}/tasks`, {
      ...readTaskTerms(), status, name: $('nt-name').value, tx_category_id: S._ntCat || (S.data.txCats && S.data.txCats[0] ? S.data.txCats[0].id : ''),
      points_min: Number($('nt-min').value || 0), points_max: Number($('nt-max').value || 0),
      slots: Number($('nt-slots').value || 0),
      frequency_note: $('nt-freq').value, description: $('nt-desc').value,
    });
    toast('任务已入库'); await go('team', { tab: 'library' });
  } catch (e) { toast(e.message, 'err'); }
}

async function teamProjects() {
  const { projects } = await api('GET', `/api/orgs/${S.org.id}/projects`);
  const cards = await Promise.all(projects.map(async p => {
    const d = await api('GET', `/api/projects/${p.id}`);
    const stBadge = t => ({ open: '<span class="badge bg-gray-100 text-gray-600">待认领</span>', claimed: '<span class="badge bg-blue-100 text-blue-700">进行中</span>',
      submitted: '<span class="badge bg-yellow-100 text-yellow-700">待验收</span>', confirmed: '<span class="badge bg-green-100 text-green-700">✓ 已确认</span>',
      rejected: '<span class="badge bg-red-100 text-red-600">被打回</span>' }[t.status]);
    const opBtn = t => {
      if (t.status === 'open' && t.assignee_id === null) return `<button class="cat-btn text-xs px-2 py-1 rounded" onclick="claimTask('${t.id}')">认领</button>`;
      if ((t.status === 'claimed' || t.status === 'rejected') && t.assignee_id === S.user.id) return `<button class="cat-secondary text-xs px-2 py-1 rounded" onclick="submitProjTask('${t.id}')">提交验收</button>`;
      return '';
    };
    /* 手机信息熵：宽表格 → 紧凑卡片行 */
    const body = isMobile()
      ? `<div class="space-y-2">${d.tasks.map(t => `<div class="m-row flex items-center justify-between gap-2">
          <div class="min-w-0"><div class="text-sm font-medium truncate">${esc(t.title)}</div>
          <div class="text-[11px] text-gray-400 mt-0.5">${esc(t.assignee_name || '待认领')} · ${t.points != null ? '+' + t.points : '—'}</div></div>
          <div class="flex items-center gap-1.5 flex-shrink-0">${stBadge(t)}${opBtn(t)}</div></div>`).join('') || '<p class="text-xs text-gray-400 py-2">暂无任务</p>'}</div>`
      : `<table class="tbl"><thead><tr><th>任务</th><th>责任人</th><th>状态</th><th>积分</th><th></th></tr></thead><tbody>${d.tasks.map(t => {
          const st = stBadge(t);
          return `<tr><td class="font-medium">${esc(t.title)}</td><td>${esc(t.assignee_name || '—')}</td><td>${st}</td>
            <td>${t.points != null ? '+' + t.points : '—'}</td><td>${opBtn(t)}</td></tr>`;
        }).join('')}</tbody></table>`;
    return `<div class="cat-card rounded-2xl p-5">
      <div class="flex items-center justify-between mb-2">
        <div><span class="font-semibold text-gray-800 text-sm">${esc(p.name)}</span>
          <span class="text-xs text-gray-400 ml-2">${d.completion.done}/${d.completion.total} · ${d.completion.percent}%</span></div>
        <div class="flex gap-2 text-xs">
          <button class="text-blue-600 underline" onclick="addProjTask('${p.id}')">+ 拆解任务</button>
        </div>
      </div>
      <div class="progress-bar mb-3"><div class="progress-fill" style="width:${d.completion.percent}%"></div></div>
      ${body}
    </div>`;
  }));
  return `<div class="cat-card rounded-2xl p-5 mb-4">
    <h3 class="font-semibold text-gray-800 text-sm mb-3">发起项目</h3>
    <div class="flex gap-3"><input id="np-name" placeholder="项目名称" class="flex-1"><button class="cat-btn px-6 rounded-xl text-sm" onclick="createProject()">发起</button></div></div>
  <div class="space-y-4">${cards.join('') || '<p class="text-sm text-gray-400 text-center py-6">暂无项目</p>'}</div>`;
}
async function createProject() {
  try { await api('POST', `/api/orgs/${S.org.id}/projects`, { name: $('np-name').value });
    toast('项目已创建'); await go('team', { tab: 'projects' });
  } catch (e) { toast(e.message, 'err'); }
}
function addProjTask(pid) {
  openModal(`<h3 class="font-bold text-gray-800 mb-3">拆解任务（可确认粒度）</h3>
  <div class="space-y-3"><input id="pt-title" placeholder="任务标题">
  <input id="pt-accept" placeholder="验收标准">
  <button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="doAddProjTask('${pid}')">添加</button></div>`);
}
async function doAddProjTask(pid) {
  try { await api('POST', `/api/projects/${pid}/tasks`, { title: $('pt-title').value, acceptance: $('pt-accept').value });
    closeModal(); toast('已添加'); await go('team', { tab: 'projects' });
  } catch (e) { toast(e.message, 'err'); }
}
async function claimTask(id) {
  try { await api('POST', `/api/project-tasks/${id}/claim`); toast('已认领'); await go('team', { tab: 'projects' });
  } catch (e) { toast(e.message, 'err'); }
}
function submitProjTask(id) {
  S._ev = { images: [], files: [], links: [] };
  openModal(`<h3 class="font-bold text-gray-800 mb-1">提交验收</h3>
  <p class="text-xs text-gray-400 mb-3">文字直接写，图片可拖入或粘贴截图，文件和链接也行——审核者能一眼看到全部。</p>
  <textarea id="spt-evidence" rows="3" placeholder="成果说明 / 链接"></textarea>
  <div class="flex items-center gap-2 flex-wrap mt-2">
    <label class="tab-btn cursor-pointer">📷 图片/截图<input type="file" accept="image/*" multiple class="hidden" onchange="evPickImages(this)"></label>
    <label class="tab-btn cursor-pointer">📎 文件<input type="file" class="hidden" onchange="evPickFiles(this)"></label>
    <button type="button" class="tab-btn" onclick="evAddLink()">🔗 加链接</button>
  </div>
  <div id="ev-preview" class="mt-2"></div>
  <button class="cat-btn w-full py-2 rounded-xl text-sm mt-3" onclick="doSubmitProjTask('${id}')">提交（进入待审核）</button>`);
  evRenderPreview();
}
function evRenderPreview() {
  const el = $('ev-preview'); if (!el || !S._ev) return;
  let h = '';
  for (const u of S._ev.images) h += `<span class="relative inline-flex mr-1 mb-1"><img src="${esc(u)}" class="w-16 h-16 object-cover rounded-lg border border-gray-100"><button type="button" class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] leading-none" onclick="evDelItem('images',${S._ev.images.indexOf(u)})">×</button></span>`;
  for (const f of S._ev.files) h += `<span class="inline-flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1 mr-1 mb-1 text-xs"><span class="truncate max-w-32">${esc(f.name)}</span><button type="button" class="text-red-400" onclick="evDelItem('files',${S._ev.files.indexOf(f)})">×</button></span>`;
  for (const l of S._ev.links) h += `<span class="inline-flex items-center gap-1 bg-blue-50 rounded-lg px-2 py-1 mr-1 mb-1 text-xs"><span class="truncate max-w-32 c-primary">${esc(l)}</span><button type="button" class="text-red-400" onclick="evDelItem('links',${S._ev.links.indexOf(l)})">×</button></span>`;
  el.innerHTML = h;
}
function evDelItem(kind, i) { if (S._ev && S._ev[kind]) { S._ev[kind].splice(i, 1); evRenderPreview(); } }
function evAddLink() {
  const url = prompt('粘贴链接地址：'); if (!url) return;
  if (!S._ev) S._ev = { images: [], files: [], links: [] };
  S._ev.links.push(url); evRenderPreview();
}
async function evPickImages(input) {
  for (const f of [...(input.files || [])].slice(0, 6)) {
    try { const url = await compressPhoto(f, 1024); if (S._ev) S._ev.images.push(url); } catch { /* 单张图片压缩失败（如格式损坏）：跳过该张继续 */ }
  }
  evRenderPreview(); input.value = '';
}
async function evPickFiles(input) {
  for (const f of [...(input.files || [])].slice(0, 3)) {
    if (f.size > 10 * 1024 * 1024) { toast(`「${f.name}」超过 10MB，跳过`, 'err'); continue; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const b64 = String(dataUrl).split(',')[1] || '';
    try {
      const r = await api('POST', '/api/me/uploads', { data_b64: b64, ext: (f.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin' });
      if (S._ev) S._ev.files.push({ name: f.name, url: r.url });
    } catch (e) { toast(`「${f.name}」上传失败：${e.message}`, 'err'); }
  }
  evRenderPreview(); input.value = '';
}
async function doSubmitProjTask(id) {
  const ev = S._ev || { images: [], files: [], links: [] };
  const textParts = [];
  const noteText = $('spt-evidence') ? $('spt-evidence').value.trim() : '';
  if (noteText) textParts.push(noteText);
  for (const l of ev.links || []) textParts.push('链接：' + l);
  try {
    const evidence = textParts.join('\n') || '(见附件)';
    // 图片/文件作为独立附件存到 uploads，URL 集合追加到 evidence 末尾
    const attachParts = [];
    for (const u of ev.images || []) attachParts.push('图：' + u.slice(0, 30) + '…');
    for (const f of ev.files || []) attachParts.push('件：' + f.url);
    if (attachParts.length) textParts.push('附件清单：\n' + attachParts.join('\n'));
    await api('POST', `/api/project-tasks/${id}/submit`, { evidence });
    // 附件存为 JSON 文件挂在 uploads（提交记录通过 evidence 文本中的链接引用）
    S._ev = null;
    closeModal(); toast('已提交'); await go('team', { tab: 'projects' });
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 老板空间（顶层管理者） ---------- */
RENDER.boss = async () => {
  const tabs = subList('bossSub');
  const names = Object.fromEntries(BOSS_TABS.map(([k, n]) => [k, n]));
  const sub = S.sub.tab || tabs[0];
  const chips = tabs.map(k => `<button class="tab-btn ${sub === k ? 'active' : ''}" draggable="true"
    ondragstart="tabDragStart(event,'${k}')" ondragover="event.preventDefault()" ondrop="tabDrop(event,'${k}','bossSub')"
    onclick="go('boss',{tab:'${k}'})">${names[k]}</button>`).join('')
    + `<span class="text-[10px] text-gray-300 self-center ml-1">拖动可排序</span>`;
  let body = '';
  if (sub === 'stats') body = await bossStats();
  else if (sub === 'dist') body = await bossDist();
  else if (sub === 'members') body = await bossMembers();
  else if (sub === 'org') body = bossBrand();
  else body = await bossAudit();
  return `<h2 class="text-lg font-bold text-gray-800 mb-4">老板空间 <span class="text-xs text-gray-400 font-normal">纵览全局 · 规则 · 分利</span></h2>
  <div class="flex gap-2 mb-4 overflow-x-auto pb-1 items-center">${chips}</div>${body}`;
};

async function bossStats() {
  const s = await api('GET', `/api/orgs/${S.org.id}/stats`);
  const maxPts = Math.max(...s.by_category.map(c => c.points), 1);
  const actTable = `<div class="cat-card rounded-2xl p-5" style="margin:0">
      <h3 class="font-semibold text-gray-800 text-sm mb-3">活动到场情况</h3>
      <div class="overflow-x-auto"><table class="tbl"><thead><tr><th>活动</th><th>报名</th><th>到场</th><th>签退</th><th>标记</th></tr></thead>
      <tbody>${s.activities.map(a => `<tr><td class="font-medium">${esc(a.title)}<div class="text-[10px] text-gray-400">${dOnly(a.start_at)}</div></td>
        <td>${a.reg_count}</td><td>${a.checkin_count}</td><td>${a.checkout_count}</td>
        <td>${a.special_flag ? '<span class="badge bg-purple-100 text-purple-700">特大型</span>' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <span class="hidden md:inline">到场率可导出复核；活动板块权重与分利权重是两套体系</span>
      <span class="md:hidden inline-flex items-center gap-2"><span>到场率可导出复核</span><button type="button" class="hint-q md:hidden" title="查看说明" onclick="hintShow(2)">?</button></span>
    </div>`;
  return `
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
    ${[['组织成员', s.totals.members, '#F97C2F'], ['活动总数', s.totals.activities, '#3DBBA8'],
       [`累计发放${S.org.currency_name}`, fmt(s.totals.points_awarded), '#FFD700'],
       ['待审核成果', s.totals.submissions_pending, '#6a1b9a']].map(([n, v, c]) => `
      <div class="stat-card rounded-2xl p-4" style="border-left-color:${c}">
        <div class="text-xs text-gray-500">${n}</div><div class="text-2xl font-bold text-gray-800 mt-1">${v}</div></div>`).join('')}
  </div>
  <div class="grid md:grid-cols-2 gap-4 mb-5">
    <div class="cat-card rounded-2xl p-5">
      <h3 class="font-semibold text-gray-800 text-sm mb-3">各类别积分分布</h3>
      ${s.by_category.map(c => `<div class="mb-3"><div class="flex justify-between text-xs mb-1">
        <span style="color:${c.color}">${esc(c.name)} · ${c.people} 人 · ${c.completions} 次</span><span class="font-semibold" style="color:${c.color}">${fmt(c.points)}</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(c.points / maxPts * 100)}%;background:${c.color}"></div></div></div>`).join('')}
    </div>
    ${mCollapse('活动到场情况 · 最近 20 场', actTable)}
  </div>
  <div class="cat-card rounded-2xl p-5">
    <h3 class="font-semibold text-gray-800 text-sm mb-3">头部贡献者</h3>
    <div class="flex flex-wrap gap-2">${s.top_contributors.map((c, i) => `
      <div class="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
        ${c.avatar_url ? '<img src="' + esc(c.avatar_url) + '" class="w-7 h-7 rounded-full object-cover">' : '<span class="avatar w-7 h-7 text-[10px]" style="background:' + c.avatar_color + '">' + esc(c.display_name[0]) + '</span>'}
        <span class="text-sm">${esc(c.display_name)}</span><span class="c-primary font-bold text-sm">${fmt(c.total_points)}</span></div>`).join('')}</div>
  </div>`;
}

async function bossDist() {
  const { distributions } = await api('GET', `/api/orgs/${S.org.id}/distributions`);
  S.data.dists = distributions;
  const active = S.sub.dist || distributions[0]?.id;
  if (!active) return `<div class="cat-card rounded-2xl p-6 text-center text-gray-400">还没有分红方案<br><br>
    <button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="newDistModal()">+ 新建分红方案（模拟）</button></div>`;
  const d = distributions.find(x => x.id === active);
  const others = distributions.filter(x => x.id !== active);
  const chips = distributions.map(x => `<button class="tab-btn ${x.id === active ? 'active' : ''}" onclick="go('boss',{tab:'dist',dist:'${x.id}'})">${esc(x.name)}${x.status === 'confirmed' ? ' 🔒' : ''}</button>`).join('')
    + `<button class="tab-btn" onclick="newDistModal()">＋ 新建</button>`;
  /* 飞书式分工：调权重/核对倍率/确认冻结涉及资金口径，手机端只读，引导去电脑 */
  if (isMobile() && d.status === 'draft') {
    return `<div class="flex gap-2 mb-4 flex-wrap">${chips}</div>
    <div class="desk-tip"><b>⚖ 分利模拟适合电脑操作</b>
      <p class="text-xs text-gray-500 mt-1.5 leading-relaxed">拖动权重滑条、核对倍率警告、确认并冻结——都涉及资金口径，请在电脑端打开工作台完成。手机端可随时切换查看<b>已冻结方案 🔒</b>的结果与支付清单，也可以新建草稿留到电脑上细化。</p>
      <button class="cat-btn px-4 py-2 rounded-xl text-sm mt-3" onclick="newDistModal()">＋ 先建一个草稿</button></div>`;
  }
  const { profit_categories: cats } = await api('GET', `/api/orgs/${S.org.id}/categories`);
  const w = JSON.parse(d.weights || '{}');
  // 权重状态：拖动一个滑块时，"最不重要"的滑块（未操作过的 / 最早操作过的）自动吸收差值，
  // 最近操作的保持不动 → 合计始终自动回到 100%
  S.wst = {};
  cats.forEach(c => S.wst[c.id] = { v: Math.round((w[c.id] || 0) * 100), t: 0, n: 0 });
  S.wCats = cats;
  const frozen = d.status !== 'draft';
  const shares = weightShares(); // 未锁项的自动配平预估值，首帧即正确
  const wrow = c => {
    const st = S.wst[c.id];
    const locked = st.v != null;
    const val = locked ? st.v : (shares.auto[c.id] || 0);
    return `<div class="flex items-center gap-3">
      <div class="w-28 text-xs font-medium text-gray-600 truncate">${esc(c.name)}</div>
      <div class="ws-wrap">
        <div class="ws-track"></div>
        <div class="ws-fill${locked ? '' : ' ws-auto'}" id="wf-${c.id}" style="--p:${val}"></div>
        <input type="range" id="s-${c.id}" class="ws-range" min="0" max="100" value="${val}"
          ${frozen ? 'disabled' : ''} oninput="onWeightSlide('${c.id}', this)">
      </div>
      <button type="button" id="wc-${c.id}" class="wchip${locked ? ' locked' : ''}"
        ${frozen ? 'disabled' : `onclick="toggleWeightLock('${c.id}')"`}>${locked ? val : `<em>自动</em>${val}`}</button>
      <span class="text-xs text-gray-400">%</span>
    </div>`;
  };
  const sliders = cats.map(c => wrow(c)).join('');
  /* 桌面左右分栏：滑条左、存钱罐+分配比重图右（上下堆叠太占纵向） */
  return `<div class="flex gap-2 mb-4 flex-wrap">${chips}</div>
  <div class="grid lg:grid-cols-2 gap-4 items-start">
  <div class="cat-card rounded-2xl p-5">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-gray-800 text-sm">方案参数</h3>
      ${d.status === 'draft' ? `<span class="badge bg-yellow-100 text-yellow-700">草稿 · 可反复模拟</span>` : `<span class="badge bg-green-100 text-green-700">已确认 · 快照冻结</span>`}
    </div>
    <div class="grid md:grid-cols-3 gap-3 text-sm mb-4">
      <div><label class="text-xs text-gray-500">总金额（元）</label><input id="ds-total" type="number" value="${d.total_amount}" ${d.status !== 'draft' ? 'disabled' : ''}></div>
      <div><label class="text-xs text-gray-500">头部奖励前 N 名（按总有效积分排行榜）</label><input id="ds-topn" type="number" value="${d.bonus_top_n}" ${d.status !== 'draft' ? 'disabled' : ''}></div>
      <div><label class="text-xs text-gray-500">每人奖励（元）</label><input id="ds-bonus" type="number" value="${d.bonus_amount}" ${d.status !== 'draft' ? 'disabled' : ''}></div>
      <div><label class="text-xs text-gray-500">奖励机制（涉及钱，二选一）</label>
        <select id="ds-bonusmode" ${d.status !== 'draft' ? 'disabled' : ''}>
          <option value="extra" ${(d.bonus_mode || 'extra') === 'extra' ? 'selected' : ''}>额外奖励：头部仍参与分利</option>
          <option value="regular" ${d.bonus_mode === 'regular' ? 'selected' : ''}>常规分配：头部只拿奖励金</option>
        </select></div>
    </div>
    <div class="text-[11px] text-gray-400 -mt-2 mb-3 leading-relaxed">
      <span class="hidden md:inline">奖励依据：<b class="text-gray-600">总有效积分排行榜前 N 名</b>（全局排名，不按单个分利池排名）。两种机制：<b class="text-gray-600">额外奖励</b>=奖励金从总金额扣除，人数不变，仍由所有人（含头部）分其余额；<b class="text-gray-600">常规分配</b>=奖励金扣除，且头部 N 人不计入常规分利（人数与金额都减去），由其余人分其余额。</span>
      <span class="md:hidden flex items-center gap-2"><span>奖励依据：总有效积分排行榜前 N 名</span>${hintBtn('奖励机制与依据', `
        <p><b>额外奖励</b>：奖励金从总金额扣除，人数不变，仍由所有人（含头部）按积分占比分其余额。头部 = 奖励金 + 常规分红。</p>
        <p><b>常规分配</b>：奖励金扣除，且头部 N 人不计入常规分利（人数与金额都减去），由其余人分其余额。头部 = 只拿奖励金。</p>
        <p>涉及钱，两种机制的区别务必在保存前与团队对齐。</p>`)}</span>
    </div>
    <label class="text-xs text-gray-500 block mb-2">分利类目权重（拖动滑条 = 锁定该数值；点击数值框 = 解锁/锁定；虚线"自动"项由一键配平计算，合计恒为 100%）</label>
    <div class="space-y-2 mb-2">${sliders}</div>
    <div class="p-3 bg-gray-50 rounded-xl text-xs flex items-center justify-between gap-2">
      <span id="w-total-line">合计：<b id="w-total">100%</b></span>
      <button class="cat-secondary text-xs px-3 py-1.5 rounded-lg flex-shrink-0" onclick="balanceFill()">⚡ 一键配平（锁定全部"自动"项）</button>
    </div>
    ${d.status === 'draft' ? `<div class="flex gap-2 mt-4">
      <button class="cat-secondary px-4 py-2 rounded-xl text-sm" onclick="saveDist('${d.id}')">保存参数</button>
      <button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="loadPreview('${d.id}')">实时预览</button>
      <button class="bg-green-600 text-white px-4 py-2 rounded-xl text-sm ml-auto" onclick="confirmDist('${d.id}')">确认并冻结 →</button>
    </div>` : ''}
  </div>
  </div>
  <div class="space-y-4">
    <div id="save-card" class="cat-card rounded-2xl p-4"></div>
    <div id="dist-viz" class="cat-card rounded-2xl p-3"></div>
  </div>
  </div>
  <div id="ds-result"></div>`;
  syncWeightUI(); // 初始化填充色
}

/** 拖动滑块 = 锁定该数值；未锁定项留待"一键配平" */
function onWeightSlide(catId, val) {
  const st = S.wst; if (!st || !st[catId]) return;
  st[catId].v = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
  syncWeightUI();
  vizUpdateLocal();
}
/** 点击数值芯片：锁定 ⇄ 解锁；解锁后由"一键配平"自动计算 */
function toggleWeightLock(catId) {
  const st = S.wst; if (!st || !st[catId]) return;
  if (st[catId].v != null) { st[catId].v = null; }
  else { st[catId].v = weightShares().auto[catId] || 0; }
  syncWeightUI();
  vizUpdateLocal();
}
/** 计算当前分配：已锁定合计 + 未锁项平分剩余（末位吸收余数）；超出则未锁项记 0 */
function weightShares() {
  const st = S.wst || {};
  const ids = Object.keys(st);
  const lockedSum = ids.reduce((a, id) => a + (st[id].v ?? 0), 0);
  const unlocked = ids.filter(id => st[id].v == null);
  const auto = {};
  const remain = 100 - lockedSum;
  if (unlocked.length && remain >= 0) {
    const share = Math.floor(remain / unlocked.length);
    const rem = remain - share * unlocked.length;
    unlocked.forEach(id => { auto[id] = share; });
    auto[unlocked[unlocked.length - 1]] += rem;
  } else {
    unlocked.forEach(id => { auto[id] = 0; });
  }
  return { lockedSum, auto };
}
/** 一键配平：把所有未锁定（"自动"）项按剩余额度计算并锁定 */
function balanceFill() {
  const st = S.wst; if (!st) return;
  const { lockedSum, auto } = weightShares();
  const unlockedIds = Object.keys(st).filter(id => st[id].v == null);
  if (!unlockedIds.length) {
    if (lockedSum === 100) toast('全部已锁定，合计 100%');
    else toast('没有待配平项；请点击某个数值解锁，或拖动滑条调整', 'err');
    return;
  }
  if (lockedSum > 100) { toast('已锁定合计超过 100%，请先调低或解锁一项', 'err'); return; }
  unlockedIds.forEach(id => { st[id].v = auto[id] || 0; });
  toast('已锁定：' + unlockedIds.map(id => st[id].v + '%').join(' / '));
  syncWeightUI();
  vizUpdateLocal();
}
/** 空项存在时先自动配平（预览/保存前保证口径完整） */
function ensureBalanced() {
  if (!S.wst) return false;
  if (Object.keys(S.wst).some(id => S.wst[id].v == null)) { balanceFill(); return true; }
  return false;
}
function syncWeightUI() {
  if (!S.wst) return;
  const { lockedSum, auto } = weightShares();
  for (const [id, st] of Object.entries(S.wst)) {
    const unlocked = st.v == null;
    const v = unlocked ? (auto[id] || 0) : st.v;
    // 滑条与填充恒显示"生效值"（锁定值或自动预估值）；填充宽度由 CSS calc 从 --p 算出
    const slider = document.getElementById('s-' + id);
    if (slider) slider.value = v;
    const fill = document.getElementById('wf-' + id);
    if (fill) { fill.style.setProperty('--p', v); fill.classList.toggle('ws-auto', unlocked); }
    const chip = document.getElementById('wc-' + id);
    if (chip) {
      chip.classList.toggle('locked', !unlocked);
      chip.innerHTML = unlocked ? `<em>自动</em>${v}` : String(v);
      chip.title = unlocked ? '自动计算中，点击锁定该数值' : '已锁定，点击解锁交给自动配平';
    }
  }
  const t = document.getElementById('w-total');
  if (t) {
    const nAuto = Object.values(S.wst).filter(s => s.v == null).length;
    t.textContent = lockedSum > 100 ? `${lockedSum}%（超出 ${lockedSum - 100}%）` : (nAuto ? `100%（自动 ${nAuto} 项）` : '100%');
  }
  const line = document.getElementById('w-total-line');
  if (line) line.classList.toggle('text-red-500', lockedSum > 100);
}

function weightObj() {
  return Object.fromEntries(Object.entries(S.wst || {}).map(([id, s]) => [id, (s.v ?? 0) / 100]));
}
function vizUpdateLocal() {
  if (!S.wst) return;
  for (const [id, st] of Object.entries(S.wst)) {
    const v = Math.max(0, st.v == null ? 0 : st.v);
    const liq = document.getElementById('viz-liq-' + id);
    if (liq) liq.style.height = v + '%';
    const pct = document.getElementById('viz-pct-' + id);
    if (pct) pct.textContent = v + '%';
  }
}

function bindPage(page) {
  if (page === 'team' && S.sub.tab === 'create') { naModeToggle(); naTypeToggle(); }
  if (page === 'boss' && S.sub.tab === 'dist') {
    const id = S.sub.dist || (S.data.dists && S.data.dists[0] && S.data.dists[0].id);
    if (id) {
      const dd = (S.data.dists || []).find(x => x.id === id);
      if (dd && dd.status === 'confirmed') loadFrozen(id); else loadPreview(id);
    }
    syncWeightUI(); // DOM 就绪后初始化填充色
  }
}

async function loadFrozen(id) {
  const d = await api('GET', `/api/distributions/${id}/result`);
  if (!d.frozen) return;
  const snap = (JSON.parse(d.distribution.snapshot || '{}').stats) || {};
  const bind = d.pay_bind || { bound_count: d.items.length, total_count: d.items.length, unbound_names: [] };
  const pb = d.payout && d.payout.latest;
  const CHN = { manual: '线下转账', alipay: '支付宝批量付款', wechat: '微信商家转账' };
  const payoutBlock = `
    <div class="bg-green-50 border border-green-200 rounded-xl p-3 mb-3 text-xs text-green-700 flex items-center justify-between flex-wrap gap-2">
      <span>✅ 本方案已于 ${dt(d.distribution.confirmed_at)} 确认冻结，以下为不可变快照</span>
      <button class="cat-secondary text-xs px-3 py-1.5 rounded-lg" onclick="exportPayCsv('${d.distribution.id}')">导出支付清单 CSV</button>
    </div>
    <div class="cat-card rounded-2xl p-4 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-1.5">
        <h3 class="font-semibold text-gray-800 text-sm">💳 打款批次</h3>
        <span class="text-[11px] ${bind.bound_count === bind.total_count ? 'text-green-600' : 'text-orange-500'}">收款绑定 ${bind.bound_count}/${bind.total_count} 人${bind.bound_count < bind.total_count ? ' · ' + (bind.unbound_names || []).join('、') + ' 未绑定' : ''}</span>
      </div>
      <p class="text-[11px] text-gray-400 leading-relaxed mb-2.5">
        <span class="hidden md:inline">资金路径：公司进账 → 平台完成分账计算（本页快照，税后金额）→ 生成打款批次并下载对应平台批量付款文件 → 商户平台上传打款（或线下转账）→ 回执登记。成员在「我的资料」绑定收款方式。</span>
        <span class="md:hidden inline-flex items-center gap-2"><span>分账已完成，生成批量付款文件即可打款</span><button type="button" class="hint-q md:hidden" onclick="hintShow(0)">?</button></span>
      </p>
      ${pb ? `<div class="flex items-center justify-between flex-wrap gap-2 bg-gray-50 rounded-xl px-3 py-2 text-xs">
        <span>最近批次：${CHN[pb.channel] || pb.channel} · ${pb.item_count} 笔 · ${fmtMoney(pb.total_amount)} · ${pb.status === 'open' ? '<b class="text-orange-500">进行中</b>' : '<b class="text-green-600">已完成</b>'}</span>
        <span class="flex gap-1.5 flex-wrap">
          ${pb.status === 'open' ? `<button class="cat-btn text-xs px-3 py-1.5 rounded-lg" onclick="doPayoutSettle('${pb.id}')">回执：批次全员到账</button>` : ''}
          <button class="tab-btn text-xs px-3 py-1.5" onclick="location.href='/api/payout-batches/${pb.id}/export'">下载批次付款文件</button>
        </span>
      </div>` : `<button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="payoutModal('${d.distribution.id}')">生成打款批次</button>`}
    </div>`;
  const vizBlock = vizHtml(snap.pools || [], (snap.regular_pool || 0) + (snap.bonus_pool || 0));
  $('ds-result').innerHTML = `${payoutBlock}
    <div id="dist-viz" class="mb-4">${vizBlock}</div>
    <div class="rounded-xl p-3 mb-4 text-xs bg-gray-50">
      <span class="hidden md:inline">打款路径：生成打款批次 → 下载批量付款文件上传商户平台（或线下转账）→ 回执登记；逐笔状态可随时修正。走 API 自动打款需商户号与合规资质，接入点已预留。</span>
      <span class="md:hidden inline-flex items-center gap-2"><span>批量付款文件上传商户平台，回执登记</span><button type="button" class="hint-q md:hidden" title="查看说明" onclick="hintShow(0)">?</button></span>
    </div>
    <div class="cat-card rounded-2xl p-2 overflow-x-auto"><table class="tbl">
    <thead><tr><th>排名</th><th>成员</th><th>有效积分</th><th style="text-align:right">加权分红</th><th style="text-align:right">奖励</th><th style="text-align:right">税后应付</th><th>支付状态</th><th>备注/凭证</th></tr></thead>
    <tbody>${d.items.map(i => `<tr><td>${i.rank}</td><td class="font-medium">${esc(i.user_name)}</td><td>${fmt(i.base_points)}</td>
      <td style="text-align:right">${fmtMoney(i.weighted_amount)}</td><td style="text-align:right" class="text-green-600">${i.bonus_amount ? '+' + fmtMoney(i.bonus_amount) : '—'}</td>
      <td style="text-align:right" class="font-bold text-green-600">${fmtMoney(i.net_amount)}</td>
      <td>${i.pay_status === 'paid' ? '<span class="badge bg-green-100 text-green-700">已支付</span>' : '<span class="badge bg-yellow-100 text-yellow-700">待支付</span>'}
        <button class="text-xs underline ml-1 ${i.pay_status === 'paid' ? 'text-gray-400' : 'text-blue-600'}" onclick="markPay('${d.distribution.id}','${i.user_id}','${i.pay_status === 'paid' ? 'pending' : 'paid'}')">${i.pay_status === 'paid' ? '撤销' : '标记已付'}</button></td>
      <td><span class="text-xs ${i.pay_note ? 'text-gray-600' : 'text-gray-300'}">${esc(i.pay_note || '—')}</span></td></tr>`).join('')}</tbody></table></div>`;
}

/** 逐笔登记支付状态（仅顶层管理者，方案确认后） */
async function markPay(distId, userId, status) {
  try {
    const note = status === 'paid' ? (prompt('凭证/备注（如转账单号、日期，可留空）') || '') : '';
    await api('POST', `/api/distributions/${distId}/pay-mark`, { user_id: userId, pay_status: status, pay_note: note });
    toast(status === 'paid' ? '已登记为已支付' : '已撤销登记');
    loadFrozen(distId);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 打款批次：冻结 → 批量付款文件 → 回执 ---------- */
function payoutModal(distId) {
  openModal(`<h3 class="font-bold text-gray-800 mb-1">生成打款批次</h3>
  <p class="text-xs text-gray-400 mb-4">平台已完成分账计算（金额以冻结快照的税后金额为准）。选择通道后下载批量付款文件，上传到对应商户平台即可完成打款；打款完成后回此页登记回执。</p>
  <div class="space-y-2 mb-4">
    ${[['alipay', '支付宝批量付款', '下载批量付款文件（账号 + 实名校验）→ 商户平台上传'],
       ['wechat', '微信商家转账', '批量转账文件模板（走 API 自动打款需商户号与 openid 映射）'],
       ['manual', '线下转账（登记用）', '导出含收款账号的打款清单，线下转账后回此页登记回执']].map(([v, n, desc]) => `
      <label class="flex items-start gap-2.5 border rounded-xl p-3 cursor-pointer hover:bg-gray-50">
        <input type="radio" name="pb-channel" value="${v}" ${v === 'alipay' ? 'checked' : ''} class="!w-4 !h-4 mt-0.5">
        <span><b class="text-sm text-gray-700">${n}</b><br><span class="text-[11px] text-gray-400">${desc}</span></span>
      </label>`).join('')}
  </div>
  <button class="cat-btn w-full py-2.5 rounded-xl" onclick="doPayoutCreate('${distId}')">生成批次并下载付款文件</button>
  <p class="text-[11px] text-gray-400 text-center mt-2">批次快照会固化每人的收款账号与金额；生成后如需改账，请走冲正并重新确认分利。</p>`);
}
async function doPayoutCreate(distId) {
  const sel = document.querySelector('input[name="pb-channel"]:checked');
  try {
    const r = await api('POST', `/api/distributions/${distId}/payout`, { channel: sel ? sel.value : 'manual' });
    closeModal();
    toast(`批次已生成（${r.item_count} 笔），正在下载付款文件`);
    location.href = r.export_url;
    loadFrozen(distId);
  } catch (e) { toast(e.message, 'err'); }
}
function doPayoutSettle(batchId) {
  openModal(`<h3 class="font-bold text-gray-800 mb-2">登记批次回执</h3>
  <p class="text-xs text-gray-500 mb-3">确认该批次已在商户平台/线下完成全部打款：批次内所有条目将标记为"已支付"（个别异常仍可在下方清单里逐笔修正）。</p>
  <button class="bg-green-600 text-white w-full py-2 rounded-xl text-sm" onclick="doPayoutSettleGo('${batchId}')">确认全员到账</button>`);
}
async function doPayoutSettleGo(batchId) {
  try {
    const r = await api('POST', `/api/payout-batches/${batchId}/settle`, {});
    closeModal();
    toast(`已登记 ${r.paid} 笔到账`);
    go('boss', { tab: 'dist' });
  } catch (e) { toast(e.message, 'err'); }
}
/** 导出支付清单 CSV（Excel 友好，带 BOM） */
async function exportPayCsv(distId) {
  const d = await api('GET', `/api/distributions/${distId}/result`);
  const rows = [['排名', '成员', '有效积分', '基准分红', '加权分红', '头部奖励', '税前', '个税', '税后应付', '支付状态', '备注']];
  for (const i of d.items) rows.push([i.rank, i.user_name, i.base_points, i.base_amount, i.weighted_amount, i.bonus_amount, i.total_amount, i.tax_amount, i.net_amount, i.pay_status === 'paid' ? '已支付' : '待支付', i.pay_note || '']);
  const csv = '\uFEFF' + rows.map(r => r.map(v => '"' + String(v).split('"').join('""') + '"').join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '支付清单-' + d.distribution.name + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 暴露到全局（内联事件） */
Object.assign(window, { switchAuth, doAuth, quickLogin, doLogout, go, act, submitModal, doSubmit, enterOrg, backToOrgs,
  openJoinCard, doJoinCard, followOrg, openOrgWizard, wizGo, createOrg, baseGeoUse, bpPick, bpSet, bpRGB, bpLogo, bpLogoClear, saveBrand,
  reviewModal, doReview, rosterModal, proxyCheck, flagModal, doFlag, finishModal, doFinish, orgReviewModal,
  createActivity, createTask, importTSV, importCSVFile, createProject, addProjTask, doAddProjTask, claimTask, submitProjTask, doSubmitProjTask,
  onWeightSlide, toggleWeightLock, balanceFill, saveDist, loadPreview, confirmDist, doConfirmDist, newDistModal, createDist, changeRole, rebuildAgg, createOrgInvite, revokeOrgInvite, memberGovernance, memberInviteModal, createMemberInvite,
  calNav, calPick, geoCheck, qrCheckModal, doQCheck, qrModal, doQRotate, naModeToggle, naGeoUse, naGeoSearch, naGeoPick,
  claimThenSubmit, claimPlazaTask, tagPicker, tagAssign, tagCreate, tagDel, tpStart, tpEnd, markPay, exportPayCsv, undoBrand,
  tabDragStart, tabDrop, openLayoutModal, layToggle, layMove, layDrop, layReset,
  openProfile, profLogo, profLogoClear, saveProfile, closeModal, detailModal, refreshPage, hintShow ,
  renderSim, renderViz, saveDistSilent, parseTaskTable,
  /* VIP 固定工作流 · 个人空间与成果记录层 */
  renderMySpace, spaceGo, spaceHint, pinOutput, openRec, discoveryIntent, useNearby, registerDiscoveryActivity,
  feedbackModal, doFeedbackSave, dismissFeedback, fbStars,
  outputModal, outPickPhotos, outPickVideo, outDelMedia, outGpsToggle, doOutputSubmit,
  outputsModal, doOutputsConfirm,
  generateAnalysis, toggleBlock, moveBlock, copyCardText, downloadCardImage, openCardPublic,
  runReport, naTypeToggle, copyGrowthText,
  /* 支付批次 */
  payoutModal, doPayoutCreate, doPayoutSettle, doPayoutSettleGo,
  /* 世界侧栏与跨社区 */
  openOrgPreview, jumpNotice,
  /* 认证花标与授权绑定 */
  alipayAuthModal, doAlipayAuth, verifyModal, vfSearch, vfPick, doVerify,
  /* 发现社区 + 报表弹窗 + 转发 */
  showExplore, exploreFilter, expKw, reportModal, shareCardModal,
  /* 身份菜单 */
  toggleUserMenu, closeUserMenu,
  /* 任务库行操作 */
  toggleTaskStatus, taskDelete,
  /* 评价卡媒体 */
  fbPickPhotos, fbDelMedia,
  /* 身份菜单 */
  toggleUserMenu, closeUserMenu,
  /* 审核积分滑条 */
  rvSlider, rvNumOverride,
  /* 任务库表格直填 */
  gridRowInput, gridRowSave,
  /* 报表下载 */
  downloadCsv,
  /* 存钱罐 */
  addDeposit, undoLastDeposit, savePlanSet,
  toast, exchangeItem
});


/* ==================== 以下函数从误删区域恢复 ==================== */
function renderSim(sim, cats, distId) {
  const box = $('ds-result');
  if (!box) return;
  if (!sim.items.length) { box.innerHTML = `<div class="cat-card rounded-2xl p-8 text-center text-gray-400">${esc(sim.warnings[0] || '暂无数据')}</div>`; return; }
  box.innerHTML = `
  ${sim.warnings.length ? `<div class="bg-primary-soft border b-primary-soft rounded-xl p-3 mb-4 text-xs c-primary-deep space-y-1">
    ${sim.warnings.map(x => `<div>⚠ ${esc(x)}</div>`).join('')}</div>` : ''}
  <div class="rounded-xl p-3 mb-4 text-xs bg-gray-50 flex flex-wrap gap-x-6 gap-y-1">
    <span>奖励依据：总有效积分排行榜前 N 名</span>
    <span>机制：${sim.stats.bonus_mode === 'regular'
      ? `常规分配：头部合计 ${fmtMoney(sim.stats.bonus_pool)} 只领奖励金不参与分利，其余 ${sim.stats.regular_people} 人分常规池 ${fmtMoney(sim.stats.regular_pool)}`
      : `额外奖励：头部合计 ${fmtMoney(sim.stats.bonus_pool)} 叠加领取，全部 ${sim.stats.regular_people} 人分常规池 ${fmtMoney(sim.stats.regular_pool)}`}</span>
    <span>常规分利池：${fmtMoney(sim.stats.regular_pool)}</span>
    <span>预留未分配：${fmtMoney(sim.undistributed)}</span>
  </div>
  <div class="cat-card rounded-2xl p-2 overflow-x-auto"><table class="tbl">
    <thead><tr><th>排名</th><th>成员</th><th>有效积分</th><th style="text-align:right">基准(纯积分比例)</th><th style="text-align:right">加权后</th><th style="text-align:right">倍率</th><th style="text-align:right">头部奖励</th><th style="text-align:right">税前</th><th style="text-align:right">税后</th><th></th></tr></thead>
    <tbody>${sim.items.map(i => `<tr>
      <td>${i.rank <= 3 ? `<span class="rank-${i.rank} w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold inline-block">${i.rank}</span>` : i.rank}</td>
      <td class="font-medium">${esc(i.user_name)}</td><td>${fmt(i.base_points)}</td>
      <td style="text-align:right" class="text-gray-400">${fmtMoney(i.base_amount)}</td>
      <td style="text-align:right" class="font-bold">${i.in_regular === false ? '<span class="text-gray-300 text-xs">不参与</span>' : fmtMoney(i.weighted_amount)}</td>
      <td style="text-align:right" class="${i.multiplier > 1.5 ? 'text-red-500 font-bold' : 'text-gray-400'}">${Number.isFinite(i.multiplier) ? i.multiplier.toFixed(2) + '×' : '—'}</td>
      <td style="text-align:right" class="text-green-600">${i.bonus_amount ? '+' + fmtMoney(i.bonus_amount) : '—'}</td>
      <td style="text-align:right">${fmtMoney(i.total_amount)}</td>
      <td style="text-align:right" class="font-bold text-green-600">${fmtMoney(i.net_amount)}</td>
      <td><button class="text-blue-600 text-xs underline" onclick="detailModal(${escAttr(JSON.stringify(i))})">明细</button></td></tr>`).join('')}
    </tbody></table></div>
  <div class="text-xs text-gray-400 mt-2">倍率=加权后÷基准。倍率异常（>1.5×）说明任务难度已编码进积分、类目权重又放大了它——请核查分利类目设置。预留未分配：${fmtMoney(sim.undistributed)}</div>`;
  renderViz(sim);
}
function renderViz(sim) {
  const box = document.getElementById('dist-viz');
  if (!box) return;
  const pools = (sim.stats && sim.stats.pools) || [];
  const regularPool = sim.stats ? sim.stats.regular_pool : 0;
  const save = S._vizSave || null;
  box.innerHTML = vizHtml(pools, regularPool, true, save);
}

async function loadPreview(id) {
  if (!$('ds-total')) return; // 手机只读提示页没有草稿编辑表单。
  ensureBalanced();
  const weights = weightObj();
  const total = Number($('ds-total').value);
  const qs = `weights=${encodeURIComponent(JSON.stringify(weights))}&total=${total}`;
  const { simulation, cats, paysave } = await api('GET', `/api/distributions/${id}/preview?${qs}`);
  S._paysave = paysave;
  const dist = (S.data.dists || []).find(x => x.id === id);
  S._vizSave = paysave && paysave.deposits.length ? { deposited: paysave.deposited, target: dist ? dist.total_amount : 0 } : null;
  renderSim(simulation, cats, id);
  renderViz(simulation);
  renderSaveCard(id);
}
/** 存钱罐卡：进度节线 + 分笔存入 + 线性计划（草稿态） */
function renderSaveCard(id) {
  const box = $('save-card');
  if (!box) return;
  const ps = S._paysave;
  const dist = (S.data.dists || []).find(x => x.id === id);
  if (!ps || !dist) { box.innerHTML = ''; return; }
  const pct = Math.min(100, Math.round(ps.deposited / Math.max(dist.total_amount, 1) * 100));
  const cum = []; let acc = 0;
  for (const dp of ps.deposits) { acc += dp.amount; cum.push(Math.min(100, Math.round(acc / Math.max(dist.total_amount, 1) * 100))); }
  const planLine = ps.plan
    ? `<div class="text-[11px] ${ps.plan.behind > 0 ? 'text-orange-500' : 'text-green-600'} mb-2">线性计划：每天约存 ¥${fmt(ps.plan.per_day)} · 已过 ${ps.plan.elapsed_days} 天 · 应存 ¥${fmt(ps.plan.expected_by_now)}${ps.plan.behind > 0 ? '（落后 ¥' + fmt(ps.plan.behind) + '）' : ''} · <button type="button" class="underline" onclick="savePlanSet('${id}', 0)">取消计划</button></div>`
    : `<button type="button" class="text-[11px] underline text-gray-400 mb-2" style="padding:0;width:auto" onclick="savePlanSet('${id}', 30)">改用线性攒钱：按 30 天等分、周期提醒</button>`;
  box.innerHTML = `<div class="flex items-center justify-between mb-2">
      <h3 class="font-semibold text-gray-800 text-sm">🐷 存钱罐</h3>
      <span class="text-[10px] text-gray-400">目标 ¥${fmt(dist.total_amount)}</span>
    </div>
    <div class="relative h-5 rounded-full bg-gray-100 mb-1">
      <div class="h-full rounded-full transition-all duration-500" style="width:${pct}%;background:linear-gradient(90deg,#FBBF24,#F59E0B)"></div>
      ${cum.map((c2, i) => `<span class="absolute top-0 bottom-0 w-px bg-white/90" style="left:${c2}%"></span>`).join('')}
    </div>
    <div class="flex justify-between text-[11px] text-gray-400 mb-2"><span>已存 ¥${fmt(ps.deposited)}（${ps.deposits.length} 笔）</span><span>还差 ¥${fmt(ps.remaining)}</span></div>
    ${planLine}
    <div class="flex gap-1.5 mt-2">
      <input id="dep-amt" type="number" placeholder="存入金额" class="!w-24 text-center text-xs">
      <input id="dep-note" placeholder="备注（如：第一笔）" class="flex-1 text-xs">
      <button class="cat-btn px-3 rounded-lg text-xs flex-shrink-0" onclick="addDeposit('${id}')">存入</button>
    </div>
    ${ps.deposits.length ? `<button type="button" class="text-[11px] underline text-gray-400 mt-2" style="padding:0;width:auto" onclick="undoLastDeposit('${id}')">撤销最近一笔</button>` : ''}
    <p class="text-[10px] text-gray-400 mt-1.5">每存一笔，进度条前进一格并留一条节线——宏观看得出攒了多少次。</p>`;
}
async function addDeposit(id) {
  const amt = Number($('dep-amt') ? $('dep-amt').value : 0);
  const note = $('dep-note') ? $('dep-note').value.trim() : '';
  try {
    await api('POST', `/api/distributions/${id}/deposit`, { amount: amt, note });
    toast('已存入一笔，存钱罐前进了一格');
    await loadPreview(id);
  } catch (e) { toast(e.message, 'err'); }
}
async function savePlanSet(id, days) {
  try {
    const r = await api('PUT', `/api/distributions/${id}/save-plan`, { days });
    toast(days > 0 ? `线性攒钱计划已设置：每天约存 ¥${r.per_day}` : '线性攒钱计划已取消');
    await loadPreview(id);
  } catch (e) { toast(e.message, 'err'); }
}
async function undoLastDeposit(id) {
  try {
    await api('POST', `/api/distributions/${id}/undo-deposit`, {});
    toast('已撤销最近一笔存入');
    await loadPreview(id);
  } catch (e) { toast(e.message, 'err'); }
}
async function saveDist(id) {
  ensureBalanced();
  const total = Number($('ds-total').value);
  try {
    await api('PUT', `/api/distributions/${id}`, {
      total_amount: total, weights: weightObj(), bonus_top_n: Number($('ds-topn').value), bonus_amount: Number($('ds-bonus').value),
      bonus_mode: $('ds-bonusmode').value,
    });
    toast('已保存'); await go('boss', { tab: 'dist', dist: id });
  } catch (e) { toast(e.message, 'err'); }
}
async function saveDistSilent(id) {
  ensureBalanced();
  try {
    await api('PUT', `/api/distributions/${id}`, {
      total_amount: Number($('ds-total')?.value || 0), weights: weightObj(),
      bonus_top_n: Number($('ds-topn')?.value || 3), bonus_amount: Number($('ds-bonus')?.value || 0),
      bonus_mode: $('ds-bonusmode')?.value || 'extra',
    });
  } catch { /* 非草稿忽略 */ }
}
async function doConfirmDist(id) {
  ensureBalanced();
  try {
    await saveDistSilent(id);
    const r = await api('POST', `/api/distributions/${id}/confirm`);
    closeModal(); toast(`已冻结：${r.stats.people} 人参与分配`);
    await go('boss', { tab: 'dist', dist: id });
  } catch (e) { toast(e.message, 'err'); }
}
function confirmDist(id) {
  openModal(`<h3 class="font-bold text-gray-800 mb-2">确认并冻结分红方案</h3>
  <p class="text-xs text-gray-500 mb-3">确认后将按当前积分事实生成不可变快照：之后即使积分变动，本方案结果也不再改变（确认后不再提交）。</p>
  <button class="bg-green-600 text-white w-full py-2 rounded-xl text-sm" onclick="doConfirmDist('${id}')">我确认，生成快照</button>`);
}
function newDistModal() {
  openModal(`<h3 class="font-bold text-gray-800 mb-3">新建分红方案</h3>
  <div class="space-y-3">
    <input id="nd-name" placeholder="方案名称，如 2026年Q3分红">
    <input id="nd-total" type="number" placeholder="总金额（元）">
    <button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="createDist()">创建（草稿）</button></div>`);
}
async function createDist() {
  try {
    const { profit_categories: cats } = await api('GET', `/api/orgs/${S.org.id}/categories`);
    const weights = {};
    cats.forEach(c => weights[c.id] = c.default_weight ?? 0);
    const { id } = await api('POST', `/api/orgs/${S.org.id}/distributions`, {
      name: $('nd-name').value, total_amount: Number($('nd-total').value || 0), weights,
    });
    closeModal(); toast('已创建草稿'); await go('boss', { tab: 'dist', dist: id });
  } catch (e) { toast(e.message, 'err'); }
}
async function changeRole(userId, role) {
  try { await api('PUT', `/api/orgs/${S.org.id}/members`, { user_id: userId, role }); toast('角色已更新'); await go('boss', { tab: 'members', view: S.sub.view || 'list' }, true); }
  catch (e) { toast(e.message, 'err'); }
}
async function rebuildAgg() {
  try { await api('POST', `/api/orgs/${S.org.id}/rebuild`); toast('已由流水重建'); await go('boss', { tab: 'audit' }); }
  catch (e) { toast(e.message, 'err'); }
}

/* ---------- 导入：TSV/CSV → 批量导入接口 ---------- */
const CAT_ALIAS = { '媒体': 'media', '运营': 'ops', '项目': 'project', '资源': 'resource' };
function parseTaskTable(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].indexOf('\t') >= 0 ? '\t' : (lines[0].split(',').length >= 4 ? ',' : '\t');
  const cell = l => (sep === '\t' ? l.split('\t') : l.split(',')).map(x => String(x).trim().replace(/^"|"$/g, ''));
  let idx = { name: 0, cat: 1, min: 2, max: 3, slots: 4, freq: 5 };
  let start = 0;
  const head = cell(lines[0]);
  if (head.some(h => /名称|类别|积分/.test(h))) {
    start = 1;
    idx = {
      name: head.findIndex(h => h.includes('名称')),
      cat: head.findIndex(h => h.includes('类别')),
      min: head.findIndex(h => h.includes('下限')),
      max: head.findIndex(h => h.includes('上限')),
      slots: head.findIndex(h => h.includes('次数') || h.includes('名额')),
      freq: head.findIndex(h => h.includes('频率') || h.includes('说明')),
    };
  }
  const num = v => { const x = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return Number.isFinite(x) ? x : 0; };
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const c = cell(lines[i]);
    const name = c[idx.name] || '';
    const catRaw = c[idx.cat] || '';
    if (!name || !catRaw) continue;
    rows.push({
      name,
      category_code: CAT_ALIAS[catRaw] || catRaw,
      points_min: num(c[idx.min]),
      points_max: num(c[idx.max]) || num(c[idx.min]),
      slots: num(c[idx.slots]),
      frequency_note: c[idx.freq] || '',
    });
  }
  return rows;
}
async function importTSV() {
  const rows = parseTaskTable($('imp-tsv').value);
  if (!rows.length) return toast('没有解析到有效行（至少需要 任务名称 + 类别 两列）', 'err');
  try {
    const r = await api('POST', `/api/orgs/${S.org.id}/tasks/import`, { rows });
    toast(`导入完成：${r.imported} 条${r.skipped.length ? '，跳过 ' + r.skipped.length + ' 条' : ''}`);
    await go('team', { tab: 'library' });
  } catch (e) { toast(e.message, 'err'); }
}
function importCSVFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { $('imp-tsv').value = reader.result; importTSV(); };
  reader.readAsText(file, 'utf-8');
}

async function importCSVFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (/\.docx?$/i.test(file.name)) return importDocxFile(file);
  const reader = new FileReader();
  reader.onload = () => { $('imp-tsv').value = reader.result; importTSV(); };
  reader.readAsText(file, 'utf-8');
}

/** Word(.docx) 文件解析：零依赖（浏览器原生 DecompressionStream 解压 ZIP + DOMParser 解 XML），
 *  提取表格行与段落文本 → 自动填入导入框，老板不需要会复制粘贴操作。 */
async function importDocxFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/\.docx$/i.test(file.name)) return toast('请选择 .docx 文件（旧版 .doc 请先另存为 .docx）', 'err');
  toast('Word 解析中…', 'warn');
  try {
    const rows = await parseDocx(file);
    if (!rows.length) return toast('Word 里没识别到表格行——请确认表格列间有分列（或粘贴文本试试）', 'err');
    $('imp-tsv').value = rows.map(r => r.join('\t')).join('\n');
    toast(`已从 Word 提取 ${rows.length} 行，请核对后点「解析并导入」`);
    importTSV();
  } catch (e) { toast('Word 解析失败：' + e.message, 'err'); }
  input.value = '';
}

/** 从 .docx（ZIP 格式）中提取 word/document.xml 并解析表格文本 */
async function parseDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const xmlBuf = await extractZipEntry(buf, 'word/document.xml');
  if (!xmlBuf) throw new Error('不是有效的 .docx 文件');
  const xml = new DOMParser().parseFromString(
    new TextDecoder().decode(xmlBuf), 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // 表格行：w:tbl > w:tr > w:tc（每个格子取全部 w:t 文本拼接）
  const out = [];
  xml.getElementsByTagNameNS(ns, 'tbl').forEach(tbl => {
    tbl.getElementsByTagNameNS(ns, 'tr').forEach(tr => {
      const cells = [...tr.getElementsByTagNameNS(ns, 'tc')].map(tc =>
        [...tc.getElementsByTagNameNS(ns, 't')].map(t => t.textContent).join('').trim());
      if (cells.some(c => c)) out.push(cells);
    });
  });
  // 无表格时退化为段落文本（非空行按 tab 分列）
  if (!out.length) {
    xml.getElementsByTagNameNS(ns, 'p').forEach(p => {
      const line = [...p.getElementsByTagNameNS(ns, 't')].map(t => t.textContent).join('').trim();
      if (line && /\t|  {2,}|[，,]/.test(line)) out.push(line.split(/\t|[，,]/).map(s => s.trim()));
    });
  }
  return out;
}

/** 极简 ZIP 读取器（浏览器原生 DecompressionStream 解压 deflate-raw） */
async function extractZipEntry(buf, targetName) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let off = eocd + 22;
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== 0x02014b50) break;
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const nameBytes = buf.slice(off + 46, off + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    if (name === targetName) {
      const lhNameLen = dv.getUint16(localOff + 26, true);
      const lhExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      const method = dv.getUint16(localOff + 8, true);
      if (method === 0) return raw; // 无压缩
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([raw]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function toggleTaskStatus(id, next) {
  try { await api('PUT', `/api/tasks/${id}`, { status: next }); toast(next === 'published' ? '已上架' : '已下架'); await go('team', { tab: 'library' }, true); }
  catch (e) { toast(e.message, 'err'); }
}
async function taskDelete(id) {
  try { await api('DELETE', `/api/tasks/${id}`); toast('已删除'); await go('team', { tab: 'library' }, true); }
  catch (e) { toast(e.message, 'err'); }
}
/* ---------- 表格直填：填完一格自动加新行，行内保存/入库 ---------- */
function gridRowInput(inputEl) {
  const tr = inputEl.closest('tr');
  if (!tr) return;
  const tbody = tr.closest('tbody');
  if (tbody && tr === tbody.lastElementChild) {
    // 空行开始有内容 → 末尾克隆一行
    const next = tbody.lastElementChild;
    setTimeout(() => {
      const clone = next.cloneNode(true);
      clone.dataset.task = '';
      clone.classList.add('bg-yellow-50/40');
      clone.querySelectorAll('input').forEach(i => { i.value = ''; });
      const btn = clone.querySelector('button[class*=cat-btn]');
      if (btn) btn.setAttribute('onclick', `gridRowSave(null, this)`);
      tbody.appendChild(clone);
    }, 0);
  }
}
async function gridRowSave(taskId, btn) {
  const tr = btn.closest('tr');
  if (!tr) return;
  const inputs = tr.querySelectorAll('input');
  const name = inputs[0].value.trim();
  const mn = Number(inputs[1].value || 0), mx = Number(inputs[2].value || 0);
  const slots = Number(inputs[3].value || 0);
  const freq = inputs[4].value.trim();
  if (!name) return toast('请填写任务名称', 'err');
  const catId = tr.closest('table').dataset.cat;
  try {
    if (taskId) {
      await api('PUT', `/api/tasks/${taskId}`, { name, points_min: mn, points_max: Math.max(mn, mx), slots, frequency_note: freq, tx_category_id: catId });
      toast('已保存');
    } else {
      await api('POST', `/api/orgs/${S.org.id}/tasks`, { name, points_min: mn, points_max: Math.max(mn, mx), slots, frequency_note: freq, tx_category_id: catId, status: 'draft' });
      toast('草稿已入库，请补充任务与回报后发布');
    }
    await go('team', { tab: 'library' }, true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 分工标签选择器（自报 + 老板调整 + 删除撤销） ---------- */
function tagPicker(userId, current) {
  let tags = [];
  try { tags = JSON.parse(S.org.role_tags || '[]'); } catch { tags = []; }
  if (current && !tags.includes(current)) tags.push(current);
  const items = tags.map(t => `
    <button type="button" class="text-left w-full px-3 py-2 rounded-xl border ${t === current ? 'b-primary-soft bg-primary-soft c-primary-deep font-medium' : 'border-gray-100 bg-white text-gray-600'}"
      onclick="tagAssign('${userId}','${esc(t)}')"
      oncontextmenu="tagDel(event,'${esc(t)}');return false"
      ontouchstart="tpStart('${esc(t)}')" ontouchend="tpEnd()" ontouchmove="tpEnd()">
      🏷 ${esc(t)}${t === current ? ' <span class="text-[10px] text-gray-400">(当前)</span>' : ''}
      <span class="float-right text-[10px] text-gray-300">右键/长按删除</span>
    </button>`).join('');
  openModal(`<h3 class="font-bold text-gray-800 mb-1">设置分工</h3>
  <p class="text-xs text-gray-400 mb-3">分工由成员加入时自报，老板在此调整；也可新增本组织的分工标签。</p>
  <div class="space-y-1.5 mb-3">${items || '<p class="text-xs text-gray-400">暂无标签</p>'}</div>
  <div class="flex gap-2 items-center">
    <input id="tag-new" maxlength="12" placeholder="＋ 自定义新分工，回车确认" class="flex-1" onkeydown="if(event.key==='Enter')tagCreate('${userId}')">
    <button class="cat-secondary text-xs px-4 py-2 rounded-lg flex-shrink-0" onclick="tagCreate('${userId}')">＋ 自定义</button>
  </div>
  <p class="text-[10px] text-gray-300 mt-3">电脑：右键点击标签删除 · 手机：长按删除（误删可撤销）</p>`);
  setTimeout(() => $('tag-new')?.focus(), 100);
}
async function tagAssign(userId, tag) {
  try {
    await api('PUT', `/api/orgs/${S.org.id}/members`, { user_id: userId, role_tag: tag });
    closeModal(); toast(`分工已设为「${tag}」`);
    await go('boss', { tab: 'members', view: S.sub.view || 'list' }, true);
  } catch (e) { toast(e.message, 'err'); }
}
async function tagCreate(userId) {
  const v = $('tag-new').value.trim();
  if (!v) return toast('请填写分工名称', 'err');
  let tags = [];
  try { tags = JSON.parse(S.org.role_tags || '[]'); } catch { tags = []; }
  if (!tags.includes(v)) tags.push(v);
  try {
    await api('PUT', `/api/orgs/${S.org.id}/role-tags`, { tags });
    S.org.role_tags = JSON.stringify(tags);
    await tagAssign(userId, v);
  } catch (e) { toast(e.message, 'err'); }
}
let _tpTimer = null;
function tpStart(tag) { _tpTimer = setTimeout(() => tagDel(null, tag), 600); }
function tpEnd() { clearTimeout(_tpTimer); }
function tagDel(e, tag) {
  if (e && e.preventDefault) e.preventDefault();
  clearTimeout(_tpTimer);
  let tags = [];
  try { tags = JSON.parse(S.org.role_tags || '[]'); } catch { tags = []; }
  if (!tags.includes(tag)) return;
  const next = tags.filter(x => x !== tag);
  api('PUT', `/api/orgs/${S.org.id}/role-tags`, { tags: next }).then(() => {
    S.org.role_tags = JSON.stringify(next);
    toast(`已删除标签「${tag}」`, 'warn', '撤销', () => {
      let t2 = [];
      try { t2 = JSON.parse(S.org.role_tags || '[]'); } catch { t2 = []; }
      if (!t2.includes(tag)) t2.push(tag);
      api('PUT', `/api/orgs/${S.org.id}/role-tags`, { tags: t2 }).then(() => {
        S.org.role_tags = JSON.stringify(t2);
        toast(`已恢复「${tag}」`);
        go('boss', { tab: 'members', view: S.sub.view || 'list' }, true);
      });
    });
    go('boss', { tab: 'members', view: S.sub.view || 'list' }, true);
  }).catch(e2 => toast(e2.message, 'err'));
}

function detailModal(json) {
  const i = JSON.parse(json.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  openModal(`<h3 class="font-bold text-gray-800 mb-1">分利明细 · ${esc(i.user_name)}</h3>
  <p class="text-xs text-gray-400 mb-4">每一分钱都能回到具体事实</p>
  <table class="tbl mb-4"><thead><tr><th>类目</th><th>积分占比</th><th>权重</th><th style="text-align:right">所得</th></tr></thead>
  <tbody>${i.breakdown.map(b => `<tr><td>${esc(b.cat)}</td><td>${b.points}/${b.cat_total} = ${b.share}%</td><td>${Math.round(b.weight * 100)}%</td>
    <td style="text-align:right" class="font-medium">${fmtMoney(b.amount)}</td></tr>`).join('')}</tbody></table>
  <div class="space-y-1.5 text-sm">
    <div class="flex justify-between"><span class="text-gray-500">基础分红（加权）</span><b>${fmtMoney(i.weighted_amount)}</b></div>
    <div class="flex justify-between"><span class="text-gray-500">头部奖励（第${i.rank}名）</span><b class="text-green-600">${fmtMoney(i.bonus_amount)}</b></div>
    <div class="flex justify-between"><span class="text-gray-500">税前合计</span><b>${fmtMoney(i.total_amount)}</b></div>
    <div class="flex justify-between"><span class="text-gray-500">预估个税（20%）</span><b class="text-red-500">-${fmtMoney(i.tax_amount)}</b></div>
    <div class="flex justify-between border-t pt-2"><span class="text-gray-500">税后实得</span><b class="text-green-600 text-lg">${fmtMoney(i.net_amount)}</b></div>
  </div>
  <p class="text-[11px] text-gray-400 mt-3 text-center">模拟结果，实际以确认冻结的快照为准</p>`);
}


/* 分利瓶配色：与四类目积分色一致（媒体/运营/项目/资源） */
const VIZ_COLORS = ['#1565c0', '#6a1b9a', '#2e7d32', '#e65100'];
function vizHtml(pools, regularPool, small = false, save = null) {
  if (!pools || !pools.length) return '';
  const H = small ? 200 : 265;
  const bigW = small ? 64 : 86;
  const bigH = small ? 64 : 96;
  const poolH = small ? 96 : 128;
  const N = pools.length;
  const centers = pools.map((_, i) => ((i + 0.5) / N) * 100);
  const tubeTop = small ? 74 : 92;
  const tube = `<svg class="absolute left-0 w-full" style="top:${tubeTop}px;height:${small ? 40 : 56}px" viewBox="0 0 100 20" preserveAspectRatio="none">
    <path d="M 50 0 V 8" stroke="rgba(130,130,150,.45)" stroke-width="2.5" fill="none" vector-effect="non-scaling-stroke"/>
    <path d="M ${centers[0]} 8 H ${centers[N - 1]}" stroke="rgba(130,130,150,.45)" stroke-width="2.5" fill="none" vector-effect="non-scaling-stroke"/>
    ${centers.map(c => `<path d="M ${c} 8 V 19" stroke="rgba(130,130,150,.45)" stroke-width="2.5" fill="none" vector-effect="non-scaling-stroke"/>`).join('')}
  </svg>`;
  /* 大瓶 = 存钱罐：预定总额，分笔存入，液面成比例前进，每笔一道节线 */
  const savePct = save ? Math.min(100, Math.round(save.deposited / Math.max(save.target, 1) * 100)) : 100;
  const ticks = (save && save.ticks || []).map(t2 =>
    `<span class="absolute top-0 bottom-0 w-px bg-white/90" style="left:${t2}%;z-index:2"></span>`).join('');
  const big = `<div class="absolute" style="left:50%;transform:translateX(-50%);top:0;width:${bigW}px">
    <div class="relative rounded-b-2xl rounded-t-lg border-2 border-gray-300/80 bg-white/70 overflow-hidden shadow-inner" style="height:${bigH}px">
      <div class="absolute inset-x-0 bottom-0 transition-all duration-700" style="height:${save ? savePct : 100}%;background:linear-gradient(180deg,var(--hm-accent),var(--hm-accent-deep))"></div>
      ${ticks}
      <div class="absolute inset-0 flex items-center justify-center"><span class="text-white font-bold ${small ? 'text-sm' : 'text-lg'} drop-shadow">${save ? savePct + '%' : '100%'}</span></div>
    </div>
    <div class="text-[10px] text-gray-500 text-center mt-1">${save ? `存钱罐 · 已存 ¥${fmt(save.deposited)} / ¥${fmt(save.target)}` : `总池 ${fmtMoney(regularPool)}`}</div>
  </div>`;
  const bottles = pools.map((c, i) => {
    const color = VIZ_COLORS[i % VIZ_COLORS.length];
    const left = `calc(${centers[i]}% )`;
    return `<div class="absolute bottom-0" style="left:${left};transform:translateX(-50%);width:calc(88% / ${N})">
      <div class="relative rounded-b-2xl rounded-t-md border-2 border-gray-300/80 bg-white/70 overflow-hidden" style="height:${poolH}px">
        <div id="viz-liq-${c.id}" class="absolute inset-x-0 bottom-0 transition-all duration-700 ease-out" style="height:${c.share}%;background:linear-gradient(180deg,${color}CC,${color})"></div>
        <div class="absolute inset-0 flex items-center justify-center"><span id="viz-pct-${c.id}" class="font-bold ${small ? 'text-sm' : 'text-lg'}" style="color:${color};text-shadow:0 1px 2px rgba(255,255,255,.65)">${c.share}%</span></div>
      </div>
      <div class="text-[11px] text-gray-600 text-center mt-1 truncate" title="${esc(c.name)}">${esc(c.name)}</div>
      <div class="text-[10px] text-gray-400 text-center">天然 ${c.natural}%</div>
    </div>`;
  }).join('');
  return `<div class="relative mx-auto" style="height:${H}px;max-width:${small ? 420 : 720}px">
    ${big}${tube}${bottles}
  </div>
  <p class="text-[10px] text-gray-400 text-center mt-1">${save ? '存钱罐液面 = 已存入进度；下方小瓶 = 各分利池的分配比重。' : '拖动上方权重滑块，小瓶液面与百分比实时变化；"天然 x%" 为该池积分未加权时的天然份额。'}</p>`;
}

async function bossMembers() {
  const view = S.sub.view || 'list';
  if (view === 'migration') return bossMigration();
  const { members } = await api('GET', `/api/orgs/${S.org.id}/members`);
  let labels = {};
  try { labels = JSON.parse(S.org.role_labels || '{}'); } catch { labels = {}; }
  const rl = { owner: labels.owner || '顶层管理者', internal: labels.internal || '内部成员', participant: labels.participant || '大众参与者' };
  const sw = `<div class="flex items-center gap-2 mb-4">
    <button class="tab-btn ${view === 'list' ? 'active' : ''}" onclick="go('boss',{tab:'members',view:'list'})">列表</button>
    <button class="tab-btn ${view === 'tree' ? 'active' : ''}" onclick="go('boss',{tab:'members',view:'tree'})">组织架构图</button>
    <button class="tab-btn" onclick="go('boss',{tab:'members',view:'migration'})">入驻与邀请</button>
    <span class="text-[10px] text-gray-300 self-center">按排行榜顺序排列</span>
  </div>`;

  const tagChip = m => {
    const t = m.role_tag;
    return t
      ? `<button class="badge" style="background:var(--hm-primary-soft);color:var(--hm-primary-deep)" title="点击调整分工" onclick="tagPicker('${m.user_id}','${esc(t)}')">🏷 ${esc(t)}</button>`
      : `<button class="badge bg-gray-100 text-gray-400" onclick="tagPicker('${m.user_id}','')">＋ 分工</button>`;
  };
  const roleCell = m => `<select onchange="changeRole('${m.user_id}',this.value)" class="text-xs" style="padding:4px 8px;width:auto">
      ${['owner', 'internal', 'participant'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${rl[r]}</option>`).join('')}
    </select>`;
  // 修复：tip 此前被引用但未定义（打开成员与角色页会报 ReferenceError）
  const tip = `<div class="rounded-xl p-3 mt-3 text-xs bg-gray-50">
      <span class="hidden md:inline">分工：成员加入时自报，老板在此调整（右键/长按标签可删除）；位阶决定权限（顶层管理者＞内部成员＞大众参与者）；排序跟随排行榜（按有效积分）。</span>
      <span class="md:hidden inline-flex items-center gap-2"><span>分工自报 · 老板可调 · 位阶决定权限</span><button type="button" class="hint-q md:hidden" onclick="hintShow(1)">?</button></span>
    </div>`;

  if (view === 'tree') {
    const groups = [['owner', '🌳'], ['internal', '🌿'], ['participant', '🍃']];
    const tree = groups.map(([role, icon], gi) => {
      const list = members.filter(m => m.role === role);
      if (!list.length) return '';
      return `<div class="${gi ? 'ml-6 border-l-2 pl-4 ' : ''}mb-4" style="border-color:var(--hm-primary-faint)">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-bold c-primary-deep">${icon} ${rl[role]} <span class="text-xs text-gray-400 font-normal">${list.length} 人</span></span>
        </div>
        ${list.map(m => nodeHtml(m, gi, rl)).join('')}
      </div>`;
    }).join('');
    return sw + `<div class="cat-card rounded-2xl p-5">${tree || '<p class="text-sm text-gray-400">暂无成员</p>'}</div>` + tip;
  }
  /* 手机信息熵：宽表格 → 紧凑卡片行（分工/位阶调整保留可用） */
  if (isMobile()) {
    const cards = members.map(m => `<div class="m-row mb-2 flex items-center gap-3">
      ${m.avatar_url ? `<img src="${esc(m.avatar_url)}" class="w-9 h-9 rounded-full object-cover flex-shrink-0">` : `<span class="avatar w-9 h-9 text-xs flex-shrink-0" style="background:${m.avatar_color}">${esc(m.display_name[0])}</span>`}
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap"><span class="text-sm font-medium">${esc(m.display_name)}</span>${tagChip(m)}<button class="text-[10px] text-gray-400 underline" onclick="memberGovernance('${m.user_id}')">治理详情</button></div>
        <div class="text-[11px] text-gray-400 mt-0.5">${fmt(m.total_points)} ${S.org.currency_name} · ${dOnly(m.created_at)}</div>
      </div>
      ${roleCell(m)}
    </div>`).join('');
    return sw + `<div>${cards}</div>` + tip;
  }
  const rows = members.map((m, i) => `<tr>
    <td><span class="inline-flex items-center gap-2">${m.avatar_url ? `<img src="${esc(m.avatar_url)}" class="w-7 h-7 rounded-full object-cover">` : `<span class="avatar w-7 h-7 text-[10px]" style="background:${m.avatar_color}">${esc(m.display_name[0])}</span>`}${esc(m.display_name)}</span><button class="text-[10px] text-gray-400 underline ml-1" onclick="memberGovernance('${m.user_id}')">治理详情</button></td>
    <td>${tagChip(m)}</td>
    <td>${roleCell(m)}</td>
    <td class="font-bold c-primary">${fmt(m.total_points)}</td>
    <td class="text-gray-400 text-xs">${i + 1}</td>
    <td class="text-gray-400 text-xs">${dOnly(m.created_at)}</td></tr>`).join('');
  return sw + `<div class="cat-card rounded-2xl p-2 overflow-x-auto"><table class="tbl">
  <thead><tr><th>成员</th><th>分工（自报 · 老板可调）</th><th>位阶</th><th>${S.org.currency_name}</th><th>排行</th><th>加入</th></tr></thead>
  <tbody>${rows}</tbody></table></div>` + tip;
}
async function bossMigration() {
  const { invites } = await api('GET', `/api/orgs/${S.org.id}/invites`);
  const active = invites.filter(i => !i.revoked_at && i.uses < i.max_uses && new Date(i.expires_at) > new Date());
  const rows = invites.map(i => `<div class="border-b last:border-0 py-2.5 text-xs flex gap-2 items-start">
    <div class="min-w-0 flex-1"><b>${esc(i.label)}</b> <span class="text-gray-400">${i.kind === 'migration' ? '迁移' : i.kind === 'seed' ? '核心成员' : '成员邀请'}</span>
      <div class="text-gray-500 mt-1 break-all">${esc(i.code)} · ${i.uses}/${i.max_uses} 已认领 · ${dOnly(i.expires_at)} 到期${i.grant_invite_right ? ' · 认领者可再邀请' : ''}</div></div>
    ${i.revoked_at ? '<span class="text-gray-400">已撤销</span>' : `<button class="tab-btn text-xs" onclick="revokeOrgInvite('${i.id}')">撤销</button>`}
  </div>`).join('') || '<p class="text-sm text-gray-400">还没有邀请。先用“迁移首批成员”建立组织骨干。</p>';
  return `<div class="flex items-center gap-2 mb-4"><button class="tab-btn" onclick="go('boss',{tab:'members',view:'list'})">成员列表</button><button class="tab-btn active">入驻与邀请</button></div>
  <div class="cat-card rounded-2xl p-5 mb-4"><h3 class="font-bold text-gray-800">把已有组织搬进来</h3>
    <p class="text-xs text-gray-500 mt-1 mb-4">先创建可撤销的认领邀请，再由成员自己确认加入；不会因一张名单被强制写入成员名册。</p>
    <div class="grid md:grid-cols-2 gap-3 text-sm"><label>邀请用途<input id="oi-label" placeholder="如：2026 秋季首批成员"></label><label>入驻方式<select id="oi-kind"><option value="migration">迁移首批成员</option><option value="seed">核心成员</option><option value="member">普通成员邀请</option></select></label><label>认领后身份<select id="oi-role"><option value="participant">大众参与者</option><option value="internal">内部成员</option></select></label><label>可认领人数<input id="oi-max" type="number" min="1" max="1000" value="20"></label><label>有效天数<input id="oi-days" type="number" min="1" max="365" value="30"></label></div>
    <label class="text-xs text-gray-600 flex items-center gap-2 mt-3"><input id="oi-right" type="checkbox">认领者也可邀请成员（建议只给可信骨干）</label>
    <button class="cat-btn px-4 py-2 mt-4" onclick="createOrgInvite()">生成邀请</button></div>
  <div class="cat-card rounded-2xl p-5"><div class="flex items-center justify-between"><h3 class="font-bold text-gray-800">邀请记录</h3><span class="text-xs text-gray-400">当前有效 ${active.length} 条</span></div><p class="text-[11px] text-gray-400 my-2">邀请码只在本治理页显示；成员公开名册与个人主页不展示邀请关系。</p>${rows}</div>`;
}
async function createOrgInvite() {
  try {
    const r = await api('POST', `/api/orgs/${S.org.id}/invites`, { label: $('oi-label').value, kind: $('oi-kind').value, role: $('oi-role').value, max_uses: Number($('oi-max').value), expires_in_days: Number($('oi-days').value), grant_invite_right: $('oi-right').checked });
    openModal(`<h3 class="font-bold text-gray-800 mb-2">邀请已生成</h3><p class="text-sm text-gray-500 mb-3">只把这条链接发给应当进入组织的人；如需停止，随时在“邀请记录”撤销。</p><input readonly value="${location.origin}/?invite=${esc(r.code)}" onclick="this.select()"><p class="text-xs text-gray-400 mt-2">邀请码：${esc(r.code)} · ${r.max_uses} 个名额</p>`);
    await go('boss', { tab: 'members', view: 'migration' }, true);
  } catch (e) { toast(e.message, 'err'); }
}
function memberInviteModal(orgId) {
  S._memberInviteOrg = orgId;
  openModal(`<h3 class="font-bold text-gray-800 mb-2">邀请成员</h3><p class="text-sm text-gray-500 mb-3">你的邀请只授予普通成员身份，不会把管理权交出去；邀请关系只在组织治理时按人查看。</p><label>邀请说明<input id="mi-label" placeholder="如：一起做活动的伙伴"></label><label class="block mt-3">可认领人数<input id="mi-max" type="number" min="1" max="20" value="1"></label><button class="cat-btn px-4 py-2 mt-4" onclick="createMemberInvite()">生成邀请链接</button>`);
}
async function createMemberInvite() {
  try {
    const r = await api('POST', `/api/orgs/${S._memberInviteOrg}/invites`, { label: $('mi-label').value, max_uses: Number($('mi-max').value), expires_in_days: 30 });
    openModal(`<h3 class="font-bold text-gray-800 mb-2">邀请已生成</h3><p class="text-sm text-gray-500 mb-3">只发给你愿意带进组织、一起做事的人；30 天内有效，可由组织负责人撤销。</p><input readonly value="${location.origin}/?invite=${esc(r.code)}" onclick="this.select()"><p class="text-xs text-gray-400 mt-2">${r.max_uses} 个名额</p>`);
  } catch (e) { toast(e.message, 'err'); }
}
async function revokeOrgInvite(inviteId) {
  try { await api('DELETE', `/api/orgs/${S.org.id}/invites/${inviteId}`); toast('邀请已撤销'); await go('boss', { tab: 'members', view: 'migration' }, true); } catch (e) { toast(e.message, 'err'); }
}
async function memberGovernance(userId) {
  try {
    const { member: m } = await api('GET', `/api/orgs/${S.org.id}/members/${userId}/governance`);
    const source = m.entry_type === 'founder' ? '组织创建者' : m.entry_type === 'invite' ? '邀请码认领' : '自行加入';
    openModal(`<h3 class="font-bold text-gray-800">成员治理详情</h3><p class="text-xs text-gray-400 mt-1 mb-4">仅 Owner 可见。用于处理具体问题，不在日常成员页公开。</p><dl class="task-agreement"><dt>入驻方式</dt><dd>${source}</dd><dt>直接邀请人</dt><dd>${esc(m.issuer_name || '无')}</dd><dt>最初邀请来源</dt><dd>${esc(m.root_issuer_name || m.issuer_name || '组织创建')}</dd><dt>邀请标签</dt><dd>${esc(m.invite_label || '—')}</dd><dt>审核/确认人</dt><dd>${esc(m.approved_by_name || '—')}</dd><dt>加入时间</dt><dd>${dOnly(m.created_at)}</dd><dt>邀请权限</dt><dd>${m.can_invite ? '可邀请成员' : '无'}</dd><dt>其发出邀请 / 已认领</dt><dd>${m.issued_invites} / ${m.claimed_invites}</dd></dl>`);
  } catch (e) { toast(e.message, 'err'); }
}
function nodeHtml(m, depth, rl) {
  return `<div class="flex items-center gap-2 py-1.5">
    ${m.avatar_url ? `<img src="${esc(m.avatar_url)}" class="w-7 h-7 rounded-full object-cover">` : `<span class="avatar w-7 h-7 text-[10px]" style="background:${m.avatar_color}">${esc(m.display_name[0])}</span>`}
    <span class="text-sm font-medium">${esc(m.display_name)}</span>
    ${m.role_tag ? `<span class="badge bg-primary-soft c-primary-deep text-[10px]">${esc(m.role_tag)}</span>` : ''}
    <select onchange="changeRole('${m.user_id}',this.value)" class="text-xs ml-2" style="padding:3px 8px;width:auto">
      ${['owner', 'internal', 'participant'].map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${rl[r]}</option>`).join('')}
    </select>
  </div>`;
}
async function bossAudit() {
  const { logs } = await api('GET', `/api/orgs/${S.org.id}/audit?limit=150`);
  const integ = await api('GET', `/api/orgs/${S.org.id}/integrity`);
  const i = integ.integrity[0] || {};
  const okData = i.consistent && integ.approved_submissions_missing_ledger === 0;
  /* 老板友好的报表导出（CSV，Excel 直接打开） */
  const reportCard = `<div class="cat-card rounded-2xl p-5 mb-4">
    <h3 class="font-semibold text-gray-800 text-sm mb-1">📊 报表导出</h3>
    <p class="text-[11px] text-gray-400 mb-3">Excel 可直接打开的数据文件——发给会计、做汇报、存档都行。</p>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      ${[['members', '👥 成员名单', '名单 + 身份 + 积分'],
         ['points', '💰 积分流水', '每一笔积分变动明细'],
         ['activities', '📅 活动记录', '每场活动的到场数据'],
         ['audit', '🛡 操作日志', '最近 500 条操作记录']].map(([t, label, desc]) => `
        <button class="text-left cat-card rounded-xl p-3 hover:shadow-sm transition" onclick="downloadCsv('${t}')">
          <div class="text-xs font-bold text-gray-700 mb-0.5">${label}</div>
          <div class="text-[10px] text-gray-400">${desc}</div>
        </button>`).join('')}
    </div>
  </div>`;
  /* 数据安全体检：老板需要确认"数据没丢没被改" */
  const integrityCard = `<div class="cat-card rounded-2xl p-5 mb-4">
    <h3 class="font-semibold text-gray-800 text-sm mb-3">🛡 数据安全体检</h3>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
      <div class="p-3 bg-gray-50 rounded-xl"><div class="text-xs text-gray-400">积分流水条数</div><div class="font-bold text-lg">${i.ledger_rows ?? 0}</div></div>
      <div class="p-3 bg-gray-50 rounded-xl"><div class="text-xs text-gray-400">流水合计</div><div class="font-bold text-lg">${fmt(i.ledger_sum ?? 0)}</div></div>
      <div class="p-3 bg-gray-50 rounded-xl"><div class="text-xs text-gray-400">聚合缓存合计</div><div class="font-bold text-lg">${fmt(i.cache_sum ?? 0)}</div></div>
      <div class="p-3 rounded-xl ${okData ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}">
        <div class="text-xs opacity-70">一致性</div><div class="font-bold text-lg">${okData ? '✓ 通过' : '✗ 异常'}</div></div>
    </div>
    <p class="text-[11px] text-gray-400 mt-2.5">${okData
      ? '✅ 数据安全：每一笔积分都有据可查，任何改动都会留痕。数据每天自动备份 30 份。'
      : '⚠️ 数据出现异常！请截图联系技术支持。'}</p>
    <details class="mt-3"><summary class="text-[11px] text-gray-400 cursor-pointer select-none">技术操作（备份数据文件 / 修复缓存）</summary>
      <div class="flex flex-wrap gap-2 mt-2">
        <button class="cat-secondary px-4 py-2 rounded-xl text-xs" onclick="downloadCsv('full')">导出全量数据备份（JSON）</button>
        <button class="tab-btn text-xs" onclick="rebuildAgg()">由流水重建缓存</button>
      </div>
      <p class="text-[10px] text-gray-300 mt-1">这两项是技术人员用的，平时不需要碰。</p>
    </details>
  </div>`;
  /* 操作日志：收进抽屉，完整数据在 "审计日志" 里 */
  const logBlock = `<div class="cat-card rounded-2xl p-2 overflow-x-auto">
    <h3 class="font-semibold text-gray-800 text-sm p-3">操作日志（只追加 · 不可篡改 · 每条留痕）</h3>
    <table class="tbl"><thead><tr><th>时间</th><th>操作者</th><th>做了什么</th><th>详情</th></tr></thead>
    <tbody>${logs.map(l => `<tr><td class="text-gray-400 whitespace-nowrap text-xs">${dt(l.ts)}</td>
      <td class="text-xs">${esc(l.actor_name)}</td>
      <td class="text-xs font-medium">${esc(l.action)}</td>
      <td class="text-xs text-gray-400 truncate max-w-xs" title="${esc(l.detail)}">${esc((l.detail || '').slice(0, 60))}</td></tr>`).join('')}</tbody></table>
  </div>`;
  return `
  ${integrityCard}
  ${reportCard}
  ${mCollapse(`操作日志 · 最近 ${logs.length} 条<span class="cnt">只追加 · 不可篡改</span>`, logBlock)}`;
}
function downloadCsv(type) {
  if (type === 'full') { location.href = `/api/orgs/${S.org.id}/export`; return; }
  location.href = `/api/orgs/${S.org.id}/export-csv/${type}`;
}



/* ====================================================================
   VIP 固定工作流 · 个人空间（参与端平行架构）与成果记录层
   《VIP服务工作流设计.md》：免费层（我的成果/已参与/反馈/报表）+ VIP 三工作流
   ==================================================================== */
const TYPE_CN = { watch: '观看参与', hands_on: '动手实践', output: '临场产出' };
const SPACE_TABS = [['discover', '', '发现'], ['feed', '🪙', '成果'], ['joined', '📅', '参与'], ['assets', '💰', '收益'], ['orgs', '🏘', '社区']];

/** 个人空间：登录后与 ⇄ 返回时的默认落地页（社区平行显现，组织卡在下方） */
async function renderMySpace() {
  const el = $('space-top');
  if (!el) return;
  if (!S.user) { el.innerHTML = '<div class="discovery-top"><b>花猫 · 共创社区</b><button class="tab-btn" onclick="showView(&quot;auth&quot;)">登录 / 注册</button></div>' + await discoveryHtml(); return; }
  el.innerHTML = '<div class="text-center text-gray-400 py-10 text-sm">加载我的空间…</div>';
  let d;
  try { d = await api('GET', '/api/me/space'); }
  catch (e) {
    if (e.status === 401) { showView('auth'); return; }
    el.innerHTML = `<div class="cat-card rounded-2xl p-6 text-sm text-red-500">${esc(e.message)}<br><br><button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="location.reload()">刷新重试</button></div>`;
    return;
  }
  S.space = d;
  await refreshNotices(); // 待办卡与侧栏徽标数据
  const tab = S.spaceTab || 'discover';
  const tabs = SPACE_TABS.map(([k, icon, n]) =>
    `<button class="tab-btn whitespace-nowrap ${tab === k ? 'active' : ''}" onclick="spaceGo('${k}')"><span class="hidden sm:inline">${icon} </span>${n}</button>`).join('');
  /* 跨组织待办（触发式卡片）：只聚合"你选择了的事"，点击直达对应世界 */
  let todoHtml = '';
  const nt = S.notices;
  if (nt && nt.total > 0) {
    const nameOf = orgId => { const m = (S.memberships || []).find(x => x.org_id === orgId); return m ? m.name : ''; };
    const rows = [];
    for (const [oid, o] of Object.entries(nt.orgs)) for (const it of o.items) rows.push({ oid, ...it });
    todoHtml = `<div class="rounded-2xl p-4 mb-4" style="background:var(--hm-primary-soft)">
      <h3 class="text-sm font-bold c-primary-deep mb-2">🔔 等你处理 · ${nt.total} 件</h3>
      <div class="space-y-1.5">${rows.slice(0, 5).map(r => `
        <button class="w-full text-left flex items-center justify-between gap-2 bg-white/85 rounded-xl px-3 py-2 hover:shadow-sm transition" onclick="jumpNotice('${r.oid}','${r.page}',${escAttr(JSON.stringify(r.sub || {}))})">
          <span class="min-w-0 text-xs text-gray-700 truncate"><b class="c-primary-deep">${esc(nameOf(r.oid))}</b> · ${esc(r.title)}</span>
          <span class="text-[11px] c-primary flex-shrink-0">去处理 ›</span>
        </button>`).join('')}
      ${rows.length > 5 ? `<p class="text-[11px] text-gray-400 px-1">还有 ${rows.length - 5} 件在各社区内查看</p>` : ''}
      </div>
    </div>`;
  }
  let body = '';
  try { body = await spaceTabHtml(tab); }
  catch (e) { body = `<div class="cat-card rounded-2xl p-6 text-sm text-red-500">${esc(e.message)}</div>`; }
  el.innerHTML = `
  ${tab === 'discover' ? `<header class="discovery-top"><b>花猫 · 共创社区</b><button class="tab-btn" onclick="toggleUserMenu()">${esc(S.user.display_name)} · 我的账户</button></header>` : `  <div class="cat-card rounded-2xl p-4 mb-4 flex items-center gap-4 flex-wrap cursor-pointer hover:shadow-md transition" onclick="openProfile()" title="编辑资料 · 收款方式 · 退出登录">
    <div class="avatar w-14 h-14 text-lg flex-shrink-0 overflow-hidden" style="background:${S.user.avatar_url ? 'transparent' : S.user.avatar_color}">
      ${S.user.avatar_url ? `<img src="${esc(S.user.avatar_url)}" class="w-full h-full object-cover rounded-full">` : esc(S.user.display_name[0])}
    </div>
    <div class="min-w-0 flex-1">
      <div class="font-bold text-gray-800 text-lg">${esc(S.user.display_name)}<span class="text-xs text-gray-400 font-normal ml-2">的个人空间</span></div>
      <div class="text-xs text-gray-400 mt-0.5">${d.counts.communities} 个社区 · ${d.counts.confirmed_items} 条已确认成果${d.counts.pending_outputs ? ` · ${d.counts.pending_outputs} 条待确认` : ''} · 跨社区保留你的贡献</div>
    </div>
    <div class="flex flex-col gap-1 flex-shrink-0 text-[11px]">
      <button type="button" class="underline text-gray-400" style="padding:0;width:auto" onclick="event.stopPropagation();openProfile()">编辑资料 ›</button>
      <button type="button" class="underline text-red-400" style="padding:0;width:auto" onclick="event.stopPropagation();doLogout()">退出登录</button>
    </div>
  </div>
`}
  ${tab === 'discover' ? '' : todoHtml}
  <div class="sticky top-0 z-20 -mx-4 px-4 py-2 space-tabs" style="background:var(--hm-cream)">
    <div class="flex gap-1.5 overflow-x-auto pb-1 items-center">${tabs}
      <button type="button" class="hint-q" title="这里是什么？" onclick="spaceHint()">?</button>
    </div>
  </div>
  <div id="space-body">${body}</div>`;
  // 社区/发现两个标签的容器由本函数挂载后再填充组织卡片
  if (tab === 'orgs') await renderOrgs();
}
/** 推荐卡一点击切入：已加入的直接进社区；没加入的打开加入卡片 */
function openRec(orgId, myOrg) {
  if (myOrg) enterOrg(orgId);
  else openJoinCard(orgId);
}
function spaceGo(tab) { S.spaceTab = tab; window.scrollTo(0, 0); return renderMySpace(); }
function spaceHint() {
  openModal(`<h3 class="font-bold text-gray-800 mb-2">这里是什么？</h3>
  <div class="text-sm text-gray-600 leading-relaxed space-y-2">
    <p><b>这里是你参与过的活动与你掌握的技能。</b></p>
    <p>它不是朋友圈：不发感想、不闲聊，只沉淀确认过的事实——完成的任务、现场的产出、参加过的每一场活动。</p>
    <p><b>发现</b>：浏览各社区的开放活动和公开任务，不必先加入社区。</p><p><b>🪙 成果</b>：你的产出流 + 成果与参与分析（画像文档，可转发）+ 导出分类报表。</p>
    <p><b>📅 参与</b>：参加过的所有活动、评价找回，以及按你的参与分析推荐的发现活动。</p>
    <p><b>🏘 社区</b>：我的组织、创建组织、发现社区。它是你的个人数字资产：中性、不带任何社区烙印、跨社区随身携带。</p>
    <p class="text-[11px] text-gray-400">小提示：各社区积分含金量不同，跨社区只看趋势不比高低；社区内部才可与成员比较。</p>
  </div>`);
}
async function spaceTabHtml(tab) {
  if (tab === 'discover') return discoveryHtml();
  if (tab === 'feed' || tab === 'assets') return await spaceFeed(tab === 'assets');
  if (tab === 'joined') return (await publicWorkHtml()) + await spaceJoined();
  if (tab === 'orgs') return spaceOrgs();
  return '';
}
/* 社区标签：组织卡片 + 创建组织 + 退出登录——掌控感三件套，一触即达 */
function spaceOrgs() {
  return `<div class="flex items-center justify-between mb-1">
      <h3 class="font-semibold text-gray-800">我的社区</h3>
      <button class="tab-btn" onclick="openOrgWizard()">＋ 创建社区</button>
    </div>
    <p class="text-[11px] text-gray-400 mb-3">进入一个社区，专注这里的人和事；也可以随时从顶部切换。</p>
    <label class="text-sm block mb-3">默认打开<select aria-label="默认打开" onchange="setHomeOrg(this.value)"><option value="">全局发现</option>${S.memberships.map(m=>`<option value="${m.org_id}" ${S.user.home_org_id===m.org_id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    <div id="my-orgs" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-6"></div>
    ${spaceDiscover()}
    <p class="text-[11px] text-gray-400 mb-3">就算哪天离开一个社区，在这里确认过的成果依然留在你的个人空间。</p>
    <button class="text-sm text-red-500 bg-white border border-red-200 rounded-xl px-4 py-2" onclick="doLogout()">退出登录</button>`;
}
function spaceDiscover() {
  return `<div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-gray-800">发现社区</h3>
      <button class="text-xs underline" style="color:var(--hm-primary)" onclick="showExplore()">探索全部（搜索 + 标签）›</button>
    </div>
    <div id="all-orgs" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3"></div>`;
}

/* ---------- 我的成果：时间线不分类（自然延展），置顶代表作 ---------- */
async function spaceFeed(assetsOnly = false) {
  const d = S.space;
  /* 资产总览：按社区分解——积分含金量各社区不同，总积分只是平台性记录（象征阶梯）；
     每个社区一块：币种/总积分/该社区等级进度/全维度构成（含 0 分空槽，提示"有空去填"） */
  const A = d.asset;
  const assetCard = `<div class="cat-card rounded-2xl p-5 mb-4">
    <div class="flex items-start justify-between gap-2 flex-wrap mb-3">
      <h3 class="font-semibold text-gray-800 text-sm">💰 资产总览 · 各社区积分</h3>
      <span class="text-[10px] text-gray-400 text-right leading-snug">跨社区积分含金量不同，不直接比较<br>总积分是平台性的记录（象征阶梯）</span>
    </div>
    <div class="text-center mb-4 pb-4 border-b border-gray-100">
      <div class="text-3xl font-bold c-primary">${fmt(A.total_points)}</div>
      <div class="text-xs text-gray-400 mt-0.5">平台总积分 · 等级 ${A.level.level}</div>
    </div>
    ${(A.by_org || []).map(o => {
      const maxC = Math.max(...o.categories.map(c => c.points), 1);
      return `<div class="border border-gray-100 rounded-xl p-3.5 mb-3" style="border-left:3px solid ${o.theme_color}">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-bold text-gray-700 truncate">${esc(o.org_name)} <span class="text-[10px] text-gray-400 font-normal">· 积分叫「${esc(o.currency_name)}」</span></span>
        <span class="text-sm font-bold flex-shrink-0" style="color:${o.theme_color}">${fmt(o.points)}</span>
      </div>
      <div class="flex items-center gap-2 mb-2.5">
        <div class="progress-bar flex-1"><div class="progress-fill" style="width:${o.level.progress}%"></div></div>
        <span class="text-[10px] text-gray-400 flex-shrink-0">${o.level.level}${o.level.next_level ? ' · 距下一级 ' + fmt(o.level.points_to_next) : ' · 已满级'}</span>
      </div>
      <div class="space-y-1.5">${o.categories.map(c => `
        <div><div class="flex justify-between text-[10px] mb-0.5"><span style="color:${c.points > 0 ? c.color : '#b9b0a0'}">${esc(c.name)} · ${c.count} 次</span><span class="font-semibold" style="color:${c.points > 0 ? c.color : '#b9b0a0'}">${c.points > 0 ? fmt(c.points) : '待填'}</span></div>
        <div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${Math.round(c.points / maxC * 100)}%;${c.points > 0 ? 'background:' + c.color : 'background:#e8e1d3'}"></div></div></div>`).join('')}
      </div>
    </div>`;
    }).join('')}
  </div>`;
  /* 融合：成果分析（优势/规避）与参与分析（兴趣）的画像文档直接长在成果页，不单独设板块 */
  const analysisHtml = assetsOnly ? '' : await spaceAnalysis();
  /* 工资条：跨社群分利到账明细 + 三组统计（融合在成果页，跟在资产总览后面） */
  let payslipHtml = '';
  try {
    const ps = await api('GET', '/api/me/payslip');
    if (ps.entries.length) payslipHtml = payslipHtmlInner(ps);
  } catch (e) { payslipHtml = ''; }
  if (assetsOnly) return `<div class="work-heading"><h2>贡献与收益</h2><p>各社区分别记账，积分与实际到账分开查看。</p></div>` + assetCard + (payslipHtml || '<div class="cat-card rounded-2xl p-6 text-sm text-gray-500">还没有分利记录。已确认的收益会显示在这里。</div>');
  const head = `<div class="flex items-center justify-between mb-3">
    <h3 class="font-semibold text-gray-800">我的成果</h3>
    <button class="text-xs underline" style="color:var(--hm-primary)" onclick="reportModal()">导出分类报表 ›</button>
  </div>`;
  if (!d.feed.length) {
    const a = d.analysis;
    return head + assetCard + payslipHtml + analysisHtml + `<div class="cat-card rounded-2xl p-8 text-center text-gray-400 text-sm">
      还没有已确认的成果。完成任务、参加带<b>产出登记</b>的活动，成果会自动沉淀到这里。<br><br>
      <span class="text-xs">画像分析进度：${a.confirmed_count} / ${a.threshold} 条</span></div>`;
  }
  const items = d.feed.map(it => {
    const mediaHtml = (it.media || []).map(m => m.kind === 'photo'
      ? `<div class="relative flex-shrink-0"><img src="${esc(m.url)}" class="w-20 h-20 object-cover rounded-lg border border-gray-100" loading="lazy">${m.authenticity === 'A' ? '<span class="absolute bottom-0.5 left-0.5 badge bg-white/90 text-green-700" style="font-size:9px;padding:1px 5px">📷 实拍</span>' : ''}</div>`
      : `<video src="${esc(m.url)}" controls class="w-32 rounded-lg border border-gray-100"></video>`).join('');
    const badge = it.kind === 'output'
      ? '<span class="badge bg-green-100 text-green-700">产出登记</span>'
      : `<span class="badge bg-blue-50 text-blue-600">${esc(it.cat_name || '任务成果')}</span>`;
    return `<div class="cat-card rounded-2xl p-4 ${it.pinned ? 'ring-2' : ''}" style="${it.pinned ? '--tw-ring-color:var(--hm-primary-faint)' : ''}">
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="avatar w-5 h-5 text-[9px] flex-shrink-0" style="background:${it.theme_color}">${esc(it.org_name[0])}</span>
            <span class="text-[11px] text-gray-400">${esc(it.org_name)} · ${dt(it.at)}</span>
            ${it.pinned ? '<span class="badge bg-primary-soft c-primary-deep">📌 置顶</span>' : ''}
            ${badge}
            ${it.kind === 'sub' && it.points ? `<span class="text-xs c-primary font-bold">+${it.points}</span>` : ''}
          </div>
          <div class="font-medium text-sm text-gray-800">${esc(it.title)}</div>
          ${it.note ? `<p class="text-xs text-gray-500 mt-1 line-clamp-2">${esc(it.note)}</p>` : ''}
          ${it.kind === 'output' && it.activity_title ? `<div class="text-[11px] text-gray-400 mt-1">来自活动「${esc(it.activity_title)}」</div>` : ''}
        </div>
        ${it.kind === 'output' ? `<button class="text-lg flex-shrink-0 ${it.pinned ? '' : 'opacity-25'}" title="${it.pinned ? '取消置顶' : '置顶为代表作'}" onclick="pinOutput('${it.id}')">📌</button>` : ''}
      </div>
      ${mediaHtml ? `<div class="flex gap-2 mt-3 flex-wrap">${mediaHtml}</div>` : ''}
    </div>`;
  }).join('');
  return head + `<div class="space-y-3">${items || '<div class="cat-card rounded-2xl p-6 text-sm text-gray-500">从认领一件任务或参加一场活动开始。确认后的成果会留在这里。</div>'}</div>
  <details class="mt-5"><summary class="text-sm font-semibold py-3 cursor-pointer">查看成果与参与分析</summary>${analysisHtml}</details>`;
}
/** 工资条渲染：按社群彩色柱状 + 月度趋势 + 单社群内各活动类型满意度（星级基础评价）+ 每笔明细 */
function payslipHtmlInner(ps) {
  const maxOrg = Math.max(...ps.by_org.map(o => o.total), 1);
  const maxMonth = Math.max(...ps.by_month.map(m2 => m2.total), 1);
  const satHtml = ps.satisfaction.length ? `<div class="border-t border-gray-100 mt-4 pt-4">
      <h4 class="text-xs font-semibold text-gray-500 mb-2">哪些类型的事情做起来感觉最好（来自你的星级评价）</h4>
      ${ps.satisfaction.map(s => `<div class="mb-2.5">
        <div class="text-xs font-medium text-gray-600 mb-1">${esc(s.org_name)}</div>
        ${s.types.map(t => `<div class="flex items-center gap-2 mb-1">
          <span class="w-16 text-[11px] text-gray-500 flex-shrink-0">${TYPE_CN[t.type] || t.type}</span>
          <div class="flex-1 h-2.5 rounded bg-gray-100 overflow-hidden"><div class="h-full rounded" style="width:${t.avg / 5 * 100}%;background:linear-gradient(90deg,#FBBF24,#F59E0B)"></div></div>
          <span class="text-[11px] text-amber-500 flex-shrink-0">★${t.avg}</span>
        </div>`).join('')}
      </div>`).join('')}
    </div>` : '';
  return `<div class="cat-card rounded-2xl p-5 mb-4">
    <div class="flex items-center justify-between flex-wrap gap-1 mb-3">
      <h3 class="font-semibold text-gray-800 text-sm">💰 工资条 · 分利到账</h3>
      <span class="text-[11px] text-gray-400">共 ${ps.totals.count} 笔 · 已到账 ${ps.totals.paid} 笔</span>
    </div>
    <div class="text-2xl font-bold c-primary mb-3">¥${fmt(ps.totals.amount)}<span class="text-xs text-gray-400 font-normal ml-2">累计到账</span></div>
    <h4 class="text-xs font-semibold text-gray-500 mb-2">哪个社群给得最多</h4>
    <div class="space-y-2 mb-4">${ps.by_org.map(o => `
      <div class="flex items-center gap-2">
        <span class="w-20 text-[11px] text-gray-500 truncate flex-shrink-0">${esc(o.org_name)}</span>
        <div class="flex-1 h-4 rounded-md bg-gray-100 overflow-hidden"><div class="h-full rounded-md flex items-center justify-end pr-1.5 text-[10px] font-bold" style="width:${Math.max(14, Math.round(o.total / maxOrg * 100))}%;background:linear-gradient(90deg,${o.theme_color},${shade(o.theme_color, -22)});color:${shade(o.theme_color, 60)}">¥${fmt(o.total)}</div></div>
      </div>`).join('')}</div>
    ${ps.by_month.length > 1 ? `<h4 class="text-xs font-semibold text-gray-500 mb-2">按月到账趋势</h4>
    <div class="flex items-end gap-2 h-24 mb-1">${ps.by_month.map(m2 => `
      <div class="flex-1 flex flex-col items-center justify-end h-full">
        <span class="text-[9px] text-gray-400 mb-0.5">¥${fmt(m2.total)}</span>
        <div class="w-full max-w-9 rounded-t-md" style="height:${Math.max(8, Math.round(m2.total / maxMonth * 80))}%;background:linear-gradient(180deg,var(--hm-accent),var(--hm-accent-deep))"></div>
        <span class="text-[9px] text-gray-400 mt-0.5">${m2.month.slice(5)}月</span>
      </div>`).join('')}</div>` : ''}
    ${satHtml}
    <details class="m-collapse mt-3" style="margin-bottom:0"><summary><span>每笔明细 · <span class="cnt">${ps.entries.length}</span> 笔（来自哪个社群的哪件事、多少钱）</span></summary>
      <div class="space-y-1.5 pt-1">${ps.entries.map(e => `
        <div class="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
          <div class="min-w-0"><span class="text-xs font-medium text-gray-700 truncate block">${esc(e.dist_name)}</span>
          <span class="text-[10px] text-gray-400">${esc(e.org_name)} · ${dOnly(e.paid_at || e.confirmed_at)}${e.pay_note ? ' · ' + esc(e.pay_note) : ''}</span></div>
          <span class="text-xs font-bold ${e.pay_status === 'paid' ? 'text-green-600' : 'text-orange-400'} flex-shrink-0">¥${fmt(e.amount)}${e.pay_status === 'paid' ? ' 已到账' : ' · 待到账'}</span>
        </div>`).join('')}</div>
    </details>
  </div>`;
}
async function pinOutput(id) {
  try {
    const r = await api('POST', `/api/outputs/${id}/pin`, {});
    toast(r.pinned ? '已置顶为代表成果（也是画像分析的兴趣信号）' : '已取消置顶');
    S.spaceTab = 'feed'; renderMySpace();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 已参与：全部活动 + 评价（可找回） + 产出状态 ---------- */
async function spaceJoined() {  const { participations } = await api('GET', '/api/me/participations');
  S.data.participations = participations;
  /* 工作流 C · 发现活动：参与分析 × 开放招募池（融合在"参与"板块，不单独成页） */
  let recoHtml = '';
  try {
    const r = await api('GET', '/api/me/recommendations');
    if (r.recommendations.length) {
      recoHtml = `<div class="cat-card rounded-2xl p-4 mb-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold text-gray-800 text-sm">🧭 发现活动 · 按你的参与分析</h3>
          <span class="text-[10px] text-gray-400">${r.based_on_analysis ? '按你的画像匹配 · 理由可回溯' : '按你的参与行为匹配'}</span>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-1">${r.recommendations.map(a => `
          <div class="flex-shrink-0 w-64 cat-card rounded-xl p-3.5 cursor-pointer hover:shadow-md transition" onclick="openRec('${a.org_id}',${a.my_org ? 1 : 0})" title="一点击切入">
            <div class="flex items-center gap-1.5 mb-1">
              <span class="avatar w-5 h-5 text-[9px] flex-shrink-0" style="background:${a.theme_color}">${esc(a.org_name[0])}</span>
              <span class="text-[10px] text-gray-400 truncate">${esc(a.org_name)}${a.my_org ? ' · 已加入' : ' · 新社区'}</span>
            </div>
            <div class="text-sm font-medium text-gray-800 line-clamp-2 min-h-[40px]">${esc(a.title)}</div>
            <div class="text-[10px] text-gray-400 mt-1">${TYPE_CN[a.activity_type] || ''} · ${dt(a.start_at)}${a.output_reg ? ' · 🪙 有产出' : ''}</div>
            <div class="text-[11px] mt-1.5" style="color:var(--hm-primary-deep)">✦ ${esc(a.reason)}</div>
          </div>`).join('')}</div>
      </div>`;
    }
  } catch { /* 推荐失败不阻塞参与页 */ }
  if (!participations.length) return recoHtml + '<div class="cat-card rounded-2xl p-8 text-center text-gray-400 text-sm">还没有参与过活动</div>';
  const rows = participations.map(p => {
    const attendBadge = p.attended ? '<span class="badge bg-green-100 text-green-700">已到场</span>'
      : (p.reg_status === 'cancelled' ? '<span class="badge bg-gray-100 text-gray-400">已取消报名</span>' : '');
    const fbBadge = p.feedback_state === 'given' ? `<span class="badge bg-green-100 text-green-700">${p.feedback.stars ? '★' + p.feedback.stars : '已留言'}</span>`
      : p.feedback_state === 'dismissed' ? '<span class="badge bg-gray-100 text-gray-400">已跳过</span>'
      : p.attended ? '<span class="badge bg-yellow-100 text-yellow-700">待评价</span>' : '';
    const outBadge = p.output ? (p.output.status === 'confirmed' ? '<span class="badge bg-green-100 text-green-700">成果已确认</span>' : '<span class="badge bg-yellow-100 text-yellow-700">成果待确认</span>') : '';
    return `<div class="cat-card rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-gray-800">${esc(p.title)}</div>
        <div class="text-[11px] text-gray-400 mt-0.5">
          <span class="avatar w-4 h-4 text-[8px] inline-flex align-middle mr-1" style="background:${p.theme_color}">${esc(p.org_name[0])}</span>${esc(p.org_name)} · ${dOnly(p.start_at)} · ${TYPE_CN[p.activity_type] || ''}</div>
      </div>
      <div class="flex items-center gap-1.5 flex-wrap flex-shrink-0">
        ${attendBadge}${fbBadge}${outBadge}
        <button class="text-xs underline c-primary" onclick="feedbackModal('${p.activity_id}')">评价</button>
        ${p.output_reg && !p.output ? `<button class="text-xs underline" style="color:var(--hm-accent-deep)" onclick="outputModal('${p.activity_id}')">登记成果</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="flex items-center justify-between mb-3">
    <h3 class="font-semibold text-gray-800">已参与</h3>
    <span class="text-[11px] text-gray-400">星级和文字都是可选；叉掉过也能在这里找回</span></div>
  ${recoHtml}
  <div class="space-y-2">${rows}</div>`;
}

/* ---------- 活动反馈：星级滑动 + 可选文字；叉掉可找回 ---------- */
function findActEverywhere(id) {
  return (S.data.homeActs || []).find(a => a.id === id)
    || ((S.data.participations || []).find(p => p.activity_id === id) || {});
}
function feedbackModal(actId, opts) {  const act = findActEverywhere(actId);
  const p = (S.data.participations || []).find(x => x.activity_id === actId);
  const cur = (p && p.feedback) || { stars: 0, text: '' };
  S._fbStars = cur.stars || 0;
  S._fbMedia = (cur.media || []).slice();
  const ended = !act || !act.start_at ? true : (act.status === 'finished' || new Date(act.end_at || act.start_at).getTime() < Date.now());
  const auto = opts && opts.auto;
  openModal(`${auto ? `<div class="text-center mb-1"><span class="badge bg-gray-100 text-gray-500">活动已结束</span></div>` : ''}
  <h3 class="font-bold text-gray-800 mb-1">${auto ? '给这场活动打个分吧' : '活动反馈'}${act && act.title ? ' · ' + esc(act.title) : ''}</h3>
  <p class="text-xs text-gray-400 mb-4">都是可选的：星级给这场活动，也可以拍照、留文字——它们也是你个人画像的兴趣素材。</p>
  <div class="flex items-center gap-3 mb-4">
    <input type="range" min="0" max="5" value="${S._fbStars}" class="slider flex-1" oninput="fbStars(this.value)">
    <span id="fb-val" class="c-primary font-bold text-lg w-24 text-right flex-shrink-0">${S._fbStars ? '★'.repeat(S._fbStars) : '不评星'}</span>
  </div>
  <textarea id="fb-text" rows="3" placeholder="想多说两句？写在下面（可选）">${esc(cur.text || '')}</textarea>
  <div class="flex items-center gap-2 flex-wrap mt-3">
    <label class="tab-btn cursor-pointer">📷 拍照/选图<input type="file" accept="image/*" multiple class="hidden" onchange="fbPickPhotos(this)"></label>
    <span id="fb-thumbs" class="flex gap-1.5 flex-wrap"></span>
  </div>
  <div class="flex items-center gap-2 mt-4">
    <button class="cat-btn flex-1 py-2 rounded-xl text-sm" onclick="doFeedbackSave('${actId}')">保存反馈</button>
    <button class="text-xs text-gray-400 underline" onclick="dismissFeedback('${actId}')">跳过，不再提醒</button>
  </div>`);
  fbRenderThumbs();
}
function fbRenderThumbs() {
  const el = $('fb-thumbs'); if (!el || !S._fbMedia) return;
  el.innerHTML = S._fbMedia.map((u, i) => `<span class="relative inline-flex"><img src="${esc(u)}" class="w-10 h-10 object-cover rounded-lg"><button class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] leading-none" onclick="fbDelMedia(${i})">×</button></span>`).join('');
}
async function fbPickPhotos(input) {
  const files = [...(input.files || [])].slice(0, 4);
  if (!files.length) return;
  for (const f of files) {
    try {
      await extractExif(f); // 留痕：与产出登记同一套压缩管线（压缩前提取元数据）
      const url = await compressPhoto(f, 720);
      if (S._fbMedia) S._fbMedia.push(url);
    } catch { /* 单张失败跳过 */ }
  }
  fbRenderThumbs();
  input.value = '';
}
function fbDelMedia(i) { if (S._fbMedia) { S._fbMedia.splice(i, 1); fbRenderThumbs(); } }
/** 计时器（② 仅签到的活动）：到达活动设定的结束时间点即弹出评价卡——
 *  三层保障：本定时器精准到期 + 进入页面时全量判断 + SSE 归档事件即时刷新 */
function scheduleFbTimers(activities) {
  (S._fbTimers || []).forEach(clearTimeout);
  S._fbTimers = [];
  for (const a of activities) {
    if (!a.my_checkin || !a.my_checkin.checkin_at) continue; // 只提醒到场的人
    if (a.my_feedback && (a.my_feedback.stars || a.my_feedback.text || a.my_feedback.dismissed_at)) continue; // 已评价/已跳过不打扰
    if (a.checkin_rule === 'checkin_checkout' || a.checkin_rule === 'checkout_only') continue; // 有退场的走"签退完成即弹"
    const endMs = new Date(a.end_at || a.start_at).getTime();
    const wait = endMs - Date.now();
    if (wait > 0 && wait < 2 ** 31) {
      S._fbTimers.push(setTimeout(() => {
        if (S.org && S.page === 'home') {
          go('home');
          toast('「' + a.title + '」已结束，给个星级吧（可选）', 'warn', '去评价', () => feedbackModal(a.id, { auto: 1 }));
        }
      }, wait));
    }
  }
}
function fbStars(v) {
  S._fbStars = Number(v);
  const el = $('fb-val');
  if (el) el.textContent = S._fbStars ? '★'.repeat(S._fbStars) : '不评星';
}
async function doFeedbackSave(actId) {
  try {
    await api('POST', `/api/activities/${actId}/feedback`, { stars: S._fbStars || null, text: $('fb-text').value.trim(), media: S._fbMedia || [] });
    closeModal(); toast('反馈已保存，谢谢！你的反馈也在帮助画像更准');
    if (S.org) go(S.page, S.sub, true); else renderMySpace();
  } catch (e) { toast(e.message, 'err'); }
}
async function dismissFeedback(actId) {
  try {
    await api('POST', `/api/activities/${actId}/feedback`, { dismissed: true });
    closeModal(); toast('已跳过——随时可在「已参与」里找回补评', 'warn');
    if (S.org) go(S.page, S.sub, true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 产出登记录入通道（参与者）+ EXIF 前置提取 ---------- */
/**
 * JPEG EXIF 提取：必须在 canvas 压缩之前做——重编码会剥离全部元数据。
 * 返回 { Model, Make, Software, DateTimeOriginal, GPSLat, GPSLng, c2pa }
 */
async function extractExif(file) {
  try {
    const buf = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    const out = {};
    const head = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(buf.length, 512 * 1024)));
    if (head.includes('c2pa') || head.includes('jumb')) out.c2pa = 'marker';
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return out; // 非 JPEG（截图/PNG 等）→ 无 EXIF
    const dv = new DataView(buf.buffer);
    let off = 2;
    while (off + 4 < buf.length) {
      if (buf[off] !== 0xFF) { off++; continue; }
      const marker = buf[off + 1];
      if (marker === 0xDA) break;
      const len = dv.getUint16(off + 2);
      if (marker === 0xE1 && len > 8) {
        const tag = new TextDecoder('latin1').decode(buf.subarray(off + 4, off + 10));
        if (tag === 'Exif\x00\x00') parseTiff(dv, off + 10, out);
      }
      off += 2 + len;
    }
    return out;
  } catch { return {}; }
}
function parseTiff(dv, base, out) {
  const le = dv.getUint16(base) === 0x4949;
  const g16 = p => dv.getUint16(p, le), g32 = p => dv.getUint32(p, le);
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = start => {
    const n = g16(start); const entries = {};
    for (let i = 0; i < n && start + 2 + i * 12 + 12 <= dv.byteLength; i++) {
      const e = start + 2 + i * 12;
      entries[g16(e)] = { type: g16(e + 2), count: g32(e + 4), off: e + 8 };
    }
    return entries;
  };
  const val = (en, ifdBase) => {
    const size = (SIZE[en.type] || 1) * en.count;
    const p = size <= 4 ? en.off : ifdBase + g32(en.off);
    if (p + 2 > dv.byteLength) return null;
    if (en.type === 2) { let s = ''; for (let i = 0; i < en.count - 1 && p + i < dv.byteLength; i++) s += String.fromCharCode(dv.getUint8(p + i)); return s.replace(/\0/g, '').trim(); }
    if (en.type === 3) return g16(p);
    if (en.type === 4) return g32(p);
    if (en.type === 5 || en.type === 10) {
      const a = en.type === 5 ? g32(p) : dv.getInt32(p, le);
      const b = en.type === 5 ? g32(p + 4) : dv.getInt32(p + 4, le);
      return b ? a / b : 0;
    }
    return null;
  };
  try {
    const ifd0 = ifd(base + g32(base + 4));
    if (ifd0[0x0110]) out.Model = val(ifd0[0x0110], base);
    if (ifd0[0x010F]) out.Make = val(ifd0[0x010F], base);
    if (ifd0[0x0131]) out.Software = val(ifd0[0x0131], base);
    if (ifd0[0x8769]) {
      const exif = ifd(base + g32(ifd0[0x8769].off));
      if (exif[0x9003]) out.DateTimeOriginal = val(exif[0x9003], base);
    }
    if (ifd0[0x8825]) {
      const gps = ifd(base + g32(ifd0[0x8825].off));
      const dms = t => {
        const e = gps[t]; if (!e) return null;
        const p = 8 * e.count <= 4 ? e.off : base + g32(e.off);
        return [0, 1, 2].map(i => g32(p + i * 8) / (g32(p + i * 8 + 4) || 1));
      };
      if (gps[0x0002] && gps[0x0001]) {
        const d = dms(0x0002);
        if (d) out.GPSLat = (d[0] + d[1] / 60 + d[2] / 3600) * (val(gps[0x0001], base) === 'S' ? -1 : 1);
      }
      if (gps[0x0004] && gps[0x0003]) {
        const d = dms(0x0004);
        if (d) out.GPSLng = (d[0] + d[1] / 60 + d[2] / 3600) * (val(gps[0x0003], base) === 'W' ? -1 : 1);
      }
    }
  } catch { /* EXIF 解析失败按无元数据处理 */ }
}

function outputModal(actId) {
  const a = findActEverywhere(actId);
  S._out = { actId, media: [], gps: null, useGps: true };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      if (S._out && S._out.actId === actId) {
        S._out.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const el = $('out-gps'); if (el) el.textContent = `将附带定位（±${Math.round(pos.coords.accuracy)} 米）`;
      }
    }, () => { const el = $('out-gps'); if (el) el.textContent = '定位不可用（可取消定位继续）'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  } else { S._out.useGps = false; }
  openModal(`<h3 class="font-bold text-gray-800 mb-1">登记本次成果</h3>
  <p class="text-xs text-gray-400 mb-4">${a && a.title ? esc(a.title) + ' · ' : ''}提交后由组织者确认，自动进入你的「我的成果」。多拍照、录视频——动图和视频上大分。</p>
  <div class="space-y-3">
    <div><label class="text-xs text-gray-500">成果标题</label><input id="out-title" placeholder="如：现场画的任务画布"></div>
    <div><label class="text-xs text-gray-500">文字说明（可选，权重较低）</label><textarea id="out-note" rows="2" placeholder="这次做了什么、感受如何"></textarea></div>
    <div class="flex gap-2 flex-wrap">
      <label class="tab-btn cursor-pointer">＋ 照片（可多选）<input type="file" accept="image/*" multiple class="hidden" onchange="outPickPhotos(this)"></label>
      <label class="tab-btn cursor-pointer">＋ 视频 / 动图<input type="file" accept="video/*,image/gif" class="hidden" onchange="outPickVideo(this)"></label>
    </div>
    <div id="out-thumbs" class="flex gap-2 flex-wrap"></div>
    <div class="flex items-center gap-2 text-xs text-gray-500">
      <input type="checkbox" id="out-usegps" checked class="!w-4 !h-4" onchange="outGpsToggle(this.checked)">
      <span id="out-gps">正在获取定位…</span>
    </div>
    <button class="cat-btn w-full py-2.5 rounded-xl" onclick="doOutputSubmit()">提交（确认后展示）</button>
    <p class="text-[11px] text-gray-400 text-center">带完整拍摄信息的照片会判定「实拍」；无拍摄信息（截图/网图/AI 图）会计为存疑、权重降低</p>
  </div>`);
}
function compressPhoto(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.82, url = c.toDataURL('image/jpeg', q);
      while (url.length > 700 * 1024 && q > 0.4) { q -= 0.12; url = c.toDataURL('image/jpeg', q); }
      resolve(url);
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = URL.createObjectURL(file);
  });
}
async function outPickPhotos(input) {
  const files = [...(input.files || [])].slice(0, 6);
  if (!files.length) return;
  for (const f of files) {
    try {
      const exif = await extractExif(f); // ★ 压缩前提取
      const url = await compressPhoto(f);
      S._out.media.push({ kind: 'photo', url, exif });
    } catch { toast('有一张图片读取失败，已跳过', 'err'); }
  }
  outRenderThumbs();
  const hasMeta = files.some(f => /jpe?g/i.test(f.type));
  toast(`已加入 ${files.length} 张照片${hasMeta ? '（拍摄信息完整即计「实拍」）' : '（注意：无拍摄信息会计为存疑）'}`);
  input.value = '';
}
async function outPickVideo(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (f.size > 12 * 1024 * 1024) return toast('视频过大（限 12MB，建议 ≤60 秒）', 'err');
  toast('视频上传中…', 'warn');
  const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  const b64 = String(dataUrl).split(',')[1] || '';
  let ext = (f.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!['mp4', 'webm', 'mov', 'gif'].includes(ext)) ext = f.type === 'image/gif' ? 'gif' : 'mp4';
  try {
    const r = await api('POST', '/api/me/uploads', { data_b64: b64, ext });
    S._out.media.push({ kind: ext === 'gif' ? 'gif' : 'video', url: r.url, exif: {} });
    outRenderThumbs(); toast('视频已就绪（上大分！）');
  } catch (e) { toast(e.message, 'err'); }
  input.value = '';
}
function outRenderThumbs() {
  const el = $('out-thumbs'); if (!el || !S._out) return;
  el.innerHTML = (S._out.media || []).map((m, i) => m.kind === 'photo'
    ? `<div class="relative"><img src="${esc(m.url)}" class="w-16 h-16 object-cover rounded-lg"><button class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none" onclick="outDelMedia(${i})">×</button></div>`
    : `<div class="relative w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-xl">${m.kind === 'gif' ? '🎞' : '🎬'}<button class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none" onclick="outDelMedia(${i})">×</button></div>`).join('');
}
function outDelMedia(i) { S._out.media.splice(i, 1); outRenderThumbs(); }
function outGpsToggle(on) {
  S._out.useGps = on;
  if (!on) S._out.gps = null;
  const el = $('out-gps');
  if (el) el.textContent = on ? (S._out.gps ? '将附带定位' : '重新获取定位…') : '已取消定位';
}
async function doOutputSubmit() {
  const o = S._out; if (!o) return;
  try {
    const r = await api('POST', `/api/activities/${o.actId}/outputs`, {
      title: $('out-title').value.trim(), note: $('out-note').value.trim(),
      media: o.media, lat: o.useGps && o.gps ? o.gps.lat : null, lng: o.useGps && o.gps ? o.gps.lng : null,
    });
    closeModal();
    const aN = (r.media || []).filter(m => m.authenticity === 'A').length;
    toast(`成果已提交${aN ? `，${aN} 张判定为实拍` : ''}，确认后进入「我的成果」`);
    if (S.org) go(S.page, S.sub, true); else spaceGo('joined');
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 团队侧：产出确认（归档时的批量轻确认） ---------- */
async function outputsModal(actId) {
  const d = await api('GET', `/api/activities/${actId}/outputs`);
  const pend = d.outputs.filter(o => o.status === 'pending');
  const rows = d.outputs.map(o => `
    <div class="flex items-center justify-between gap-2 py-2 border-b border-gray-50">
      <div class="min-w-0">
        <div class="text-sm font-medium">${esc(o.title || '(无标题)')}</div>
        <div class="text-[11px] text-gray-400">${esc(o.user_name)} · ${dt(o.created_at)} · ${(o.media || []).map(m => m.kind === 'photo' ? (m.authenticity === 'A' ? '实拍' : '照片') : (m.kind === 'gif' ? '动图' : '视频')).join(' / ') || '纯文字'}</div>
      </div>
      ${o.status === 'pending' ? '<span class="badge bg-yellow-100 text-yellow-700 flex-shrink-0">待确认</span>' : '<span class="badge bg-green-100 text-green-700 flex-shrink-0">已确认</span>'}
    </div>`).join('');
  openModal(`<h3 class="font-bold text-gray-800 mb-1">产出登记确认</h3>
  <p class="text-xs text-gray-400 mb-3">确认后进入成员的「我的成果」——主页展示与画像分析都以已确认为准（事后确认原则）。</p>
  <div class="mb-3 max-h-72 overflow-y-auto">${rows || '<p class="text-xs text-gray-400">还没有人登记</p>'}</div>
  ${pend.length ? `<button class="cat-btn w-full py-2 rounded-xl text-sm" onclick="doOutputsConfirm('${actId}')">一键全部确认（${pend.length} 条）</button>` : ''}`);
}
async function doOutputsConfirm(actId) {
  try {
    const r = await api('POST', `/api/activities/${actId}/outputs/confirm`, {});
    closeModal(); toast(`已确认 ${r.confirmed} 条产出`);
    go('team', { tab: 'acts' });
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 画像分析（工作流 A）+ 分析卡（工作流 B）----------
 * 呈现定案：一整个分析文档（结论 + 三段），每段前一个绿点开关——
 * 绿点 = 对外公开（默认选中），点击变白点黑边圈圈 = 仅自己可见。内容不可改写。 */
const SEC_CN = { strengths: '明显优点', interests: '感兴趣的事', adjust: '补足与规避' };
async function spaceAnalysis() {
  const d = await api('GET', '/api/me/analysis');
  S.data.analysis = d;
  const genBtn = d.can_generate
    ? '<button class="cat-btn px-5 py-2 rounded-xl text-sm flex-shrink-0" onclick="generateAnalysis()">✦ 生成我的画像分析</button>'
    : d.confirmed_count < d.threshold
      ? `<span class="text-xs text-gray-400">已确认成果 ${d.confirmed_count}/${d.threshold} 条——再积累 ${d.threshold - d.confirmed_count} 条即可生成</span>`
      : `<span class="text-xs text-gray-400">本月 ${d.quota} 次额度已用完；历史版本仍可查看与拼贴</span>`;
  if (!d.blocks.length) {
    return `<div class="cat-card rounded-2xl p-6 mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div><h3 class="font-semibold text-gray-800 text-sm">成果与参与分析 · 画像文档</h3>
        <div class="text-[11px] text-gray-400 mt-1">依据跨组织的已确认成果、主动报名、你的反馈与置顶，生成一整个画像文档</div></div>
      ${genBtn}</div>`;
  }
  const latest = d.versions[0] || {};
  const headline = latest.headline || '';
  const order = ['strengths', 'interests', 'adjust'];
  const evOf = b => { let ev = []; try { ev = JSON.parse(b.evidence || '[]'); } catch { ev = []; } return ev; };
  const rowHtml = b => `<div id="blk-${b.id}" class="doc-blk flex items-start gap-2.5 py-2 cursor-pointer" onclick="toggleBlock('${b.id}')">
      <button type="button" class="bullet-dot ${b.visible ? 'on' : ''}" title="${b.visible ? '公开中 · 点击改为仅自己可见' : '仅自己可见 · 点击公开'}"></button>
      <div class="flex-1 min-w-0">
        <p class="blk-text text-sm leading-relaxed ${b.visible ? 'text-gray-800' : 'text-gray-400'}">${esc(b.content)}</p>
        ${evOf(b).slice(0, 2).map(e => `<div class="text-[11px] text-gray-400 mt-0.5">依据：${esc(e)}</div>`).join('')}
      </div>
      <div class="flex flex-col items-center gap-0.5 flex-shrink-0 opacity-40 md:opacity-0 md:group-hover:opacity-100 transition">
        <button type="button" class="text-[10px] px-1 rounded bg-gray-50" onclick="event.stopPropagation();moveBlock('${b.id}',-1)">↑</button>
        <button type="button" class="text-[10px] px-1 rounded bg-gray-50" onclick="event.stopPropagation();moveBlock('${b.id}',1)">↓</button>
      </div>
      <span class="text-[9px] text-gray-300 flex-shrink-0 mt-1.5">v${b.version_no}</span>
    </div>`;
  const doc = `<div class="cat-card rounded-2xl p-5 md:p-6 mb-4">
    <div class="flex items-start justify-between flex-wrap gap-2 mb-2">
      <div class="min-w-0">
        <h3 class="font-bold text-gray-800 text-base">我的画像 · 成果与参与分析 <span class="text-[10px] text-gray-400 font-normal">v${latest.version_no || 1} · ${dOnly(latest.created_at)}</span></h3>
        <p class="text-[11px] text-gray-400 mt-0.5">含<b>成果分析</b>（优点/规避）与<b>参与分析</b>（兴趣）· 基于 ${d.confirmed_count} 条已确认成果 · <span class="inline-flex items-center gap-1 align-middle"><span class="bullet-dot on" style="width:10px;height:10px;margin:0"></span>公开</span> / <span class="inline-flex items-center gap-1 align-middle"><span class="bullet-dot" style="width:10px;height:10px;margin:0"></span>仅自己</span> · 点击切换，内容不可改写</p>
      </div>
      <div class="flex gap-2 text-xs flex-shrink-0">
        <button class="cat-secondary text-xs px-3 py-1.5 rounded-lg" onclick="shareCardModal()">🔗 转发</button>
      </div>
    </div>
    ${headline ? `<p class="text-sm c-primary-deep font-medium leading-relaxed border-l-[3px] pl-3 mb-1" style="border-color:var(--hm-accent)">${esc(headline)}</p>` : ''}
    ${order.map(sec => {
      const list = d.blocks.filter(b => b.section === sec).sort((a, b) => a.seq - b.seq);
      if (!list.length) return '';
      return `<div class="mt-4 group">
        <div class="text-xs font-bold c-primary-deep mb-1">◆ ${SEC_CN[sec]}</div>
        ${list.map(rowHtml).join('')}
      </div>`;
    }).join('')}
  </div>`;
  const versionsHtml = d.versions.length > 1 ? `<div class="flex gap-1.5 flex-wrap mb-3 items-center">
    <span class="text-[11px] text-gray-400">历史版本（可点开任一段落跨版本拼贴，段落已标 vN）：</span>
    ${d.versions.map(v => `<span class="badge bg-gray-100 text-gray-500">v${v.version_no} · ${dOnly(v.created_at)}</span>`).join('')}</div>` : '';
  return `<div class="cat-card rounded-2xl p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
    <div><h3 class="font-semibold text-gray-800 text-sm">个人画像分析</h3>
      <div class="text-[11px] text-gray-400 mt-1">依据跨组织的已确认成果、主动报名、你的反馈与置顶 · 每次生成存为新版本，永久保留（VIP 过期后仍可见）</div></div>
    ${genBtn}</div>
  ${doc}${versionsHtml}`;
}
async function generateAnalysis() {
  try {
    const r = await api('POST', '/api/me/analysis/generate');
    toast(`画像 v${r.version_no} 已生成——默认全部公开，点绿点可改为仅自己可见`);
    S.spaceTab = 'analysis';
    renderMySpace();
  } catch (e) { toast(e.message, 'err'); }
}
async function toggleBlock(id) {
  const b = ((S.data.analysis && S.data.analysis.blocks) || []).find(x => x.id === id);
  if (!b) return;
  const next = b.visible ? 0 : 1;
  try {
    await api('PUT', '/api/me/card/blocks', { blocks: [{ id, visible: next, seq: b.seq }] });
    b.visible = next;
    // 局部更新：不整页重绘，绿点 ⇄ 白点即时切换
    const row = document.getElementById('blk-' + id);
    if (row) {
      const dot = row.querySelector('.bullet-dot');
      const p = row.querySelector('.blk-text');
      if (dot) { dot.classList.toggle('on', next === 1); dot.title = next ? '公开中 · 点击改为仅自己可见' : '仅自己可见 · 点击公开'; }
      if (p) { p.classList.toggle('text-gray-800', next === 1); p.classList.toggle('text-gray-400', next !== 1); }
    }
  } catch (e) { toast(e.message, 'err'); }
}
async function moveBlock(id, dir) {
  const arr = [...((S.data.analysis && S.data.analysis.blocks) || [])].sort((a, b) => a.seq - b.seq);
  const i = arr.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  try {
    await api('PUT', '/api/me/card/blocks', { blocks: [
      { id: arr[i].id, visible: arr[i].visible, seq: arr[j].seq },
      { id: arr[j].id, visible: arr[j].visible, seq: arr[i].seq },
    ] });
    spaceGo('analysis');
  } catch (e) { toast(e.message, 'err'); }
}
function visibleBlocks() {
  const d = S.data.analysis || {};
  return (d.blocks || []).filter(b => b.visible).sort((a, b) => a.seq - b.seq);
}
function cardText() {
  const vis = visibleBlocks();
  if (!vis.length) return null;
  const ana = S.data.analysis || {};
  const vNo = (ana.versions && ana.versions[0] && ana.versions[0].version_no) || null;
  const lines = [`我的个人画像卡${vNo ? ` v${vNo}` : ''}（基于平台${ana.confirmed_count != null ? ' ' + ana.confirmed_count + ' 条' : ''}已确认成果生成 · 工具评价，本人仅勾选展示）`];
  let sec = '';
  for (const b of vis) {
    if (b.section !== sec) { sec = b.section; lines.push('', `【${SEC_CN[sec] || sec}】`); }
    lines.push('· ' + b.content);
  }
  return lines.join('\n');
}
async function copyCardText() {
  const t = cardText();
  if (!t) return toast('先勾选要展示的内容块', 'err');
  try { await navigator.clipboard.writeText(t); toast('卡片文本已复制'); }
  catch { toast('复制失败：浏览器未授权剪贴板', 'err'); }
}
function openCardPublic() {
  const url = `${location.origin}/card/${S.user.id}`;
  openModal(`<h3 class="font-bold text-gray-800 mb-2">公开页链接</h3>
  <p class="text-xs text-gray-400 mb-3">只呈现你打勾的内容块；发出去之前先勾好。</p>
  <input readonly value="${esc(url)}" onclick="this.select()" class="text-xs">
  <div class="flex gap-2 mt-3">
    <button class="cat-btn flex-1 py-2 rounded-xl text-sm" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('已复制'))">复制链接</button>
    <a class="cat-secondary flex-1 py-2 rounded-xl text-sm text-center" href="${url}" target="_blank">预览</a>
  </div>`);
}
/** 转发画像卡：文本 / 图卡 / 公开页 三种方式，全部只含绿点段落（社交属性） */
function shareCardModal() {
  openModal(`<h3 class="font-bold text-gray-800 mb-1">转发我的画像卡</h3>
  <p class="text-xs text-gray-400 mb-3">只带走你打了绿点的段落——工具评价，本人仅勾选展示。</p>
  <div class="space-y-2">
    <button type="button" class="w-full text-left cat-card rounded-xl px-4 py-3 hover:shadow-sm" onclick="copyCardText()"><b class="text-sm">📋 复制文字版</b><br><span class="text-[11px] text-gray-400">即时粘贴到微信、群里</span></button>
    <button type="button" class="w-full text-left cat-card rounded-xl px-4 py-3 hover:shadow-sm" onclick="downloadCardImage()"><b class="text-sm">🖼 下载图片卡</b><br><span class="text-[11px] text-gray-400">生成图片海报，转发即用</span></button>
    <button type="button" class="w-full text-left cat-card rounded-xl px-4 py-3 hover:shadow-sm" onclick="openCardPublic()"><b class="text-sm">🔗 公开页链接</b><br><span class="text-[11px] text-gray-400">长期有效的在线卡片</span></button>
  </div>
  <p class="text-[10px] text-gray-400 mt-3 text-center">微信里也可以直接截图画像文档转发。</p>`);
}
async function downloadCardImage() {
  const vis = visibleBlocks();
  if (!vis.length) return toast('先勾选要展示的内容块', 'err');
  const W = 1080, pad = 64, lineH = 44;
  const measure = document.createElement('canvas').getContext('2d');
  const wrap = (text, maxW) => {
    measure.font = '28px sans-serif';
    const out = []; let line = '';
    for (const ch of text) {
      if (measure.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line); return out;
  };
  let y = 240; const draw = [];
  let sec = '';
  for (const b of vis) {
    if (b.section !== sec) { sec = b.section; draw.push({ font: 'bold 34px sans-serif', color: '#E8620C', text: '◆ ' + (SEC_CN[sec] || sec), x: pad, y: y + 20 }); y += 64; }
    for (const ln of wrap('· ' + b.content, W - pad * 2)) { draw.push({ font: '28px sans-serif', color: '#2B2620', text: ln, x: pad, y: y + 28 }); y += lineH; }
    y += 18;
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = y + 120;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#FFF7ED'); g.addColorStop(1, '#FAF6EF');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, c.height);
  ctx.fillStyle = '#F97C2F'; ctx.fillRect(0, 0, W, 170);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 46px sans-serif';
  ctx.fillText(S.user.display_name + ' 的个人画像卡', pad, 90);
  ctx.font = '22px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillText(`基于 ${S.data.analysis.confirmed_count} 条已确认成果生成 · 工具评价，本人仅勾选展示`, pad, 132);
  for (const d2 of draw) { ctx.font = d2.font; ctx.fillStyle = d2.color; ctx.fillText(d2.text, d2.x, d2.y); }
  ctx.fillStyle = '#a89f8d'; ctx.font = '20px sans-serif';
  ctx.fillText(`贡献者工作台 · v${(S.data.analysis.versions[0] || {}).version_no || 1} · ${new Date().toLocaleDateString('zh-CN')}`, pad, c.height - 40);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = '我的画像卡.png';
  a.click();
  toast('图卡已下载');
}

/* ---------- 一键报表：不单独设板块，融合为成果页的按需弹窗 ---------- */
function reportModal() {
  const from = (S._rep && S._rep.from) || new Date(Date.now() - 180 * 86400e3).toISOString().slice(0, 10);
  const to = (S._rep && S._rep.to) || new Date().toISOString().slice(0, 10);
  openModal(`<h3 class="font-bold text-gray-800 mb-1">导出分类报表</h3>
  <p class="text-xs text-gray-400 mb-3">主页时间线不分类；按活动/技能/组织的分类梳理在这里，选好区间生成，可打印存 PDF。</p>
  <div class="flex gap-2 items-center flex-wrap text-sm mb-3">
    <input id="rep-from" type="date" value="${from}" class="!w-36">
    <span class="text-gray-400">至</span>
    <input id="rep-to" type="date" value="${to}" class="!w-36">
    <button class="cat-btn px-4 py-2 rounded-xl text-sm" onclick="runReport()">生成</button>
    <label class="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
      <input type="checkbox" id="rep-card" class="!w-4 !h-4" ${S._repCard ? 'checked' : ''} onchange="S._repCard=this.checked">
      末尾附上我的画像卡（绿点段落）
    </label>
  </div>
  <div id="rep-body"><div class="text-center text-gray-400 py-6 text-sm">选好时间区间，点「生成」</div></div>`);
}
async function runReport() {
  S._rep = { from: $('rep-from').value, to: $('rep-to').value };
  try {
    const d = await api('GET', `/api/me/report?from=${S._rep.from}&to=${S._rep.to}`);
    S.data.report = d;
    const body = $('rep-body');
    if (!d.groups.length) { body.innerHTML = '<div class="cat-card rounded-2xl p-8 text-center text-gray-400 text-sm">该区间暂无已确认成果</div>'; return; }
    body.innerHTML = `
      <div class="cat-card rounded-2xl p-5 mb-4">
        <h3 class="font-bold text-gray-800">个人成果报表 · ${d.range.from} ~ ${d.range.to}</h3>
        <div class="text-xs text-gray-400 mt-1">${d.totals.items} 条成果 · 累计 ${d.totals.points} 积分</div>
        ${d.categories.length ? `<div class="flex gap-2 flex-wrap mt-3">${d.categories.map(c => `<span class="badge bg-primary-soft c-primary-deep">${esc(c.name)} × ${c.count}</span>`).join('')}</div>` : ''}
      </div>
      ${d.groups.map(g => `
        <div class="cat-card rounded-2xl p-5 mb-4">
          <div class="flex items-center gap-2 mb-3"><span class="avatar w-7 h-7 text-xs" style="background:${g.theme_color}">${esc(g.org_name[0])}</span>
            <b class="text-sm text-gray-800">${esc(g.org_name)}</b><span class="text-[11px] text-gray-400">${g.count} 条 · ${g.points} 积分</span></div>
          ${g.activities.map(act => `
            <div class="mb-3">
              <div class="text-xs font-semibold c-primary-deep mb-1.5">📅 ${esc(act.title)} <span class="text-gray-300">·</span> <span class="text-gray-400">${TYPE_CN[act.activity_type] || ''} · ${dOnly(act.start_at)}</span></div>
              <div class="space-y-1">${act.items.map(it => `
                <div class="text-xs text-gray-600 flex gap-2 items-start"><span class="flex-shrink-0">${it.kind === 'output' ? '🪙' : '✅'}</span>
                  <span class="min-w-0"><b>${esc(it.title)}</b>${it.cat_name ? ` <span class="text-gray-400">（${esc(it.cat_name)}）</span>` : ''}${it.points ? ` <span class="c-primary font-bold">+${it.points}</span>` : ''}${it.note ? `<span class="text-gray-400"> — ${esc(it.note)}</span>` : ''}</span></div>`).join('')}</div>
            </div>`).join('')}
          ${g.loose.length ? `<div class="text-xs font-semibold text-gray-500 mb-1.5 mt-2">其他任务成果</div>
            <div class="space-y-1">${g.loose.map(it => `<div class="text-xs text-gray-600">✅ <b>${esc(it.title)}</b>${it.cat_name ? ` <span class="text-gray-400">（${esc(it.cat_name)}）</span>` : ''}${it.points ? ` <span class="c-primary font-bold">+${it.points}</span>` : ''}</div>`).join('')}</div>` : ''}
        </div>`).join('')}`;
    if (S._repCard) {
      try {
        const ana = await api('GET', '/api/me/analysis');
        const vis = (ana.blocks || []).filter(b => b.visible).sort((a, b) => a.seq - b.seq);
        if (vis.length) {
          let sec = ''; let inner = '';
          for (const b of vis) {
            if (b.section !== sec) { sec = b.section; inner += `<div class="text-xs font-bold c-primary-deep mt-2.5 mb-1">◆ ${SEC_CN[sec] || sec}</div>`; }
            inner += `<div class="text-xs text-gray-600 leading-relaxed">· ${esc(b.content)}</div>`;
          }
          body.innerHTML += `<div class="cat-card rounded-2xl p-5 mb-4">
            <h3 class="font-bold text-gray-800 text-sm mb-1">附：我的画像卡</h3>
            <div class="text-[11px] text-gray-400 mb-2">基于 ${ana.confirmed_count} 条已确认成果生成 · v${(ana.versions[0] || {}).version_no || 1} · ${new Date().toLocaleDateString('zh-CN')} · 工具评价，本人仅勾选展示</div>
            ${inner}</div>`;
        } else {
          body.innerHTML += '<div class="text-[11px] text-gray-400 mb-4">（画像卡附录：还没有勾选公开的内容块，去「画像分析」勾选后再生成报表）</div>';
        }
      } catch { /* 分析不可用时跳过附录 */ }
    }
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 支付宝授权式绑定（模拟跳转页）+ 企业认证向导（工商联想） ---------- */
function alipayAuthModal() {
  openModal(`<div class="rounded-2xl overflow-hidden border border-gray-200">
    <div class="px-4 py-3 text-sm font-bold text-white" style="background:#1677FF">支付宝 · 授权服务 <span class="text-[10px] opacity-80 font-normal">（演示模拟页）</span></div>
    <div class="p-4 text-sm text-gray-700 space-y-2">
      <p><b>贡献者工作台</b> 申请获取你的支付宝账号与实名信息，用于分利打款。</p>
      <p class="text-[11px] text-gray-400 leading-relaxed">真实环境此处为支付宝官方授权页：确认后平台凭授权码自动取回账号并绑定（会员信息授权 → 转账到支付宝账户），全程免输入。</p>
    </div>
    <div class="px-4 pb-4 flex gap-2">
      <button class="flex-1 py-2 rounded-xl border text-sm" onclick="closeModal()">取消</button>
      <button class="flex-1 py-2 rounded-xl text-sm text-white" style="background:#1677FF" onclick="doAlipayAuth()">确认授权并返回</button>
    </div></div>`);
}
async function doAlipayAuth() {
  try {
    const r = await api('POST', '/api/me/alipay-authorize');
    closeModal();
    toast('支付宝授权成功，收款方式已自动绑定（' + r.masked + '）');
    openProfile(); // 重开弹窗回显已绑定态
  } catch (e) { toast(e.message, 'err'); }
}
function verifyModal() {
  S._vf = { picked: null, list: [] };
  openModal(`<h3 class="font-bold text-gray-800 mb-1">企业认证（蓝标花标）</h3>
  <p class="text-xs text-gray-400 mb-3">输入公司名关键词，系统自动联想工商在册企业——选定后平台自动核验统一社会信用代码，无需自行准备材料。</p>
  <div class="flex gap-2 mb-1">
    <input id="vf-q" placeholder="输入公司名关键词，如：花猫" onkeydown="if(event.key==='Enter')vfSearch()">
    <button class="cat-btn px-4 rounded-xl text-sm flex-shrink-0" onclick="vfSearch()">搜索企业</button>
  </div>
  <p class="text-[10px] text-gray-400 mb-2">联想数据源为演示；真实接入企查查「企业模糊搜索」等工商 API（约 0.1 元/次）后自动比对在册信息。</p>
  <div id="vf-list" class="space-y-1.5"></div>
  <div id="vf-pick" class="mt-3"></div>`);
}
async function vfSearch() {
  const q = $('vf-q').value.trim();
  if (!q) return toast('请输入企业名关键词', 'err');
  $('vf-list').innerHTML = '<div class="text-xs text-gray-400">联想中…</div>';
  try {
    const r = await api('GET', '/api/verify/search?q=' + encodeURIComponent(q));
    S._vf.list = r.companies;
    $('vf-list').innerHTML = r.companies.map((c, i) => `
      <div id="vf-item-${i}" class="vf-item border rounded-xl px-3 py-2" onclick="vfPick(${i})">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0"><div class="text-sm font-medium text-gray-800 truncate">${esc(c.name)}</div>
          <div class="text-[11px] text-gray-400">法定代表人：${esc(c.legal_person)} · ${esc(c.region)}</div></div>
          <span class="badge bg-green-50 text-green-600 flex-shrink-0">${esc(c.status)}</span>
        </div>
        <div class="text-[10px] text-gray-400 mt-0.5 select-all">统一社会信用代码：${esc(c.credit_code)}</div>
      </div>`).join('');
    $('vf-pick').innerHTML = '';
  } catch (e) { $('vf-list').innerHTML = `<p class="text-xs text-red-400">${esc(e.message)}</p>`; }
}
function vfPick(i) {
  const c = S._vf.list[i];
  if (!c) return;
  S._vf.picked = c;
  document.querySelectorAll('.vf-item').forEach((el, j) => el.classList.toggle('picked', j === i));
  $('vf-pick').innerHTML = `<button class="cat-btn w-full py-2.5 rounded-xl text-sm" onclick="doVerify()">确认并自动核验：${esc(c.name)}</button>`;
}
async function doVerify() {
  const c = S._vf.picked;
  if (!c) return;
  try {
    const r = await api('POST', `/api/orgs/${S.org.id}/verify`, { name: c.name, credit_code: c.credit_code, legal_person: c.legal_person });
    closeModal();
    toast('核验通过，蓝标花标已点亮');
    const d2 = await api('GET', `/api/orgs/${S.org.id}`);
    S.org = d2.org; S.orgRole = d2.role;
    go('boss', { tab: 'org' }, true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------- 履历分享文本（修复原未定义引用） ---------- */
async function copyGrowthText() {
  const d = S.data.mine;
  if (!d || !d.org_view) return toast('暂无可复制的履历', 'err');
  const v = d.org_view;
  const lines = [
    `我的贡献履历 · ${S.org.name}`,
    `等级：${v.level.level} · 累计 ${v.total_points} ${S.org.currency_name}`,
    ...v.by_category.filter(c => c.count > 0).map(c => `- ${c.name}：${c.count} 次 / ${c.points} 分`),
  ];
  try { await navigator.clipboard.writeText(lines.join('\n')); toast('履历文本已复制'); }
  catch { toast('复制失败：浏览器未授权剪贴板', 'err'); }
}
/** 分类标签选择器 + 新增/删除（与分工标签同款交互） */
let _catEdit = false;
function catRenderPicker() {
  const el = document.getElementById('nt-cat-picker');
  if (!el || !S.data.txCats) return;
  el.innerHTML = (S.data.txCats || []).map(c =>
    `<button type="button" class="rounded-full text-xs font-medium transition" style="padding:5px 12px;${S._ntCat === c.id ? `background:${c.color};color:#fff` : 'background:#f2ecdf;color:#6b6357'}" onclick="catPick('${c.id}')">${esc(c.name)}${_catEdit ? ` <span class="text-red-300" onclick="event.stopPropagation();catDelConfirm('${c.id}','${esc(c.name)}')">✕</span>` : ''}</button>`
  ).join('') +
  `<button type="button" class="rounded-full text-xs text-gray-400 border border-dashed border-gray-300 hover:border-gray-400" style="padding:5px 10px" onclick="catAddPrompt()">＋ 新分类</button>`;
}
function catPick(id) { S._ntCat = id; catRenderPicker(); }
function catAddPrompt() {
  const name = prompt('输入新分类名称（最多 12 字）：');
  if (!name || !name.trim()) return;
  api('POST', `/api/orgs/${S.org.id}/tx-categories`, { name: name.trim() }).then(() => {
    toast('分类已添加');
    return api('GET', `/api/orgs/${S.org.id}/categories`);
  }).then(r => { S.data.txCats = r.tx_categories; catRenderPicker(); }).catch(e => toast(e.message, 'err'));
}
function catDelConfirm(id, name) {
  openModal(`<h3 class="font-bold text-gray-800 mb-2">确认删除分类「${esc(name)}」？</h3>
  <p class="text-xs text-gray-400 mb-4">该分类下还有任务时无法删除。</p>
  <div class="flex gap-2">
    <button class="flex-1 py-2 rounded-xl border text-sm" onclick="closeModal()">取消</button>
    <button class="flex-1 py-2 rounded-xl text-sm text-white bg-red-500" onclick="closeModal();catDoDelete('${id}')">确认删除</button>
  </div>`);
}
function catDoDelete(id) {
  api('DELETE', `/api/categories/${id}`).then(() => {
    toast('分类已删除');
    return api('GET', `/api/orgs/${S.org.id}/categories`);
  }).then(r => { S.data.txCats = r.tx_categories; catRenderPicker(); }).catch(e => toast(e.message, 'err'));
}

/* 全局发现与首次引导：账户归用户，社区只是其中一个协作空间。 */
const DISCOVERY_TOPICS = ['AI 实践', '学习交流', '内容创作', '活动共建', '项目协作', '产业连接'];
// ponytail: 活动主题暂按关键词匹配，可能漏判；内容增多后改用发布者确认的活动主题字段。
const TOPIC_WORDS = {
  'AI 实践': /AI|人工智能|模型|编程|黑客松/i, '学习交流': /学习|分享|交流|工作坊|课程|读书/,
  '内容创作': /内容|视频|图文|报道|媒体|海报/, '活动共建': /活动|晚会|策划|志愿|运营|主理/,
  '项目协作': /项目|协作|交付|产品|开发/, '产业连接': /产业|资源|商业|合作|赞助|人才|场地/
};
function audienceName(a) { return ({public:'公开 · 无需入会', members:'社区成员', internal:'内部协作'})[a] || '社区成员'; }
async function landAfterLogin() {
  S.org = null;
  if (!S.user.onboarding_done) {
    try {
      const first = await api('POST', '/api/me/onboarding/start', {});
      S.user = first.user;
      if (first.show) { showWelcome(); return; }
    } catch(e) { showView('auth'); toast('引导状态加载失败，请重新登录：' + e.message, 'err'); return; }
  }
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) {
    try {
      const joined = await api('POST', `/api/invites/${encodeURIComponent(invite)}/claim`, {});
      const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('invite'); history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      const me = await api('GET', '/api/me'); S.memberships = me.memberships || [];
      toast(joined.already ? '你已是该组织成员' : '已加入组织');
      await enterOrg(joined.org_id || S.memberships.find(m => m.org_id)?.org_id); return;
    } catch (e) { toast('入驻邀请未完成：' + e.message, 'err'); }
  }
  const target = new URLSearchParams(location.search).get('org') || S.user.home_org_id;
  if (target && S.memberships.some(m => m.org_id === target)) await enterOrg(target);
  else await backToOrgs('discover');
}
function showWelcome(step = 0) {
  if (step === 0) { S.welcomeInterests = [...(S.user.interests || [])]; S.welcomeHome = S.user.home_org_id || ''; }
  S.welcomeStep = step;
  S.welcomeInterests ||= [...(S.user.interests || [])];
  showView('welcome');
  const slides = [
    ['从一件喜欢的事，\n遇见一起做事的人。', '发现不同社区的活动与公开任务。先看看，再选择参与；每一次同行，都从你的兴趣开始。', '发现活动 · 浏览社区 · 认领公开任务'],
    ['每一份付出，\n先有清楚的约定。', '做什么、怎样验收、有什么回报，认领前就能看清。提交成果后，由负责人审核确认，让贡献有据可查。', '认领任务 · 提交成果 · 查看确认记录'],
    ['社区可以不同，\n成长始终属于你。', '已确认的成果留在个人空间。回看参与记录，整理自己的贡献，让下一次合作从看得见的经历开始。', '个人成果 · 参与记录 · 分类报表']
  ];
  const [title, text, flow] = slides[step];
  const scenes = [
    `<div class="guide-scene guide-discover"><img src="/mascot.jpg" alt="花猫社区猫咪"><div><span>一次相遇的开始</span><h2>一起，把想法做出来</h2><p>AI 实践 / 内容创作 / 活动共建</p></div><div class="guide-ticket"><span>活动示意</span><strong>周末共创工作坊</strong><p>带一个想法来，和伙伴一起动手。</p><small>先了解活动，再决定参加</small></div></div>`,
    `<div class="guide-scene guide-agreement"><span>任务约定示意</span><h2>为一场活动，留下好故事。</h2><dl><dt>交付什么</dt><dd>活动图文记录一份</dd><dt>如何确认</dt><dd>主理人按约定审核成果</dd><dt>回报依据</dt><dd>认领前查看积分或报酬规则</dd></dl><p>具体回报以任务约定与审核结果为准。</p></div>`,
    `<div class="guide-scene guide-record"><span>个人成果示意</span><h2>做过的事，成为你的名片。</h2><ol><li><strong>参与一场共创活动</strong><span>留下参与记录</span></li><li><strong>提交自己的作品</strong><span>经确认后进入个人成果</span></li><li><strong>带着经历继续探索</strong><span>在个人空间回看与整理</span></li></ol></div>`
  ];
  $('welcome-body').innerHTML = `<section class="welcome-card">
    <header class="guide-header"><b>花猫<span>共创社区</span></b><button class="tab-btn" onclick="finishWelcome(true)">${S.user.onboarding_done ? '返回工作台' : '跳过引导'}</button></header>
    <div class="guide-layout"><div class="guide-story"><h1 tabindex="-1" id="guide-title">${title.replace('\n','<br>')}</h1><p class="welcome-copy">${text}</p><p class="guide-features">${flow}</p></div>${scenes[step]}</div>
    ${step === 2 ? `<div class="guide-preferences"><h2>先从你感兴趣的事开始</h2><p>可多选，也可以直接看全部；不会自动加入社区。</p><div class="interest-grid">${DISCOVERY_TOPICS.map(t => `<button class="interest-chip" aria-pressed="${S.welcomeInterests.includes(t)}" onclick="toggleInterest('${t}')">${t}</button>`).join('')}</div>
    <label for="welcome-home">以后打开时</label><select id="welcome-home" onchange="S.welcomeHome=this.value"><option value="">发现全平台的活动与任务</option>${S.memberships.map(m => `<option value="${esc(m.org_id)}" ${S.welcomeHome === m.org_id ? 'selected' : ''}>回到 ${esc(m.name)}</option>`).join('')}</select></div>` : ''}
    <footer class="guide-footer"><div class="guide-progress" aria-label="第 ${step + 1} 步，共 3 步">${slides.map((_,i)=>`<span class="${i===step?'current':''}"></span>`).join('')}<small>${step+1} / 3</small></div><div class="welcome-actions">${step ? `<button class="tab-btn" onclick="showWelcome(${step-1})">上一步</button>` : ''}<button class="cat-btn" onclick="${step < 2 ? `showWelcome(${step+1})` : 'finishWelcome(false)'}">${step < 2 ? '继续了解' : '开始探索'}</button></div></footer>
    <p class="guide-note">完成或跳过后不再自动展示，可在头像菜单重看。</p></section>`;
  $('guide-title').focus({ preventScroll: true });
}
function toggleInterest(t) {
  S.welcomeInterests = S.welcomeInterests.includes(t) ? S.welcomeInterests.filter(x => x !== t) : [...S.welcomeInterests,t];
  showWelcome(2);
}
async function finishWelcome(skip) {
  if (S.savingWelcome) return;
  S.savingWelcome = true;
  try {
    const d = await api('PUT','/api/me/onboarding',{ interests: skip ? (S.user.interests || []) : S.welcomeInterests, home_org_id: skip ? (S.user.home_org_id || null) : (S.welcomeHome || null) });
    S.user = d.user; S.discoveryTopic = undefined;
    // 引导结束先到发现：让用户看见适合自己的机会；后续日常登录仍遵循默认社区。
    S.spaceTab = 'discover';
    await backToOrgs('discover'); await handleCheckHash();
  } catch(e) { toast('未能保存引导状态，请重试：'+e.message,'err'); }
  finally { S.savingWelcome = false; }
}
async function setHomeOrg(id) {
  try { S.user = (await api('PUT','/api/me/onboarding',{interests:S.user.interests || [],home_org_id:id})).user; toast('默认入口已保存'); }
  catch(e) { toast(e.message,'err'); }
}
async function discoveryHtml() {
  let d;
  try { d = await api('GET','/api/discovery'); }
  catch(e) { return `<p role="alert">${esc(e.message)}</p><button class="tab-btn" onclick="backToOrgs('discover')">重试</button>`; }
  S.discovery = d;
  if (S.discoveryTopic === undefined) S.discoveryTopic = S.user?.interests?.length ? '我的兴趣' : '';
  return `<section class="discovery-hero"><h1>找到同路人，<br>一起把想法做出来。</h1><p>每一次浏览，都通向一件值得参与的事：先看活动与任务，再决定加入、认领或共建。</p><div class="discovery-intents" aria-label="我想做什么">
      <button type="button" onclick="discoveryIntent('activities')"><b>参加一场活动</b><span>认识伙伴，获得真实参与经历</span></button>
      <button type="button" onclick="discoveryIntent('tasks')"><b>认领一件任务</b><span>先看交付、验收与回报约定</span></button>
      ${S.user ? `<button type="button" onclick="spaceGo('feed')"><b>看看我的成果</b><span>回看已确认的贡献与记录</span></button>` : `<button type="button" onclick="showView('auth')"><b>先建立我的记录</b><span>登录后保存你的参与与成果</span></button>`}
    </div><div class="discovery-top"><span>活动可直接报名 · 公开任务可直接认领</span><span class="flex gap-2">${S.user ? '<button class="tab-btn" onclick="useNearby()">附近活动</button><button class="tab-btn" onclick="spaceGo(\'orgs\')">我的社区</button>' : ''}</span></div></section>
    <form class="discovery-search" onsubmit="event.preventDefault();S.discoveryQuery=this.elements.q.value;renderDiscoveryResults()"><input name="q" aria-label="搜索活动和任务" placeholder="搜索活动、任务或社区" value="${esc(S.discoveryQuery || '')}"><button class="cat-btn">搜索</button></form>
    <div class="interest-grid discovery-chips">${['',...(S.user?.interests?.length ? ['我的兴趣'] : []),...DISCOVERY_TOPICS].map(t=>`<button class="interest-chip" data-topic="${t}" aria-pressed="${S.discoveryTopic === t}" onclick="S.discoveryTopic='${t}';renderDiscoveryResults()">${t || '全部兴趣'}</button>`).join('')}</div>
    <div class="task-state-tabs"><button data-kind="activities" aria-pressed="${S.discoveryKind !== 'tasks'}" onclick="S.discoveryKind='activities';renderDiscoveryResults()">开放活动 · ${d.activities.length}</button><button data-kind="tasks" aria-pressed="${S.discoveryKind === 'tasks'}" onclick="S.discoveryKind='tasks';renderDiscoveryResults()">公开任务 · ${d.tasks.length}</button></div>
    <p class="text-xs text-gray-500 mb-3">按主题关键词筛选，可随时查看全部。${S.demoMode ? '当前为演示数据，不代表真实活动或回报承诺。' : ''}</p>
    <div id="discovery-results" aria-live="polite">${discoveryResults()}</div>`;
}
function discoveryIntent(kind) {
  S.discoveryKind = kind;
  renderDiscoveryResults();
  $('discovery-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function useNearby() {
  if (!navigator.geolocation) return toast('当前浏览器不支持定位，仍可按地点文字筛选', 'warn');
  toast('正在按你附近的位置排序…', 'warn');
  navigator.geolocation.getCurrentPosition(pos => {
    S.nearbyGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    S.discoveryKind = 'activities'; renderDiscoveryResults();
    $('discovery-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, () => toast('未获得定位授权；你的精确位置不会被保存', 'warn'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
}
function nearbyKm(a) {
  if (!S.nearbyGeo) return null;
  const lat = Number(a.geo_lat ?? a.base_lat), lng = Number(a.geo_lng ?? a.base_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rad = Math.PI / 180, dLat = (lat - S.nearbyGeo.lat) * rad, dLng = (lng - S.nearbyGeo.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(S.nearbyGeo.lat * rad) * Math.cos(lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(x)) * 10) / 10;
}
function discoveryResults() {
  const kind = S.discoveryKind || 'activities';
  const q = (S.discoveryQuery || '').trim().toLowerCase();
  const items = (S.discovery?.[kind] || []).filter(a => {
    const text = [a.title,a.name,a.description,a.org_name,a.topic,a.keywords].join(' ');
    const topics = S.discoveryTopic === '我的兴趣' ? S.user.interests : [S.discoveryTopic];
    return (!q || text.toLowerCase().includes(q)) && (!S.discoveryTopic || topics.some(t=>a.topic===t || TOPIC_WORDS[t]?.test(text)));
  }).map(a => ({ ...a, nearby_km: kind === 'activities' ? nearbyKm(a) : null })).sort((a,b) => (a.nearby_km == null) - (b.nearby_km == null) || (a.nearby_km ?? 0) - (b.nearby_km ?? 0));
  return items.length ? `<div class="discovery-grid">${items.map(a => `<article class="opportunity-card"><p class="eyebrow">${esc(a.org_name)}</p><h2>${esc(a.title || a.name)}</h2><p class="opportunity-description">${esc(a.description)}</p>
    ${kind === 'activities' ? `<p>${dt(a.start_at)} · ${esc(a.location || a.base_location || '地点待公布')}${a.nearby_km != null ? ' · 距你约 ' + a.nearby_km + ' km' : ''}</p><button class="cat-btn" onclick="openDiscoveryActivity('${a.id}')">查看活动</button>` : `<p class="reward-line">${esc(({points:'积分兑换',cash:'固定报酬',share:'项目分成'})[a.reward_kind])}${a.points_max > 0 ? ' · '+a.points_min+'-'+a.points_max+' '+esc(a.currency_name) : ''}</p><p>${esc(a.reward_terms)}</p><p class="text-xs text-gray-500">${a.slots ? `剩余 ${Math.max(0,a.slots-a.claimed_count)} 个名额` : '不限名额'} · 无需加入社区</p><button class="cat-btn" onclick="openPublicTask('${a.id}')">查看付出与回报</button>`}</article>`).join('')}</div>` : `<div class="cat-card rounded-2xl p-6"><h2>这个方向暂时没有开放机会</h2><p class="text-sm text-gray-500 my-3">换个兴趣看看，或查看全部社区的机会。</p><button class="tab-btn" onclick="S.discoveryTopic='';S.discoveryQuery='';backToOrgs('discover')">查看全部</button></div>`;
}
function renderDiscoveryResults() {
  document.querySelectorAll('[data-topic]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.topic===S.discoveryTopic)));
  document.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.kind===(S.discoveryKind || 'activities'))));
  $('discovery-results').innerHTML=discoveryResults();
}
function openDiscoveryActivity(id) {
  const a=S.discovery.activities.find(x=>x.id===id); if(!a)return;
  const member=S.memberships.some(m=>m.org_id===a.org_id);
  openModal(`<h2 class="text-xl font-bold">${esc(a.title)}</h2><p class="text-sm my-3">${esc(a.org_name)} · ${dt(a.start_at)} · ${esc(a.location || a.base_location || '地点待公布')}</p><dl class="task-agreement"><dt>这场活动会做什么</dt><dd>${esc(a.description || '主办方暂未补充')}</dd><dt>流程安排</dt><dd>${esc(a.agenda || '主办方暂未补充')}</dd><dt>参加前准备</dt><dd>${esc(a.preparation || '主办方暂未补充')}</dd></dl><p class="text-sm my-3">报名只加入这场活动，不会自动成为该社区的成员或收到其日常通知。</p><button class="cat-btn px-4 py-2" onclick="registerDiscoveryActivity('${a.id}')">${!S.user ? '登录后报名' : '报名这场活动'}</button>${member ? `<button class="tab-btn ml-2" onclick="closeModal();enterOrg('${a.org_id}')">进入社区</button>` : ''}<button class="tab-btn ml-2" onclick="closeModal()">继续逛逛</button>`);
}
async function registerDiscoveryActivity(id) {
  if (!S.user) { closeModal(); showView('auth'); return; }
  try { await api('POST', `/api/activities/${id}/register`); closeModal(); toast('报名成功：这不会让你自动加入社区'); await backToOrgs('discover'); }
  catch (e) { toast(e.message, 'err'); }
}
async function publicWorkHtml() {
  const d=await api('GET','/api/me/public-tasks'); S.publicWork=d.tasks;
  if(!d.tasks.length)return '';
  return `<h2 class="font-bold mb-3">我认领的公开任务</h2><div class="discovery-grid mb-4">${d.tasks.map(t=>`<article class="opportunity-card"><p class="eyebrow">${esc(t.org_name)}</p><h3>${esc(t.name)}</h3><p>${({pending:'待验收',approved:'已确认',rejected:'需修改'})[t.submission_status] || '待提交'}</p><button class="tab-btn" onclick="openPublicTask('${t.id}')">查看任务 / 提交</button><button class="tab-btn" onclick="openContributorMall('${t.org_id}')">兑换福利</button></article>`).join('')}</div>`;
}
async function openPublicTask(id) {
  if(S.user) S.publicWork=(await api('GET','/api/me/public-tasks')).tasks;
  const claimed=S.publicWork?.find(t=>t.id===id);
  const t=claimed || S.discovery?.tasks.find(t=>t.id===id);if(!t)return;
  S.selectedPublicTask=t;
  openModal(`<h2 class="text-xl font-bold">${esc(t.name)}</h2><p class="eyebrow">${esc(t.org_name)} · 公开任务 · 无需入会</p><dl class="task-agreement"><dt>付出与交付</dt><dd>${esc(t.description)}</dd><dt>验收标准</dt><dd>${esc(t.acceptance)}</dd><dt>回报与兑现</dt><dd>${t.points_max > 0 ? t.points_min+'-'+t.points_max+' '+esc(t.currency_name)+'<br>' : ''}${esc(t.reward_terms)}</dd></dl><p class="text-xs text-gray-500 mb-3">${t.reward_kind === 'points' ? '积分按发布社区分别记账，兑换以该社区库存和规则为准。' : '现金/分成由发布方按约定结算；审核通过不代表现金已到账。'}</p>
    ${claimed && !['approved','pending'].includes(t.submission_status) ? `<label for="public-evidence">成果说明 / 交付链接</label><textarea id="public-evidence" rows="3"></textarea><button class="cat-btn px-4 py-2 mt-3" onclick="submitPublicTask('${crypto.randomUUID()}')">提交验收</button>` : claimed ? `<p>${t.submission_status==='approved'?'成果已确认，可在参与页兑换福利或查看收益记录。':'已提交，等待发布方验收。'}</p>` : `<button class="cat-btn px-4 py-2" onclick="claimPublicTask()">${S.user?'认可任务约定并认领':'登录后认领'}</button>`}
    <button class="tab-btn ml-2" onclick="closeModal()">关闭</button>`);
}
async function claimPublicTask() {
  if(!S.user){closeModal();showView('auth');return;}
  try {await api('POST',`/api/tasks/${S.selectedPublicTask.id}/claim`);toast('已认领，未加入社区');await openPublicTask(S.selectedPublicTask.id);}catch(e){toast(e.message,'err');}
}
async function submitPublicTask(token) {
  const t=S.selectedPublicTask; const evidence=$('public-evidence').value.trim();if(!evidence)return toast('请填写成果说明或交付链接','err');
  try {await api('POST',`/api/orgs/${t.org_id}/submissions`,{task_id:t.id,title:t.name,evidence,client_token:token});closeModal();toast('已提交验收');await spaceGo('joined');}catch(e){toast(e.message,'err');}
}
async function openContributorMall(orgId) {
  try {
    const d=await api('GET',`/api/orgs/${orgId}/mall`);
    openModal(`<h2 class="text-xl font-bold">该社区的兑换福利</h2><p class="my-3">可用积分：${d.points} · 仅限本社区</p><div class="space-y-3">${d.items.map(i=>`<div><b>${esc(i.name)}</b><p>${i.cost} 积分 · 库存 ${i.stock}</p><button class="tab-btn" ${i.stock<=0||d.points<i.cost?'disabled':''} onclick="exchangePublicReward('${orgId}','${i.id}')">兑换</button></div>`).join('') || '暂无可兑换福利，请联系发布方兑现约定。'}</div><h3 class="font-bold mt-4">兑换记录</h3>${d.myOrders.map(o=>`<p>${esc(o.item_name)} · ${esc(o.status)}</p>`).join('') || '<p>暂无记录</p>'}<button class="tab-btn mt-4" onclick="closeModal()">关闭</button>`);
  }catch(e){toast(e.message,'err');}
}
async function exchangePublicReward(orgId,id) {try{await api('POST',`/api/orgs/${orgId}/mall/exchange`,{item_id:id});toast('兑换成功，请按记录联系社区领取');await openContributorMall(orgId);}catch(e){toast(e.message,'err');}}
function taskTermsFields(t={}, prefix='tt') {
  return `<label>谁能认领<select id="${prefix}-audience">${[['members','社区成员'],['internal','内部协作成员'],['public','所有人（无需加入社区）']].map(([k,n])=>`<option value="${k}" ${t.audience===k?'selected':''}>${n}</option>`).join('')}</select></label>
  <label>主题<select id="${prefix}-topic"><option value="">未分类</option>${DISCOVERY_TOPICS.map(x=>`<option ${t.topic===x?'selected':''}>${x}</option>`).join('')}</select></label>
  <label>回报类型<select id="${prefix}-reward">${[['points','积分兑换福利'],['cash','固定现金报酬（按约定结算）'],['share','项目分成（非保底）']].map(([k,n])=>`<option value="${k}" ${t.reward_kind===k?'selected':''}>${n}</option>`).join('')}</select></label>
  <label>验收标准<textarea id="${prefix}-acceptance" rows="2" placeholder="交付物、截止时间、验收人及审核时限">${esc(t.acceptance || '')}</textarea></label>
  <label class="md:col-span-2">回报与兑现规则<textarea id="${prefix}-terms" rows="3" placeholder="积分：能换什么、需多少分、库存/有效期、领取方式；现金：金额、付款方、支付时间；分成：收入或利润口径、比例/积分权重、成本、结算时间、失败或取消如何处理。">${esc(t.reward_terms || '')}</textarea></label>`;
}
function readTaskTerms(prefix='tt'){const field=n=>$(prefix+'-'+n);return {audience:field('audience').value,topic:field('topic').value,reward_kind:field('reward').value,acceptance:field('acceptance').value.trim(),reward_terms:field('terms').value.trim()};}
function editTaskTerms(id) {
  const t=S.data.libraryTasks.find(x=>x.id===id);if(!t)return;
  openModal(`<h2 class="font-bold mb-3">${esc(t.name)} · 任务与回报</h2><p class="text-xs text-gray-500 mb-3">有人认领后，付出与回报不可修改。需要新约定时，请下架并新建任务。</p><label>任务内容<textarea id="tt-description">${esc(t.description)}</textarea></label><div class="grid md:grid-cols-2 gap-3">${taskTermsFields(t,'edit-tt')}</div><div class="flex gap-2 mt-4"><button class="cat-btn px-3 py-2" onclick="saveTaskTerms('${id}','published')">保存并发布</button><button class="tab-btn" onclick="saveTaskTerms('${id}','draft')">存草稿</button><button class="tab-btn" onclick="closeModal();toggleTaskStatus('${id}','archived')">下架</button><button class="tab-btn" onclick="closeModal()">取消</button></div>`);
}
async function saveTaskTerms(id,status){try{await api('PUT',`/api/tasks/${id}`,{...readTaskTerms('edit-tt'),description:$('tt-description').value,status});closeModal();toast(status==='published'?'已发布':'草稿已保存');await go('team',{tab:'library'},true);}catch(e){toast(e.message,'err');}}
