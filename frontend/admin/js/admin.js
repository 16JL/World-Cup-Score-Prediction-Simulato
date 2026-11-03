// ===== 庄家管理后台 - 前端逻辑 =====
const ADMIN_API = '/api/admin';
let adminToken = sessionStorage.getItem('admin_token');
let adminUser = null;

// ===== 国旗映射 =====
const COUNTRY_CODE = {
  '墨西哥':'mx','南非':'za','韩国':'kr','捷克':'cz','加拿大':'ca','波黑':'ba',
  '卡塔尔':'qa','瑞士':'ch','巴西':'br','摩洛哥':'ma','海地':'ht','苏格兰':'gb-sct',
  '美国':'us','巴拉圭':'py','澳大利亚':'au','土耳其':'tr','德国':'de','库拉索':'cw',
  '科特迪瓦':'ci','厄瓜多尔':'ec','荷兰':'nl','日本':'jp','突尼斯':'tn','瑞典':'se',
  '比利时':'be','埃及':'eg','伊朗':'ir','新西兰':'nz','西班牙':'es','佛得角':'cv',
  '沙特阿拉伯':'sa','乌拉圭':'uy','法国':'fr','塞内加尔':'sn','挪威':'no','伊拉克':'iq',
  '阿根廷':'ar','阿尔及利亚':'dz','奥地利':'at','约旦':'jo','葡萄牙':'pt','刚果(金)':'cd',
  '乌兹别克斯坦':'uz','哥伦比亚':'co','英格兰':'gb-eng','克罗地亚':'hr','加纳':'gh','巴拿马':'pa',
  '待定': null,
};
function getFlagImg(team) {
  const code = COUNTRY_CODE[team];
  if (!code) return '<span class="flag-placeholder">-</span>';
  return `<img src="https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/4.1.4/flags/4x3/${code === 'gb-eng' ? 'gb-eng' : code === 'gb-sct' ? 'gb-sct' : code}.svg" class="team-flag-img" alt="" onerror="this.parentElement.insertAdjacentHTML('beforeend','<span class=\\'flag-text\\'>${code.toUpperCase()}</span>');this.remove();">`;
}

// ===== 检测当前页面 =====
document.addEventListener('DOMContentLoaded', () => {
  const isLoginPage = window.location.pathname.includes('login.html') || window.location.pathname === '/admin' || window.location.pathname.endsWith('/admin/');

  if (document.getElementById('adminLoginForm')) {
    initAdminLogin();
  } else if (document.querySelector('.admin-sidebar')) {
    if (!adminToken) {
      window.location.href = '/admin/login.html';
      return;
    }
    checkAdminAuth();
  }
});

// ===== 管理后台时间更新 =====
function updateTime() {
  const el = document.getElementById('topbarTime');
  if (el) el.textContent = new Date().toLocaleString('zh-CN');
}
setInterval(updateTime, 1000);
updateTime();

// ===== Toast =====
function showAdminToast(msg) {
  const toast = document.getElementById('adminToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ===== 庄家登录 =====
function initAdminLogin() {
  document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('adminUsername').value.trim();
    const password = document.getElementById('adminPassword').value;
    const fa2 = document.getElementById('admin2FA').value.trim();

    if (!username || !password || !fa2) {
      return showAdminToast('请填写完整信息');
    }

    const btn = document.getElementById('adminLoginBtn');
    btn.disabled = true;
    btn.querySelector('.btn-text').textContent = '验证中...';

    try {
      const res = await fetch(`${ADMIN_API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, twoFactorCode: fa2 })
      });
      const data = await res.json();
      if (data.code === 200) {
        adminToken = data.data.token;
        adminUser = data.data.user;
        sessionStorage.setItem('admin_token', adminToken);
        showAdminToast('身份验证通过');
        setTimeout(() => { window.location.href = '/admin/index.html'; }, 400);
      } else {
        showAdminToast(data.msg || '登录失败');
      }
    } catch (err) {
      showAdminToast('网络错误');
    }

    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '验证身份并登录';
  });
}

// ===== 认证检查 =====
async function checkAdminAuth() {
  try {
    const res = await fetch(`${ADMIN_API}/verify`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      adminUser = data.data;
      initAdminDashboard();
    } else {
      sessionStorage.removeItem('admin_token');
      window.location.href = '/admin/login.html';
    }
  } catch (err) {
    showAdminToast('服务器连接失败');
  }
}

// ===== 管理后台初始化 =====
function initAdminDashboard() {
  document.getElementById('sidebarAdminName').textContent = adminUser.username || '庄家';

  // 侧边栏导航
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const page = link.dataset.page;
      switchAdminPage(page);
    });
  });

  // 退出
  document.getElementById('btnAdminLogout').addEventListener('click', () => {
    sessionStorage.removeItem('admin_token');
    window.location.href = '/admin/login.html';
  });

  // IP显示
  fetch(`${ADMIN_API}/ip`)
    .then(r => r.json())
    .then(d => { if (d.data) document.getElementById('adminIP').textContent = d.data.ip; })
    .catch(() => {});

  // 加载玩法开关
  loadPlayTypes();

  // 默认加载仪表盘
  loadDashboard();
}

function switchAdminPage(page) {
  document.querySelectorAll('.admin-page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page${page.charAt(0).toUpperCase() + page.slice(1)}`).classList.add('active');

  const titles = { dashboard: '仪表盘', matches: '比赛管理', odds: '盘口赔率', users: '用户管理', recharge: '充值管理', funds: '资金流水', bets: '投注监控', settle: '比赛结算', sync: '赔率同步', results: '开奖结果' };
  document.getElementById('topbarTitle').textContent = titles[page] || page;

  switch(page) {
    case 'dashboard': loadDashboard(); break;
    case 'matches': loadAdminMatches(); break;
    case 'odds': loadAdminOdds(); break;
    case 'users': loadAdminUsers(); break;
    case 'recharge': /* 无需加载，页面已就绪 */ break;
    case 'funds': loadAdminFunds(); break;
    case 'bets': loadAdminBets(); break;
    case 'settle': loadAdminSettle(); break;
    case 'sync': loadSyncPage(); break;
    case 'results': loadResultsPage(); break;
  }
}

// ===== 仪表盘 =====
async function loadDashboard() {
  try {
    const res = await fetch(`${ADMIN_API}/dashboard`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const d = data.data;
    document.getElementById('statTotalUsers').textContent = d.totalUsers;
    document.getElementById('statTotalBalance').innerHTML = '<img src="../images/coin-reverse.png" class="coin-unit-icon">' + (d.totalBalance || 0).toFixed(2);
    document.getElementById('statTotalBets').textContent = d.totalBets;
    document.getElementById('statTotalPayout').innerHTML = '<img src="../images/coin-reverse.png" class="coin-unit-icon">' + (d.totalPayout || 0).toFixed(2);
    document.getElementById('statPlatformProfit').innerHTML = '<img src="../images/coin-reverse.png" class="coin-unit-icon">' + (d.platformProfit || 0).toFixed(2);
    document.getElementById('statLiveMatches').textContent = d.liveMatches;

    // 今日数据
    const today = d.today || {};
    document.getElementById('todayStats').innerHTML = `
      <div class="today-stat-row"><span class="today-stat-label">今日新增用户</span><span class="today-stat-value">${today.newUsers || 0}</span></div>
      <div class="today-stat-row"><span class="today-stat-label">今日投注笔数</span><span class="today-stat-value">${today.bets || 0}</span></div>
      <div class="today-stat-row"><span class="today-stat-label">今日投注金额</span><span class="today-stat-value"><img src="../images/coin-reverse.png" class="coin-unit-icon">${(today.betAmount || 0).toFixed(2)}</span></div>
      <div class="today-stat-row"><span class="today-stat-label">今日赔付金额</span><span class="today-stat-value"><img src="../images/coin-reverse.png" class="coin-unit-icon">${(today.payout || 0).toFixed(2)}</span></div>
      <div class="today-stat-row"><span class="today-stat-label">今日盈亏</span><span class="today-stat-value" style="color:${(today.profit || 0) >= 0 ? 'var(--admin-success)' : 'var(--admin-primary-light)'}"><img src="../images/coin-reverse.png" class="coin-unit-icon">${(today.profit || 0).toFixed(2)}</span></div>
      <div class="today-stat-row"><span class="today-stat-label">今日充值</span><span class="today-stat-value"><img src="../images/coin-reverse.png" class="coin-unit-icon">${(today.recharge || 0).toFixed(2)}</span></div>
    `;

    // 最近投注
    const recent = d.recentBets || [];
    document.getElementById('recentBets').innerHTML = recent.length === 0
      ? '<div style="color:var(--admin-text-muted);padding:20px;text-align:center;">暂无数据</div>'
      : recent.map(b => `
        <div class="recent-bet-item">
          <span>${b.username || '-'}</span>
          <span>${b.home_team || ''} vs ${b.away_team || ''}</span>
          <span><img src="../images/coin-reverse.png" class="coin-unit-icon">${b.bet_amount}</span>
          <span class="status-badge ${b.status}">${b.status === 'pending' ? '待开奖' : (b.result === 'win' ? '中奖' : '未中')}</span>
        </div>
      `).join('');
  } catch (err) {
    showAdminToast('数据加载失败');
  }
}

// ===== 比赛管理 =====
async function loadAdminMatches() {
  const filterStatus = document.getElementById('filterMatchStatus')?.value || 'all';
  const filterStage = document.getElementById('filterMatchStage')?.value || 'all';

  try {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.append('status', filterStatus);
    if (filterStage !== 'all') params.append('stage', filterStage);

    const res = await fetch(`${ADMIN_API}/matches?${params}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const statusNames = { upcoming: '即将开始', live: '进行中', finished: '已结束', paused: '已暂停', drawn: '已开奖' };
    const statusClassMap = { upcoming: 'upcoming', live: 'live', finished: 'finished', paused: 'paused', drawn: 'drawn' };

    const tbody = document.querySelector('#adminMatchTable tbody');
    tbody.innerHTML = data.data.map(m => {
      const scoreMode = m.score_mode || 'auto';
      const scoreText = m.home_score != null ? m.home_score + ':' + m.away_score : '-';
      const lastSyncText = scoreMode === 'auto' ? (m.score_mode_changed_at ? new Date(m.score_mode_changed_at).toLocaleTimeString('zh-CN') : '--') : '手动';
      const statusText = statusNames[m.status] || m.status;

      const statusActions = ['upcoming', 'live', 'paused', 'finished']
        .filter(s => s !== m.status)
        .map(s => `<button class="btn-admin-xs" onclick="setMatchStatus(${m.id},'${s}')">${statusNames[s]}</button>`)
        .join('');

      // 开奖按钮（已结束+有比分+未开奖）
      let drawAction = '';
      if (m.status === 'finished' && m.home_score != null && m.away_score != null) {
        drawAction = `<button class="btn-admin-xs btn-draw" onclick="drawMatch(${m.id},'${m.home_team} vs ${m.away_team}',${m.home_score},${m.away_score})">🎰 开奖</button>`;
      }
      if (m.status === 'drawn') {
        drawAction = `<span style="font-size:11px;color:var(--admin-success);">✅ 已开奖</span>`;
      }

      return `<tr class="row-${m.status}">
        <td><input type="checkbox" class="match-check" value="${m.id}" onchange="updateSelectAll()"></td>
        <td>${m.id}</td>
        <td>
          <div style="font-size:13px;">${getFlagImg(m.home_team)} ${m.home_team}</div>
          <div style="font-size:11px;color:var(--admin-text-muted);">vs</div>
          <div style="font-size:13px;">${m.away_team} ${getFlagImg(m.away_team)}</div>
        </td>
        <td>${m.group_name ? m.group_name + '组' : m.stage}</td>
        <td style="font-size:11px;">${new Date(m.match_time).toLocaleString('zh-CN')}</td>
        <td>
          <span class="score-display" id="score_${m.id}" style="font-size:16px;font-weight:700;font-family:Consolas,monospace;">${scoreText}</span>
          ${scoreMode === 'manual' ? `<button class="btn-admin-xs" onclick="editScore(${m.id},${m.home_score||0},${m.away_score||0})">✏️</button>` : ''}
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;">${scoreMode === 'auto' ? '🔄自动' : '✋手动'}</span>
            <button class="btn-admin-xs" onclick="toggleScoreMode(${m.id},'${scoreMode}')">切换</button>
          </div>
          ${scoreMode === 'auto' ? `<div style="font-size:10px;color:var(--admin-text-muted);">同步: ${lastSyncText}</div>` : ''}
        </td>
        <td><span class="status-badge ${statusClassMap[m.status] || 'upcoming'}">${statusText}</span></td>
        <td>${statusActions}${drawAction}</td>
      </tr>`;
    }).join('');

    document.getElementById('filterMatchStatus').onchange = loadAdminMatches;
    document.getElementById('filterMatchStage').onchange = loadAdminMatches;
    document.getElementById('chkSelectAll').checked = false;
  } catch (err) {
    showAdminToast('加载比赛失败');
  }
}

// ===== 比赛操作 =====
async function setMatchStatus(id, status) {
  try {
    const res = await fetch(`${ADMIN_API}/match/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (data.code === 200) { showAdminToast(data.msg); loadAdminMatches(); }
    else showAdminToast(data.msg);
  } catch (e) { showAdminToast('操作失败'); }
}

async function toggleScoreMode(id, currentMode) {
  const newMode = currentMode === 'auto' ? 'manual' : 'auto';
  try {
    const res = await fetch(`${ADMIN_API}/match/${id}/score-mode`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ mode: newMode })
    });
    const data = await res.json();
    if (data.code === 200) { showAdminToast(data.msg); loadAdminMatches(); }
    else showAdminToast(data.msg);
  } catch (e) { showAdminToast('操作失败'); }
}

async function editScore(id, hs, as) {
  openAdminModal('手动录入比分', `
    <div class="man-score-row">
      <input type="number" id="editHomeScore" value="${hs}" min="0" max="99" style="width:80px;text-align:center;">
      <span style="font-size:20px;margin:0 12px;color:var(--admin-white);">:</span>
      <input type="number" id="editAwayScore" value="${as}" min="0" max="99" style="width:80px;text-align:center;">
    </div>
  `, async () => {
    const homeScore = parseInt(document.getElementById('editHomeScore').value);
    const awayScore = parseInt(document.getElementById('editAwayScore').value);
    if (isNaN(homeScore) || isNaN(awayScore)) return showAdminToast('请输入有效比分');

    const res = await fetch(`${ADMIN_API}/match/${id}/score`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ home_score: homeScore, away_score: awayScore })
    });
    const data = await res.json();
    if (data.code === 200) { showAdminToast(data.msg); closeAdminModal(); loadAdminMatches(); }
    else showAdminToast(data.msg);
  });
}

// 批量操作
function getSelectedMatchIds() {
  return [...document.querySelectorAll('.match-check:checked')].map(cb => parseInt(cb.value));
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.match-check').forEach(cb => { cb.checked = checked; });
}

function updateSelectAll() {
  const all = document.querySelectorAll('.match-check');
  const checked = document.querySelectorAll('.match-check:checked');
  document.getElementById('chkSelectAll').checked = all.length > 0 && checked.length === all.length;
}

async function batchSetStatus(status) {
  const ids = getSelectedMatchIds();
  if (ids.length === 0) return showAdminToast('请先选择比赛');
  if (!confirm(`确认将 ${ids.length} 场比赛设为"${status}"？`)) return;

  try {
    const res = await fetch(`${ADMIN_API}/match/batch-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ ids, status })
    });
    const data = await res.json();
    if (data.code === 200) { showAdminToast(data.msg); loadAdminMatches(); }
    else showAdminToast(data.msg);
  } catch (e) { showAdminToast('操作失败'); }
}

async function batchSetScoreMode(mode) {
  if (!mode) return;
  const ids = getSelectedMatchIds();
  if (ids.length === 0) return showAdminToast('请先选择比赛');

  try {
    const res = await fetch(`${ADMIN_API}/match/batch-score-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ ids, mode })
    });
    const data = await res.json();
    if (data.code === 200) { showAdminToast(data.msg); loadAdminMatches(); }
    else showAdminToast(data.msg);
  } catch (e) { showAdminToast('操作失败'); }
}

// ===== 开奖 =====
async function drawMatch(id, matchName, homeScore, awayScore) {
  if (!confirm(`确认对「${matchName}」(比分 ${homeScore}:${awayScore}) 执行开奖？\n\n系统将自动计算所有投注并发放奖金。此操作不可撤销！`)) return;

  try {
    const res = await fetch(`${ADMIN_API}/draw/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      showAdminToast(`开奖完成！中奖 ${data.data.win_count} 笔，派奖 <img src="../images/coin-reverse.png" class="coin-unit-icon">${data.data.total_prize}`);
      loadAdminMatches();
    } else {
      showAdminToast(data.msg);
    }
  } catch (e) {
    showAdminToast('开奖失败');
  }
}

// ===== 盘口赔率 =====
async function loadAdminOdds() {
  const filterStatus = document.getElementById('filterOddsStatus')?.value || 'upcoming';

  try {
    const res = await fetch(`${ADMIN_API}/matches?status=${filterStatus}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const tbody = document.querySelector('#adminOddsTable tbody');
    tbody.innerHTML = data.data.map(m => {
      const hText = m.handicap > 0 ? `+${m.handicap}` : m.handicap;
      return `<tr>
        <td>${m.home_team} vs ${m.away_team}</td>
        <td>${m.spf_win}/${m.spf_draw}/${m.spf_lose}</td>
        <td>${hText}</td>
        <td>${m.rqspf_win}/${m.rqspf_draw}/${m.rqspf_lose}</td>
        <td>${m.over_under_line}</td>
        <td>${m.dxq_over}/${m.dxq_under}</td>
        <td><button class="btn-admin-xs" onclick="editOdds(${m.id})">调整</button></td>
      </tr>`;
    }).join('');

    document.getElementById('filterOddsStatus').onchange = loadAdminOdds;
  } catch (err) {
    showAdminToast('加载盘口失败');
  }
}

// ===== 用户管理 =====
async function loadAdminUsers() {
  const search = document.getElementById('filterUserSearch')?.value || '';

  try {
    const params = new URLSearchParams();
    if (search) params.append('search', search);

    const res = await fetch(`${ADMIN_API}/users?${params}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const tbody = document.querySelector('#adminUserTable tbody');
    tbody.innerHTML = data.data.map(u => `<tr>
      <td>${u.id}</td>
      <td>${u.account || u.username || '-'}</td>
      <td>${u.email || '-'}</td>
      <td>${u.nickname || '-'}</td>
      <td style="font-family:Consolas,monospace;font-weight:600;"><img src="../images/coin-reverse.png" class="coin-unit-icon">${u.balance.toFixed(2)}</td>
      <td>${u.bet_count || 0}</td>
      <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('zh-CN') : '-'}</td>
      <td>
        <button class="btn-admin-xs" onclick="adjustBalance(${u.id},'${u.username}',${u.balance})">调整余额</button>
      </td>
    </tr>`).join('');

    document.getElementById('filterUserSearch').oninput = debounce(loadAdminUsers, 500);
  } catch (err) {
    showAdminToast('加载用户失败');
  }
}

// ===== 资金流水 =====
async function loadAdminFunds() {
  const type = document.getElementById('filterTxnType')?.value || 'all';

  try {
    const params = new URLSearchParams();
    if (type !== 'all') params.append('type', type);

    const res = await fetch(`${ADMIN_API}/transactions?${params}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;
    const list = data.data.list || data.data || [];

    // 统计摘要（资金流水页）
    const stats = data.data.stats;
    if (stats && document.getElementById('fsIncome')) {
      document.getElementById('fsIncome').textContent = stats.income.toFixed(2);
      document.getElementById('fsExpense').textContent = stats.expense.toFixed(2);
      document.getElementById('fsNet').textContent = stats.net.toFixed(2);
    }

    const typeNames = { recharge: '充值', bet: '投注', win: '中奖', adjust: '调整', draw: '退款' };
    const tbody = document.querySelector('#adminTxnTable tbody');
    tbody.innerHTML = list.map(t => `<tr>
      <td>${t.id}</td>
      <td>${t.username || '-'}</td>
      <td>${typeNames[t.type] || t.type}</td>
      <td style="color:${(t.banker_net || 0) >= 0 ? 'var(--admin-success)' : 'var(--admin-primary-light)'};font-weight:600;">
        ${(t.banker_net || 0) >= 0 ? '+' : ''}${(t.banker_net || 0).toFixed(2)}
      </td>
      <td>${(t.balance_after || 0).toFixed(2)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${t.description || t.note || '-'}</td>
      <td>${t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-'}</td>
    </tr>`).join('');

    document.getElementById('filterTxnType').onchange = loadAdminFunds;
  } catch (err) {
    showAdminToast('加载流水失败');
  }
}

// ===== 投注监控 =====
async function loadAdminBets() {
  const status = document.getElementById('filterBetStatus')?.value || 'all';

  try {
    const params = new URLSearchParams();
    if (status !== 'all') params.append('status', status);

    const res = await fetch(`${ADMIN_API}/bets?${params}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const typeNames = { spf: '胜平负', rqspf: '让球胜平负', dxq: '大小球' };
    const optionNames = { win: '主胜', draw: '平局', lose: '主负', over: '大球', under: '小球' };

    const tbody = document.querySelector('#adminBetTable tbody');
    tbody.innerHTML = data.data.map(b => `<tr>
      <td>${b.id}</td>
      <td>${b.username || '-'}</td>
      <td style="font-size:12px;">${b.home_team || ''} vs ${b.away_team || ''}</td>
      <td>${typeNames[b.bet_type] || b.bet_type}</td>
      <td>${optionNames[b.bet_option] || b.bet_option}</td>
      <td style="font-weight:600;"><img src="../images/coin-reverse.png" class="coin-unit-icon">${b.bet_amount.toFixed(2)}</td>
      <td>${b.odds}</td>
      <td>${b.status === 'pending' ? '<span class="status-badge pending">待开奖</span>' : (b.result === 'win' ? '<span class="status-badge win">+<img src="../images/coin-reverse.png" class="coin-unit-icon">' + (b.win_amount || 0).toFixed(2) + '</span>' : '<span class="status-badge lose">未中</span>')}</td>
      <td style="font-size:11px;">${b.created_at ? new Date(b.created_at).toLocaleString('zh-CN') : '-'}</td>
    </tr>`).join('');

    document.getElementById('filterBetStatus').onchange = loadAdminBets;
  } catch (err) {
    showAdminToast('加载投注失败');
  }
}

// ===== 比赛结算 =====
async function loadAdminSettle() {
  try {
    const res = await fetch(`${ADMIN_API}/matches?status=live,upcoming`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const tbody = document.querySelector('#adminSettleTable tbody');
    const pendingRes = await fetch(`${ADMIN_API}/pending-bets-count`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const pendingData = await pendingRes.json();
    const pendingCounts = {};
    if (pendingData.code === 200) {
      pendingData.data.forEach(p => { pendingCounts[p.match_id] = p.cnt; });
    }

    tbody.innerHTML = data.data.map(m => `<tr>
      <td>${m.id}</td>
      <td>${getFlagImg(m.home_team)} ${m.home_team}</td>
      <td>${m.away_team} ${getFlagImg(m.away_team)}</td>
      <td>${m.home_score != null ? m.home_score + ':' + m.away_score : '-'}</td>
      <td><span class="status-badge ${m.status}">${m.status === 'live' ? '进行中' : '即将开始'}</span></td>
      <td>${pendingCounts[m.id] || 0} 笔</td>
      <td><button class="btn-admin-xs" onclick="settleMatch(${m.id})">手动结算</button></td>
    </tr>`).join('');

    document.getElementById('btnSettleAll').onclick = settleBatch;
  } catch (err) {
    showAdminToast('加载失败');
  }
}

// ===== 操作函数 =====
async function settleMatch(matchId) {
  if (!confirm('确认结算该场比赛？将随机生成最终比分并结算所有投注。')) return;

  try {
    const res = await fetch(`${ADMIN_API}/settle/${matchId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      showAdminToast(`结算完成：${data.data.home_score}:${data.data.away_score}`);
      loadAdminSettle();
    } else {
      showAdminToast(data.msg);
    }
  } catch (err) {
    showAdminToast('结算失败');
  }
}

async function settleBatch() {
  if (!confirm('确认批量结算所有进行中的比赛？')) return;

  try {
    const res = await fetch(`${ADMIN_API}/settle-batch`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      showAdminToast(`批量结算完成，共结算 ${data.data.settled} 场比赛`);
      loadAdminSettle();
    } else {
      showAdminToast(data.msg);
    }
  } catch (err) {
    showAdminToast('批量结算失败');
  }
}

async function editOdds(matchId) {
  try {
    const res = await fetch(`${ADMIN_API}/matches`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const match = data.data.find(m => m.id === matchId);
    if (!match) return showAdminToast('比赛不存在');

    openAdminModal(`调整赔率 - ${match.home_team} vs ${match.away_team}`, `
      <div class="admin-form-row"><label>胜</label><input id="odds_spf_win" value="${match.spf_win}"></div>
      <div class="admin-form-row"><label>平</label><input id="odds_spf_draw" value="${match.spf_draw}"></div>
      <div class="admin-form-row"><label>负</label><input id="odds_spf_lose" value="${match.spf_lose}"></div>
      <div class="admin-form-row"><label>让球</label><input id="odds_handicap" value="${match.handicap}"></div>
      <div class="admin-form-row"><label>让胜</label><input id="odds_rqspf_win" value="${match.rqspf_win}"></div>
      <div class="admin-form-row"><label>让平</label><input id="odds_rqspf_draw" value="${match.rqspf_draw}"></div>
      <div class="admin-form-row"><label>让负</label><input id="odds_rqspf_lose" value="${match.rqspf_lose}"></div>
      <div class="admin-form-row"><label>大小球盘口</label><input id="odds_ou_line" value="${match.over_under_line}"></div>
      <div class="admin-form-row"><label>大球</label><input id="odds_dxq_over" value="${match.dxq_over}"></div>
      <div class="admin-form-row"><label>小球</label><input id="odds_dxq_under" value="${match.dxq_under}"></div>
    `, async () => {
      const body = {
        spf_win: parseFloat(document.getElementById('odds_spf_win').value),
        spf_draw: parseFloat(document.getElementById('odds_spf_draw').value),
        spf_lose: parseFloat(document.getElementById('odds_spf_lose').value),
        handicap: parseFloat(document.getElementById('odds_handicap').value),
        rqspf_win: parseFloat(document.getElementById('odds_rqspf_win').value),
        rqspf_draw: parseFloat(document.getElementById('odds_rqspf_draw').value),
        rqspf_lose: parseFloat(document.getElementById('odds_rqspf_lose').value),
        over_under_line: parseFloat(document.getElementById('odds_ou_line').value),
        dxq_over: parseFloat(document.getElementById('odds_dxq_over').value),
        dxq_under: parseFloat(document.getElementById('odds_dxq_under').value),
      };

      const r = await fetch(`${ADMIN_API}/odds/${matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (d.code === 200) { showAdminToast('赔率已更新'); closeAdminModal(); loadAdminOdds(); }
      else showAdminToast(d.msg || '更新失败');
    });
  } catch (err) {
    showAdminToast('操作失败');
  }
}

async function adjustBalance(userId, username, currentBalance) {
  openAdminModal(`调整余额 - ${username}`, `
    <p style="color:var(--admin-text-muted);margin-bottom:12px;">当前余额：<strong style="color:var(--admin-white);"><img src="../images/coin-reverse.png" class="coin-unit-icon">${currentBalance.toFixed(2)}</strong></p>
    <div class="admin-form-row"><label>调整金额</label><input id="adjustAmount" type="number" step="1" placeholder="正数增加，负数扣减"></div>
    <div class="admin-form-row"><label>备注</label><input id="adjustNote" placeholder="调整原因"></div>
  `, async () => {
    const amount = parseFloat(document.getElementById('adjustAmount').value);
    const note = document.getElementById('adjustNote').value || '管理员调整';
    if (!amount || isNaN(amount)) return showAdminToast('请输入有效金额');

    const r = await fetch(`${ADMIN_API}/users/${userId}/balance`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ amount, note })
    });
    const d = await r.json();
    if (d.code === 200) { showAdminToast('余额已调整'); closeAdminModal(); loadAdminUsers(); }
    else showAdminToast(d.msg || '调整失败');
  });
}

// ===== 弹窗 =====
function openAdminModal(title, bodyHtml, onConfirm) {
  document.getElementById('adminModalTitle').textContent = title;
  document.getElementById('adminModalBody').innerHTML = bodyHtml;
  document.getElementById('adminModalFooter').innerHTML = `
    <button class="btn-admin-sm" onclick="closeAdminModal()">取消</button>
    <button class="btn-admin-sm" style="background:var(--admin-primary);color:white;border:none;" id="btnModalConfirm">确认</button>
  `;
  document.getElementById('adminModal').classList.add('active');
  document.getElementById('btnModalConfirm').onclick = onConfirm;
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('active');
}

// ===== 工具函数 =====
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ===== 赔率同步页 =====
async function loadSyncPage() {
  await refreshSyncStatus();

  // 立即同步按钮
  document.getElementById('btnSyncNow').onclick = async () => {
    showAdminToast('正在同步...');
    try {
      const r = await fetch(`${ADMIN_API}/sync/trigger`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const d = await r.json();
      if (d.code === 200) showAdminToast(d.msg || '同步完成');
      else showAdminToast(d.msg);
      await refreshSyncStatus();
    } catch (e) { showAdminToast('同步失败'); }
  };

  // 切换模式按钮
  document.getElementById('btnToggleMode').onclick = async () => {
    const currentMode = document.getElementById('syncModeDisplay').textContent;
    const newMode = currentMode.includes('自动') ? 'manual' : 'auto';
    try {
      const r = await fetch(`${ADMIN_API}/sync/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ mode: newMode })
      });
      const d = await r.json();
      if (d.code === 200) showAdminToast(d.msg || '模式已切换');
      else showAdminToast(d.msg);
      await refreshSyncStatus();
    } catch (e) { showAdminToast('切换失败'); }
  };
}

async function refreshSyncStatus() {
  try {
    const r = await fetch(`${ADMIN_API}/sync/status`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const d = await r.json();
    if (d.code !== 200) return;

    const s = d.data;
    const isAuto = s.mode === 'auto';

    document.getElementById('syncModeDisplay').textContent = isAuto ? '🔄 自动同步（体彩平台）' : '✋ 手动固定';
    document.getElementById('syncLastTime').textContent = s.lastSyncFormatted || '未同步';
    document.getElementById('syncNextTime').textContent = s.nextSyncFormatted || '计算中';
    document.getElementById('syncCount').textContent = s.syncCount;
    document.getElementById('syncCache').textContent = s.cacheAge || '无';

    // 模式切换按钮
    const toggleBtn = document.getElementById('btnToggleMode');
    toggleBtn.textContent = isAuto ? '切换为手动模式' : '切换为自动同步';
    toggleBtn.className = isAuto ? 'btn-admin-sm' : 'btn-admin-sm manual';

    // 模式标签
    const badge = document.getElementById('syncModeBadge');
    badge.textContent = isAuto ? '🔄 自动同步' : '✋ 手动固定';
    badge.className = 'sync-mode-badge ' + (isAuto ? 'auto' : 'manual');

    // 错误提示
    if (s.lastError) {
      document.getElementById('syncError').style.display = 'block';
      document.getElementById('syncError').textContent = '⚠️ 上次错误: ' + s.lastError;
    } else {
      document.getElementById('syncError').style.display = 'none';
    }

    // 手动模式面板
    const manualPanel = document.getElementById('manualOddsPanel');
    manualPanel.style.display = isAuto ? 'none' : 'block';
    if (!isAuto) {
      loadManualOddsTable();
    }
  } catch (e) { /* ignore */ }
}

async function loadManualOddsTable() {
  try {
    const r = await fetch(`${ADMIN_API}/matches?status=upcoming&status=live`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const d = await r.json();
    if (d.code !== 200) return;

    const tbody = document.querySelector('#adminManualOddsTable tbody');
    tbody.innerHTML = d.data.map(m => {
      const hText = m.handicap > 0 ? `+${m.handicap}` : m.handicap;
      return `<tr>
        <td>${m.home_team} vs ${m.away_team}</td>
        <td>${m.spf_win}/${m.spf_draw}/${m.spf_lose}</td>
        <td>${hText}</td>
        <td>${m.rqspf_win}/${m.rqspf_draw}/${m.rqspf_lose}</td>
        <td>${m.over_under_line}</td>
        <td>${m.dxq_over}/${m.dxq_under}</td>
        <td><button class="btn-admin-xs" onclick="manualEditOdds(${m.id})">手动修订</button></td>
      </tr>`;
    }).join('');
  } catch (e) { /* ignore */ }
}

async function manualEditOdds(matchId) {
  try {
    const r = await fetch(`${ADMIN_API}/matches`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const d = await r.json();
    const match = d.data.find(m => m.id === matchId);
    if (!match) return showAdminToast('比赛不存在');

    openAdminModal(`手动设定赔率 - ${match.home_team} vs ${match.away_team}`, `
      <p style="color:var(--admin-warning);font-size:12px;margin-bottom:12px;">⚠️ 手动模式下，输入框中的数值将被直接锁定，不再自动更新</p>
      <div class="admin-form-row"><label>胜</label><input id="m_spf_win" value="${match.spf_win}"></div>
      <div class="admin-form-row"><label>平</label><input id="m_spf_draw" value="${match.spf_draw}"></div>
      <div class="admin-form-row"><label>负</label><input id="m_spf_lose" value="${match.spf_lose}"></div>
      <div class="admin-form-row"><label>让球</label><input id="m_handicap" value="${match.handicap}"></div>
      <div class="admin-form-row"><label>让胜</label><input id="m_rqspf_win" value="${match.rqspf_win}"></div>
      <div class="admin-form-row"><label>让平</label><input id="m_rqspf_draw" value="${match.rqspf_draw}"></div>
      <div class="admin-form-row"><label>让负</label><input id="m_rqspf_lose" value="${match.rqspf_lose}"></div>
      <div class="admin-form-row"><label>大小球盘口</label><input id="m_ou_line" value="${match.over_under_line}"></div>
      <div class="admin-form-row"><label>大球</label><input id="m_dxq_over" value="${match.dxq_over}"></div>
      <div class="admin-form-row"><label>小球</label><input id="m_dxq_under" value="${match.dxq_under}"></div>
    `, async () => {
      const body = {
        spf_win: parseFloat(document.getElementById('m_spf_win').value),
        spf_draw: parseFloat(document.getElementById('m_spf_draw').value),
        spf_lose: parseFloat(document.getElementById('m_spf_lose').value),
        handicap: parseFloat(document.getElementById('m_handicap').value),
        rqspf_win: parseFloat(document.getElementById('m_rqspf_win').value),
        rqspf_draw: parseFloat(document.getElementById('m_rqspf_draw').value),
        rqspf_lose: parseFloat(document.getElementById('m_rqspf_lose').value),
        over_under_line: parseFloat(document.getElementById('m_ou_line').value),
        dxq_over: parseFloat(document.getElementById('m_dxq_over').value),
        dxq_under: parseFloat(document.getElementById('m_dxq_under').value),
      };

      const res = await fetch(`${ADMIN_API}/sync/odds/${matchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify(body)
      });
      const rd = await res.json();
      if (rd.code === 200) { showAdminToast('赔率已锁定'); closeAdminModal(); loadManualOddsTable(); }
      else showAdminToast(rd.msg || '设置失败');
    });
  } catch (e) { showAdminToast('操作失败'); }
}

// ===== 开奖结果页 =====
async function loadResultsPage() {
  try {
    const r = await fetch(`${ADMIN_API}/results`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const d = await r.json();
    if (d.code !== 200) return;

    // 已结束比赛结果
    const finished = d.data.finished || [];
    document.getElementById('finishedResults').innerHTML = finished.length === 0
      ? '<div style="color:var(--admin-text-muted);text-align:center;padding:20px;">暂无结果</div>'
      : finished.map(m => `
        <div class="result-card ${m.id > finished[0].id - 3 ? 'new' : ''}">
          <div class="result-card-header">
            <span class="result-stage">${m.group_name ? m.group_name + '组' : m.stage}</span>
            <span class="result-time">${new Date(m.match_time).toLocaleDateString('zh-CN')}</span>
          </div>
          <div class="result-teams">
            <span>${getFlagImg(m.home_team)} ${m.home_team}</span>
            <span class="result-score">${m.home_score} : ${m.away_score}</span>
            <span>${m.away_team} ${getFlagImg(m.away_team)}</span>
          </div>
        </div>
      `).join('');

    // 进行中
    const live = d.data.live || [];
    document.getElementById('liveResults').innerHTML = live.length === 0
      ? '<div style="color:var(--admin-text-muted);text-align:center;padding:20px;">暂无进行中比赛</div>'
      : live.map(m => `
        <div class="result-card">
          <div class="result-card-header">
            <span class="result-stage" style="background:rgba(231,76,60,0.15);color:var(--admin-primary-light);">${m.stage}</span>
            <span class="status-badge ${m.status}">${m.status === 'live' ? '进行中' : '即将开始'}</span>
          </div>
          <div class="result-teams">
            <span>${getFlagImg(m.home_team)} ${m.home_team}</span>
            <span class="result-score" style="font-size:18px;">${m.home_score != null ? m.home_score + ' : ' + m.away_score : 'VS'}</span>
            <span>${m.away_team} ${getFlagImg(m.away_team)}</span>
          </div>
        </div>
      `).join('');

    // 比分校正表格
    loadScoreEditTable(d.data.live);
  } catch (e) { showAdminToast('加载结果失败'); }
}

async function loadScoreEditTable(liveData) {
  try {
    const status = document.getElementById('filterResultStatus')?.value || 'live';
    const r = await fetch(`${ADMIN_API}/matches?status=${status}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const d = await r.json();
    if (d.code !== 200) return;

    const tbody = document.querySelector('#adminScoreTable tbody');
    tbody.innerHTML = d.data.map(m => `<tr>
      <td>${m.id}</td>
      <td>${getFlagImg(m.home_team)} ${m.home_team}</td>
      <td>${m.away_team} ${getFlagImg(m.away_team)}</td>
      <td><span class="score-edit-row">
        <input id="score_h_${m.id}" value="${m.home_score != null ? m.home_score : 0}" style="width:45px;">
        <span>:</span>
        <input id="score_a_${m.id}" value="${m.away_score != null ? m.away_score : 0}" style="width:45px;">
      </span></td>
      <td><span class="status-badge ${m.status}">${m.status === 'live' ? '进行中' : '即将开始'}</span></td>
      <td><button class="btn-admin-xs" onclick="updateMatchScore(${m.id})">更新比分</button></td>
    </tr>`).join('');

    document.getElementById('filterResultStatus').onchange = () => loadScoreEditTable();
  } catch (e) { /* ignore */ }
}

async function updateMatchScore(matchId) {
  const homeScore = parseInt(document.getElementById(`score_h_${matchId}`).value);
  const awayScore = parseInt(document.getElementById(`score_a_${matchId}`).value);

  if (isNaN(homeScore) || isNaN(awayScore)) return showAdminToast('请输入有效比分');

  try {
    const r = await fetch(`${ADMIN_API}/results/update-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ match_id: matchId, home_score: homeScore, away_score: awayScore })
    });
    const d = await r.json();
    if (d.code === 200) showAdminToast('比分已更新');
    else showAdminToast(d.msg);
    loadResultsPage();
  } catch (e) { showAdminToast('更新失败'); }
}

// ===== 充值管理 =====
function setRechargeAmount(amount) {
  document.getElementById('inputRechargeAmount').value = amount;
}

async function submitRecharge() {
  const account = document.getElementById('inputRechargeAccount').value.trim();
  const amount = parseInt(document.getElementById('inputRechargeAmount').value);
  const note = document.getElementById('inputRechargeNote').value.trim() || '线下充值';

  if (!account) return showAdminToast('请输入用户账号或邮箱');
  if (!amount || amount <= 0) return showAdminToast('请输入有效充值金额');
  if (amount > 100000) return showAdminToast('单次最高充值100000元');

  const btn = document.getElementById('btnRechargeSubmit');
  btn.disabled = true;
  btn.textContent = '充值中...';

  try {
    const res = await fetch(`${ADMIN_API}/recharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ account, amount, note })
    });
    const data = await res.json();

    const resultDiv = document.getElementById('rechargeResult');
    resultDiv.style.display = 'block';

    if (data.code === 200) {
      resultDiv.className = 'recharge-result success';
      resultDiv.innerHTML = `
        <strong>✅ ${data.msg}</strong><br>
        账号: ${data.data.account} | 昵称: ${data.data.nickname}<br>
        充值前余额: <img src="../images/coin-reverse.png" class="coin-unit-icon">${data.data.balance_before.toFixed(2)}<br>
        充值后余额: <img src="../images/coin-reverse.png" class="coin-unit-icon">${data.data.balance_after.toFixed(2)}<br>
        充值金额: <img src="../images/coin-reverse.png" class="coin-unit-icon">${amount.toFixed(2)}
      `;
      // 清空输入
      document.getElementById('inputRechargeAccount').value = '';
      document.getElementById('inputRechargeAmount').value = '';
    } else {
      resultDiv.className = 'recharge-result error';
      resultDiv.innerHTML = `<strong>❌ ${data.msg}</strong>`;
    }
  } catch (e) {
    showAdminToast('充值失败');
  }

  btn.disabled = false;
  btn.textContent = '✅ 确认充值';
}

// ===== 玩法开关 =====
async function loadPlayTypes() {
  try {
    const res = await fetch(`${ADMIN_API}/play-types`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      const pt = data.data;
      document.querySelector('#toggleSPF input').checked = pt.spf;
      document.querySelector('#toggleRQSPF input').checked = pt.rqspf;
      document.querySelector('#toggleDXQ input').checked = pt.dxq;
    }
  } catch(e) {}
}

async function togglePlayType(key, enabled) {
  try {
    const res = await fetch(`${ADMIN_API}/play-types`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ key, enabled })
    });
    const data = await res.json();
    if (data.code === 200) {
      showAdminToast(`${key} → ${enabled ? '已开启' : '已关闭'}`);
    }
  } catch(e) { showAdminToast('操作失败'); }
}

// ===== 数据清零 =====
async function resetAllStats() {
  if (!confirm('⚠️ 确认清零所有投注记录和交易流水？\n此操作不可撤销！')) return;
  if (!confirm('再次确认：将删除所有投注和流水数据！')) return;
  try {
    const res = await fetch(`${ADMIN_API}/reset-stats`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    showAdminToast(data.code === 200 ? '数据已清零' : ('失败: ' + data.msg));
    if (data.code === 200) loadDashboard();
  } catch(e) { showAdminToast('操作失败'); }
}

// ===== 资金明细弹窗 =====
let ledgerDebounceTimer = null;
function debounceLedger() { clearTimeout(ledgerDebounceTimer); ledgerDebounceTimer = setTimeout(() => loadLedger(1), 400); }

function openLedger() {
  document.getElementById('ledgerOverlay').style.display = 'flex';
  document.getElementById('ledgerStartDate').value = '';
  document.getElementById('ledgerEndDate').value = '';
  document.getElementById('ledgerType').value = 'all';
  document.getElementById('ledgerUsername').value = '';
  loadLedger(1);
}

function closeLedger() {
  document.getElementById('ledgerOverlay').style.display = 'none';
}

async function loadLedger(page) {
  const startDate = document.getElementById('ledgerStartDate').value;
  const endDate = document.getElementById('ledgerEndDate').value;
  const type = document.getElementById('ledgerType').value;
  const username = document.getElementById('ledgerUsername').value;

  const params = new URLSearchParams({ page, pageSize: 20 });
  if (type && type !== 'all') params.set('type', type);
  if (username) params.set('username', username);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  try {
    const res = await fetch(`${ADMIN_API}/transactions?${params}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (data.code !== 200) return;

    const { list, total, page: pg, totalPages, stats } = data.data;

    // 统计摘要
    if (stats) {
      document.getElementById('lsIncome').textContent = stats.income.toFixed(2);
      document.getElementById('lsExpense').textContent = stats.expense.toFixed(2);
      document.getElementById('lsNet').textContent = stats.net.toFixed(2);
    }
    const typeLabel = { recharge: '充值', bet: '投注', win: '中奖', draw: '退款', adjust: '调整', settle: '结算' };

    document.getElementById('ledgerBody').innerHTML = list.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--admin-text-muted);">暂无数据</td></tr>'
      : list.map(t => {
          const time = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-';
          const net = t.banker_net || 0;
          const isIncome = net >= 0;
          const amtColor = isIncome ? 'var(--admin-success)' : 'var(--admin-primary-light)';
          const amtPrefix = isIncome ? '+' : '';
          return `<tr>
            <td style="font-size:12px;">${time}</td>
            <td style="color:${amtColor};font-weight:600;">${amtPrefix}${net.toFixed(2)}</td>
            <td style="font-family:Consolas,monospace;">${(t.balance_after || 0).toFixed(2)}</td>
            <td><span class="status-badge ${t.type}">${typeLabel[t.type] || t.type}</span></td>
            <td>${t.username}</td>
            <td style="font-size:12px;color:var(--admin-text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.note || t.desc || '-'}</td>
          </tr>`;
        }).join('');

    // 分页
    let pagHTML = `<span style="color:var(--admin-text-muted);font-size:12px;">共 ${total} 条 · ${totalPages} 页</span>`;
    if (totalPages > 1) {
      pagHTML += '<div style="display:flex;gap:4px;">';
      for (let i = 1; i <= totalPages; i++) {
        pagHTML += `<button class="btn-admin-xs${i === pg ? ' active' : ''}" onclick="loadLedger(${i})">${i}</button>`;
      }
      pagHTML += '</div>';
    }
    document.getElementById('ledgerPagination').innerHTML = pagHTML;
  } catch(e) {}
}

function exportLedgerCSV() {
  const startDate = document.getElementById('ledgerStartDate').value;
  const endDate = document.getElementById('ledgerEndDate').value;
  const type = document.getElementById('ledgerType').value;
  const username = document.getElementById('ledgerUsername').value;
  const params = new URLSearchParams();
  if (type && type !== 'all') params.set('type', type);
  if (username) params.set('username', username);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  window.open(`${ADMIN_API}/transactions/export?${params}&token=${encodeURIComponent(adminToken)}`, '_blank');
}
