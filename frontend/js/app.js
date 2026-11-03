// ===== 体彩世界杯 - 前端应用 =====
const API = '/api';
let token = localStorage.getItem('wcb_token');
let currentUser = null;
let appInitialized = false;
let currentBetStatus = 'all';
let currentTxnType = 'all';
let betState = { match: null, type: 'spf', option: null, amount: 0 };
let sortOrder = 'asc';
let playTypes = { spf: true, rqspf: true, dxq: true };

// 加载玩法开关
fetch('/api/admin/play-types/public').then(r => r.json()).then(d => {
  if (d.code === 200) playTypes = d.data;
});

// ===== 国旗映射（解决Windows端emoji不显示问题） =====
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
  // 使用 cdnjs 国旗 SVG
  return `<img src="https://cdnjs.cloudflare.com/ajax/libs/flag-icon-css/4.1.4/flags/4x3/${code === 'gb-eng' ? 'gb-eng' : code === 'gb-sct' ? 'gb-sct' : code}.svg" class="team-flag-img" alt="" onerror="this.parentElement.insertAdjacentHTML('beforeend','<span class=\\'flag-text\\'>${code.toUpperCase()}</span>');this.remove();">`;
}

// 网络时间同步
let serverTimeOffset = 0; // 本地时间与服务器北京时间的偏差(ms)
let syncedBeijingTime = null;

// ===== 时间同步 =====
async function syncTime() {
  try {
    const t0 = Date.now();
    const res = await fetch(`${API}/matches/time`);
    const t1 = Date.now();
    const data = await res.json();
    if (data.code === 200) {
      const serverTs = data.data.timestamp;
      const rtt = t1 - t0;
      serverTimeOffset = serverTs - (t0 + rtt / 2);
      console.log('[时间同步] 偏移量:', serverTimeOffset, 'ms');
      startClock();
    }
  } catch (e) {
    // 降级使用本地时间
    serverTimeOffset = 0;
    startClock();
  }
}

function getBeijingTime() {
  return new Date(Date.now() + serverTimeOffset);
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = getBeijingTime();
  syncedBeijingTime = now;
  const el = document.getElementById('headerTime');
  if (!el) return;

  const y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');

  el.textContent = `🕐 ${y}-${M}-${d} ${h}:${m}:${s}`;
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  syncTime();
  initLoginPage();
  if (token) {
    checkAuth();
  }
});

// ===== 登录页逻辑 =====
let codeCooldown = 0;

function initLoginPage() {
  // Tab切换
  document.querySelectorAll('.login-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.login-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
      document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
    });
  });

  // 登录
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const account = document.getElementById('loginAccount').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!account || !password) return showToast('请输入账号和密码');

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password })
      });
      const data = await res.json();
      if (data.code === 200) {
        token = data.data.token;
        currentUser = data.data.user;
        localStorage.setItem('wcb_token', token);
        showApp();
        showToast('登录成功！');
      } else {
        showToast(data.msg);
      }
    } catch (err) {
      showToast('网络错误，请稍后重试');
    }
  });

  // 发送验证码
  document.getElementById('btnSendCode').addEventListener('click', async () => {
    if (codeCooldown > 0) return;

    const email = document.getElementById('regEmail').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showToast('请输入有效的邮箱地址');
    }

    const btn = document.getElementById('btnSendCode');
    btn.disabled = true;
    btn.textContent = '发送中...';

    try {
      const res = await fetch(`${API}/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.code === 200) {
        showToast(data.msg);
        // 开发模式下显示验证码
        if (data.devCode) {
          document.getElementById('codeHint').textContent = `验证码: ${data.devCode}`;
        }
        // 倒计时
        codeCooldown = 60;
        const cd = setInterval(() => {
          codeCooldown--;
          btn.textContent = `${codeCooldown}秒后重发`;
          if (codeCooldown <= 0) {
            clearInterval(cd);
            btn.textContent = '获取验证码';
            btn.disabled = false;
            document.getElementById('codeHint').textContent = '';
          }
        }, 1000);
      } else {
        showToast(data.msg);
        btn.disabled = false;
        btn.textContent = '获取验证码';
      }
    } catch (err) {
      showToast('网络错误');
      btn.disabled = false;
      btn.textContent = '获取验证码';
    }
  });

  // 注册
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('regEmail').value.trim();
    const code = document.getElementById('regCode').value.trim();
    const nickname = document.getElementById('regNickname').value.trim();
    const password = document.getElementById('regPassword').value;
    const password2 = document.getElementById('regPassword2').value;

    if (!email || !code || !password || !password2) return showToast('请填写所有必填项');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('邮箱格式不正确');
    if (password !== password2) return showToast('两次密码不一致');
    if (password.length < 6) return showToast('密码至少6个字符');
    if (code.length !== 6) return showToast('请输入6位验证码');

    try {
      const res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, nickname, password, password2 })
      });
      const data = await res.json();
      if (data.code === 200) {
        token = data.data.token;
        currentUser = data.data.user;
        localStorage.setItem('wcb_token', token);
        showApp();
        showToast(`注册成功！您的账号: ${data.data.user.account}`);
      } else {
        showToast(data.msg);
      }
    } catch (err) {
      showToast('网络错误，请稍后重试');
    }
  });
}

// ===== 认证检查 =====
async function checkAuth() {
  if (!token) return;
  try {
    const res = await fetch(`${API}/auth/userinfo`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      currentUser = data.data;
      showApp();
    } else {
      logout();
    }
  } catch (err) {
    // 后端未启动，保持登录页
  }
}

function showApp() {
  document.getElementById('loginPage').classList.remove('active');
  document.getElementById('appPage').classList.add('active');
  if (!appInitialized) {
    initAppPage();
    appInitialized = true;
  }
  updateBalanceDisplay();
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('wcb_token');
  document.getElementById('appPage').classList.remove('active');
  document.getElementById('loginPage').classList.add('active');
  document.getElementById('loginAccount').value = '';
  document.getElementById('loginPassword').value = '';
}

// ===== 主应用初始化 =====
function initAppPage() {
  if (!currentUser) return;

  try {
    document.getElementById('headerUsername').textContent = currentUser.nickname || currentUser.account;
  } catch(e) {}
  updateBalanceDisplay();

  // Tab导航
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      switchPage(page);
    });
  });

  // 退出
  document.getElementById('btnLogout').addEventListener('click', logout);

  // 启动弹幕
  loadDanmaku();

  // 投注记录状态筛选
  document.querySelectorAll('#pageBets .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pageBets .status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentBetStatus = btn.dataset.betStatus;
      loadBets();
    });
  });

  // 交易类型筛选
  document.querySelectorAll('#pageAccount .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pageAccount .status-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTxnType = btn.dataset.txnType;
      loadTransactions();
    });
  });

  // 确认投注
  document.getElementById('btnConfirmBet').addEventListener('click', placeBet);

  // 默认加载比赛
  loadMatches();
}

// ===== 余额更新 =====
async function updateBalanceDisplay() {
  try {
    const res = await fetch(`${API}/account/info`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.code === 200) {
      currentUser.balance = data.data.balance;
      document.getElementById('headerBalance').textContent = data.data.balance.toFixed(2);
    }
  } catch (err) {
    // ignore
  }
}

// ===== 页面切换 =====
function switchPage(page) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.getElementById(`page${page.charAt(0).toUpperCase() + page.slice(1)}`).classList.add('active');

  switch (page) {
    case 'matches': loadMatches(); break;
    case 'bets': loadBets(); break;
    case 'leaderboard': loadLeaderboard(); break;
    case 'account': loadAccount(); break;
    case 'profile': loadProfile(); break;
  }
}

// ===== 比赛列表 =====
async function loadMatches() {
  const container = document.getElementById('matchList');
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const res = await fetch(`${API}/matches/list`);
    const data = await res.json();

    if (data.code !== 200) {
      container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
      return;
    }

    let matches = data.data;
    // 统一按时间从早到晚排序
    matches.sort((a, b) => new Date(a.match_time) - new Date(b.match_time));

    if (matches.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">暂无比赛数据</div></div>';
      return;
    }

    container.innerHTML = '';
    matches.forEach(m => container.appendChild(createMatchCard(m)));

    // 自动定位到当前比赛
    setTimeout(() => autoScrollToCurrentMatch(matches), 200);
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><div class="empty-text">无法连接到服务器</div></div>';
  }
}

function createMatchCard(match) {
  const card = document.createElement('div');
  card.className = `match-card status-${match.status}`;
  card.setAttribute('data-match-id', match.id);

  const timeStr = new Date(match.match_time).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  const stageText = match.group_name ? `${match.group_name}组` : match.stage;
  const isFinished = match.status === 'finished';
  const isLive = match.status === 'live';

  // 状态标签
  let statusBadge = '';
  if (isLive) {
    statusBadge = '<span class="match-status-badge live">🔴 正在进行</span>';
  } else if (isFinished) {
    statusBadge = '<span class="match-status-badge finished">已结束</span>';
  } else {
    statusBadge = '<span class="match-status-badge upcoming">即将开始</span>';
  }

  // 比分显示
  let scoreDisplay = '';
  if (isFinished) {
    scoreDisplay = `<span class="match-score finished">${match.home_score} : ${match.away_score}</span>`;
  } else if (isLive) {
    scoreDisplay = `<span class="match-score live">${match.home_score != null ? match.home_score : 0} : ${match.away_score != null ? match.away_score : 0}</span>`;
  } else {
    scoreDisplay = '<span class="match-score upcoming">VS</span>';
  }

  // 底部操作区
  let bottomAction = '';
  if (isFinished) {
    // 已结束：仅展示结果
    bottomAction = '<div class="match-footer finished">比赛已结束</div>';
  } else if (isLive) {
    // 进行中：直播按钮 + 禁止投注
    bottomAction = `
      <div class="match-footer live">
        <span class="match-live-text">⚡ 比赛进行中，暂停投注</span>
        <a class="btn-live" href="https://tv.cctv.com/live/cctv5/?spm=C28340.PNR96hKp8fYJ.ExidtyEJcS5K.5" target="_blank" rel="noopener">
          📺 观看直播
        </a>
      </div>`;
  } else {
    // 未开始：竞猜投注
    bottomAction = `<button class="btn-bet" onclick='openBetModal(${JSON.stringify(match)})'>立即竞猜</button>`;
  }

  card.innerHTML = `
    <div class="match-header">
      <span class="match-stage">${stageText}</span>
      ${statusBadge}
    </div>
    <div class="match-teams">
      <div class="team">
        <span class="team-flag">${getFlagImg(match.home_team)}</span>
        <span class="team-name">${match.home_team}</span>
      </div>
      <div class="match-vs">
        ${scoreDisplay}
        <span class="match-time-info">${timeStr}</span>
      </div>
      <div class="team">
        <span class="team-flag">${getFlagImg(match.away_team)}</span>
        <span class="team-name">${match.away_team}</span>
      </div>
    </div>
    ${!isFinished ? `
    <div class="match-odds">
      <div class="odds-row">
        <span class="odds-label-mini">胜平负</span>
        <span class="odds-nums">${match.spf_win} / ${match.spf_draw} / ${match.spf_lose}</span>
      </div>
    </div>` : ''}
    ${bottomAction}
  `;

  return card;
}

// ===== 投注弹窗 =====

async function openBetModal(match) {
  // 每次打开弹窗前重新拉取玩法开关
  try {
    const ptRes = await fetch('/api/admin/play-types/public');
    const ptData = await ptRes.json();
    if (ptData.code === 200) playTypes = ptData.data;
  } catch(e) {}

  betState = {
    match: match,
    type: 'spf',
    option: null,
    amount: 0
  };

  const body = document.getElementById('betModalBody');
  const timeStr = new Date(match.match_time).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  body.innerHTML = `
    <div class="bet-match-header">
      <div class="match-teams-small">${getFlagImg(match.home_team)} ${match.home_team} VS ${match.away_team} ${getFlagImg(match.away_team)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${timeStr} | ${match.group_name ? match.group_name + '组' : match.stage}</div>
    </div>
    <div class="bet-play-types" id="betPlayTypes">
      ${playTypes.spf ? `<button class="play-type-btn active" data-type="spf">
        <span class="pt-name">胜平负</span>
        <span class="pt-desc">竞猜赛果</span>
      </button>` : ''}
      ${playTypes.rqspf ? `<button class="play-type-btn" data-type="rqspf">
        <span class="pt-name">让球胜平负</span>
        <span class="pt-desc">让${match.handicap > 0 ? '+' + match.handicap : match.handicap}球</span>
      </button>` : ''}
      ${playTypes.dxq ? `<button class="play-type-btn" data-type="dxq">
        <span class="pt-name">大小球</span>
        <span class="pt-desc">${match.over_under_line}球盘口</span>
      </button>` : ''}
    </div>
    <div class="bet-options" id="betOptions"></div>
    <div class="quick-amounts" id="betQuickAmounts">
      <button class="quick-amount-btn" data-amount="10">10<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
      <button class="quick-amount-btn" data-amount="20">20<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
      <button class="quick-amount-btn active" data-amount="50">50<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
      <button class="quick-amount-btn" data-amount="100">100<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
      <button class="quick-amount-btn" data-amount="200">200<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
      <button class="quick-amount-btn" data-amount="500">500<img src="images/coin-reverse.png" class="coin-unit-icon"></button>
    </div>
    <div class="form-group">
      <label>投注金额（<img src="images/coin-reverse.png" class="coin-unit-icon">）</label>
      <input type="number" class="amount-input" id="betAmount" value="50" min="2" max="50000" placeholder="最低2<img src="images/coin-reverse.png" class="coin-unit-icon">">
    </div>
    <div class="bet-summary" id="betSummary" style="display:none;">
      <div class="bet-summary-row">
        <span>玩法</span>
        <span id="summaryType">-</span>
      </div>
      <div class="bet-summary-row">
        <span>选项</span>
        <span id="summaryOption">-</span>
      </div>
      <div class="bet-summary-row">
        <span>赔率</span>
        <span id="summaryOdds" style="color:var(--primary);font-weight:700;">-</span>
      </div>
      <div class="bet-summary-row total">
        <span>预计锦鲤币</span>
        <span id="summaryWin">-</span>
      </div>
    </div>
  `;

  // 玩法切换
  body.querySelectorAll('.play-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.play-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      betState.type = btn.dataset.type;
      betState.option = null;
      renderBetOptions(body);
    });
  });

  // 快捷金额
  body.querySelectorAll('.quick-amount-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('betAmount').value = btn.dataset.amount;
      updateBetSummary();
    });
  });

  // 金额输入
  document.getElementById('betAmount').addEventListener('input', updateBetSummary);

  renderBetOptions(body);
  updateBetSummary();

  document.getElementById('betModal').classList.add('active');
}

function renderBetOptions(body) {
  const container = body.querySelector('#betOptions');
  const match = betState.match;

  let options = [];
  switch (betState.type) {
    case 'spf':
      options = [
        { key: 'win', name: '主胜', odds: match.spf_win },
        { key: 'draw', name: '平局', odds: match.spf_draw },
        { key: 'lose', name: '主负', odds: match.spf_lose }
      ];
      break;
    case 'rqspf':
      const hText = match.handicap > 0 ? `让+${match.handicap}` : `让${match.handicap}`;
      options = [
        { key: 'win', name: `让胜(${hText})`, odds: match.rqspf_win },
        { key: 'draw', name: `让平(${hText})`, odds: match.rqspf_draw },
        { key: 'lose', name: `让负(${hText})`, odds: match.rqspf_lose }
      ];
      break;
    case 'dxq':
      options = [
        { key: 'over', name: `大球(>${match.over_under_line})`, odds: match.dxq_over },
        { key: 'under', name: `小球(<${match.over_under_line})`, odds: match.dxq_under }
      ];
      break;
  }

  container.innerHTML = options.map(opt => `
    <button class="bet-option-btn" data-option="${opt.key}">
      <span class="opt-name">${opt.name}</span>
      <span class="opt-odds">${opt.odds}</span>
    </button>
  `).join('');

  container.querySelectorAll('.bet-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.bet-option-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      betState.option = btn.dataset.option;
      updateBetSummary();
    });
  });
}

function updateBetSummary() {
  const summary = document.getElementById('betSummary');
  const amount = parseFloat(document.getElementById('betAmount')?.value) || 0;
  betState.amount = amount;

  if (!betState.option || amount <= 0) {
    summary.style.display = 'none';
    return;
  }

  const match = betState.match;
  let odds = 0;
  let typeName = '';
  let optionName = '';

  switch (betState.type) {
    case 'spf':
      typeName = '胜平负';
      if (betState.option === 'win') { odds = match.spf_win; optionName = '主胜'; }
      else if (betState.option === 'draw') { odds = match.spf_draw; optionName = '平局'; }
      else { odds = match.spf_lose; optionName = '主负'; }
      break;
    case 'rqspf':
      typeName = '让球胜平负';
      if (betState.option === 'win') { odds = match.rqspf_win; optionName = '让胜'; }
      else if (betState.option === 'draw') { odds = match.rqspf_draw; optionName = '让平'; }
      else { odds = match.rqspf_lose; optionName = '让负'; }
      break;
    case 'dxq':
      typeName = '大小球';
      if (betState.option === 'over') { odds = match.dxq_over; optionName = '大球'; }
      else { odds = match.dxq_under; optionName = '小球'; }
      break;
  }

  summary.style.display = 'block';
  document.getElementById('summaryType').textContent = typeName;
  document.getElementById('summaryOption').textContent = optionName;
  document.getElementById('summaryOdds').textContent = odds;
  document.getElementById('summaryWin').innerHTML = (amount * odds).toFixed(2) + ' <img src="images/coin-reverse.png" class="coin-unit-icon">';
}

function closeBetModal() {
  document.getElementById('betModal').classList.remove('active');
  betState = { match: null, type: 'spf', option: null, amount: 0 };
}

// ===== 提交投注 =====
async function placeBet() {
  if (!betState.match || !betState.option || betState.amount < 2) {
    showToast('请完善投注信息');
    return;
  }

  if (betState.amount > (currentUser.balance || 0)) {
    showToast('余额不足');
    return;
  }

  const btn = document.getElementById('btnConfirmBet');
  btn.disabled = true;
  btn.textContent = '提交中...';

  try {
    const res = await fetch(`${API}/betting/place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        match_id: betState.match.id,
        bet_type: betState.type,
        bet_option: betState.option,
        bet_amount: betState.amount
      })
    });
    const data = await res.json();

    if (data.code === 200) {
      closeBetModal();
      updateBalanceDisplay();
      showToast('投注成功！');
    } else {
      showToast(data.msg);
    }
  } catch (err) {
    showToast('投注失败，请稍后重试');
  }

  btn.disabled = false;
  btn.textContent = '确认投注';
}

// ===== 投注记录 =====
async function loadBets() {
  const container = document.getElementById('betList');
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const params = new URLSearchParams();
    if (currentBetStatus !== 'all') params.append('status', currentBetStatus);

    const res = await fetch(`${API}/betting/history?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.code !== 200 || !data.data.list.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">暂无投注记录</div></div>';
      return;
    }

    container.innerHTML = data.data.list.map(bet => {
      let resultBadge = '';
      if (bet.status === 'settled') {
        resultBadge = bet.result === 'win'
          ? '<span class="bet-result-badge win">✓ 中奖</span>'
          : '<span class="bet-result-badge lose">✗ 未中奖</span>';
      } else {
        resultBadge = '<span class="bet-result-badge pending">⏳ 待开奖</span>';
      }

      const typeNames = { spf: '胜平负', rqspf: '让球胜平负', dxq: '大小球' };
      const optionNames = {
        win: '主胜', draw: '平局', lose: '主负',
        over: '大球', under: '小球'
      };

      const timeStr = new Date(bet.created_at).toLocaleString('zh-CN');

      return `
        <div class="bet-record">
          <div class="bet-record-header">
            <span class="bet-record-teams">${bet.home_flag || ''} ${bet.home_team} VS ${bet.away_team} ${bet.away_flag || ''}</span>
            ${resultBadge}
          </div>
          <div class="bet-record-detail">
            <span>${typeNames[bet.bet_type] || bet.bet_type} · ${optionNames[bet.bet_option] || bet.bet_option}</span>
            <span>@${bet.odds}</span>
          </div>
          <div class="bet-record-detail">
            <span>投注</span>
            <span class="bet-record-amount">${bet.bet_amount.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
          </div>
          ${bet.status === 'settled' ? `
          <div class="bet-record-detail">
            <span>结果</span>
            <span style="color:${bet.result === 'win' ? 'var(--success)' : 'var(--text-muted)'};font-weight:600;">
              ${bet.result === 'win' ? `+${bet.win_amount.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon">` : '0 <img src="images/coin-reverse.png" class="coin-unit-icon">'}
            </span>
          </div>
          ` : ''}
          <div class="bet-record-detail" style="color:var(--text-muted);">
            <span>${timeStr}</span>
            <span>${bet.stage || ''}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔌</div><div class="empty-text">加载失败</div></div>';
  }
}

// ===== 统计分析 =====
async function loadStats() {
  const container = document.getElementById('statsOverview');
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const res = await fetch(`${API}/betting/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.code !== 200) {
      container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
      return;
    }

    const stats = data.data.overview;
    const profit = (stats.total_win || 0) - (stats.total_amount || 0);

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total_bets || 0}</div>
        <div class="stat-label">总投注次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${(stats.total_amount || 0).toFixed(2)}</div>
        <div class="stat-label">总投注金额</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-value">${(stats.total_win || 0).toFixed(2)}</div>
        <div class="stat-label">总中锦鲤币额</div>
      </div>
      <div class="stat-card" style="background:${profit >= 0 ? '#E8F5E9' : '#FFEBEE'}">
        <div class="stat-value" style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)}</div>
        <div class="stat-label">总盈亏</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.win_count || 0}</div>
        <div class="stat-label">中奖次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.win_rate || 0}%</div>
        <div class="stat-label">胜率</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.max_win ? stats.max_win.toFixed(2) : '0.00'}</div>
        <div class="stat-label">最高单注锦鲤币</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.pending_count || 0}</div>
        <div class="stat-label">待开奖</div>
      </div>
    `;

    // 按玩法统计
    const byTypeContainer = document.getElementById('statsByType');
    const typeNames = { spf: '胜平负', rqspf: '让球胜平负', dxq: '大小球' };
    const maxCount = Math.max(...data.data.byType.map(t => t.count), 1);

    byTypeContainer.innerHTML = data.data.byType.map(t => `
      <div class="chart-row">
        <span style="width:80px;font-weight:500;">${typeNames[t.bet_type] || t.bet_type}</span>
        <div class="chart-bar-wrap">
          <div class="chart-bar" style="width:${(t.count / maxCount * 100).toFixed(0)}%"></div>
        </div>
        <span style="width:80px;text-align:right;">${t.count}注 / 赢${t.wins || 0}次</span>
      </div>
    `).join('');

    // 趋势
    const trendContainer = document.getElementById('statsTrend');
    if (data.data.trend.length === 0) {
      trendContainer.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无数据</div>';
    } else {
      trendContainer.innerHTML = data.data.trend.reverse().map(t => {
        const profit = (t.win_amount || 0) - (t.amount || 0);
        return `
          <div class="chart-row">
            <span style="font-size:11px;">${t.date}</span>
            <span style="font-size:12px;">${t.count}注 / ${t.amount.toFixed(0)}<img src="images/coin-reverse.png" class="coin-unit-icon"></span>
            <span style="font-size:12px;color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600;">
              ${profit >= 0 ? '+' : ''}${profit.toFixed(0)}<img src="images/coin-reverse.png" class="coin-unit-icon">
            </span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
  }
}

// ===== 账户明细 =====
async function loadAccount() {
  const infoContainer = document.getElementById('accountInfo');
  const txnContainer = document.getElementById('txnList');

  infoContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const res = await fetch(`${API}/account/info`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.code === 200) {
      const info = data.data;
      infoContainer.innerHTML = `
        <div class="account-row">
          <span class="label">系统账号</span>
          <span class="value" style="font-family:Consolas,monospace;font-weight:700;">${info.account || '-'}</span>
        </div>
        <div class="account-row">
          <span class="label">邮箱</span>
          <span class="value">${info.email || '-'}</span>
        </div>
        <div class="account-row">
          <span class="label">昵称</span>
          <span class="value">${info.nickname || '-'}</span>
        </div>
        <div class="account-row">
          <span class="label">账户余额</span>
          <span class="value" style="font-size:24px;font-weight:800;">${info.balance.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
        </div>
        <div class="account-row">
          <span class="label">待开奖投注</span>
          <span class="value">${info.pending_bets_count} 笔 / ${info.pending_bets_amount.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
        </div>
        <div class="account-row">
          <span class="label">今日投注</span>
          <span class="value">${info.today_bet.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
        </div>
        <div class="account-row">
          <span class="label">今日中奖</span>
          <span class="value">${info.today_win.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
        </div>
        <div class="account-row">
          <span class="label">今日盈亏</span>
          <span class="value" style="color:${info.today_profit >= 0 ? '#A5D6A7' : '#FFCDD2'};">${info.today_profit >= 0 ? '+' : ''}${info.today_profit.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></span>
        </div>
        <div class="account-row">
          <span class="label">注册时间</span>
          <span class="value" style="font-size:12px;">${info.created_at ? new Date(info.created_at).toLocaleString('zh-CN') : '-'}</span>
        </div>
      `;
    }
  } catch (err) {
    infoContainer.innerHTML = '<div style="color:white;">加载失败</div>';
  }

  loadTransactions();
}

async function loadTransactions() {
  const container = document.getElementById('txnList');
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const params = new URLSearchParams();
    if (currentTxnType !== 'all') params.append('type', currentTxnType);

    const res = await fetch(`${API}/account/transactions?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.code !== 200 || !data.data.list.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">暂无交易记录</div></div>';
      return;
    }

    const typeNames = {
      recharge: '充值', withdraw: '提现', bet: '投注', win: '中奖', lose: '未中奖'
    };

    container.innerHTML = data.data.list.map(txn => {
      const isPositive = txn.type === 'recharge' || txn.type === 'win';
      const amountClass = isPositive ? 'positive' : (txn.type === 'lose' ? '' : 'negative');
      const prefix = isPositive ? '+' : (txn.type === 'lose' ? '' : '-');
      const timeStr = new Date(txn.created_at).toLocaleString('zh-CN');

      return `
        <div class="txn-item">
          <div class="txn-info">
            <div class="txn-desc">
              ${txn.description || typeNames[txn.type] || txn.type}
              <span class="txn-type-badge ${txn.type}">${typeNames[txn.type] || txn.type}</span>
            </div>
            <div class="txn-time">${timeStr}</div>
          </div>
          <div class="txn-amount ${amountClass}">${prefix}${Math.abs(txn.amount).toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
  }
}

// ===== 结果弹窗 =====
function showResultModal(win, amount) {
  const anim = document.getElementById('resultAnimation');
  if (win) {
    anim.innerHTML = `
      <div class="result-emoji">🎉</div>
      <div class="result-text" style="color:var(--success);">恭喜中奖！</div>
      <div class="result-amount">+${amount.toFixed(2)} <img src="images/coin-reverse.png" class="coin-unit-icon"></div>
      <div class="result-detail">锦鲤币已存入您的账户</div>
    `;
  } else {
    anim.innerHTML = `
      <div class="result-emoji">😞</div>
      <div class="result-text" style="color:var(--text-muted);">很遗憾，未中奖</div>
      <div class="result-detail">继续努力，下次好运！</div>
    `;
  }
  document.getElementById('resultModal').classList.add('active');
}

function closeResultModal() {
  document.getElementById('resultModal').classList.remove('active');
}

// ===== 工具函数 =====
function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || '其他';
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===== 自动定位到当前比赛 =====
function autoScrollToCurrentMatch(matches) {
  const container = document.getElementById('matchList');
  if (!container) return;

  // 找进行中的比赛
  let target = matches.find(m => m.status === 'live');
  // 没有进行中 → 找最近的即将开始
  if (!target) {
    const now = getBeijingTime();
    target = matches
      .filter(m => m.status === 'upcoming')
      .sort((a, b) => new Date(a.match_time) - new Date(b.match_time))[0];
  }
  // 还是没有 → 找最近的已结束
  if (!target) {
    target = matches
      .filter(m => m.status === 'finished')
      .sort((a, b) => new Date(b.match_time) - new Date(a.match_time))[0];
  }

  if (target) {
    const card = container.querySelector(`.match-card[data-match-id="${target.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('auto-scroll-highlight');
      setTimeout(() => card.classList.remove('auto-scroll-highlight'), 2000);
    }
  }
}

// ===== 弹幕恭喜系统 =====
let danmakuQueue = [];
let danmakuIndex = 0;
let danmakuTimer = null;

function loadDanmaku() {
  fetch(`${API}/matches/wins`).then(r => r.json()).then(data => {
    const d = data.data || {};
    const top3 = (d.leaderboard || []).filter(w => w.amount > 0).slice(0, 3);
    const latest = (d.latest || []).filter(w => w.amount > 0).slice(0, 7);

    // 前3名榜单 + 最新7条（去重：最新中不包含已在前3的）
    const topNames = new Set(top3.map(w => w.nickname));
    const uniqueLatest = latest.filter(w => !topNames.has(w.nickname));

    let queue = [...top3, ...uniqueLatest];
    if (queue.length < 10) queue = [...queue, ...queue];
    queue = queue.slice(0, 10);
    if (queue.length === 0) return;

    danmakuQueue = queue;
    danmakuIndex = 0;

    // 发射弹幕（每1.2秒一条，共10条）
    if (danmakuTimer) clearInterval(danmakuTimer);
    shootDanmaku();
    danmakuTimer = setInterval(() => {
      if (danmakuIndex >= danmakuQueue.length) {
        clearInterval(danmakuTimer);
        danmakuTimer = null;
        return;
      }
      shootDanmaku();
    }, 1200);
  }).catch(() => {});
}

function shootDanmaku() {
  const overlay = document.getElementById('danmakuOverlay');
  if (!overlay || danmakuIndex >= danmakuQueue.length) return;

  const item = danmakuQueue[danmakuIndex];
  const rank = danmakuIndex + 1;
  const isTop3 = rank <= 3;
  danmakuIndex++;

  const el = document.createElement('div');
  el.className = 'danmaku-item';

  // 前三名差异化
  const rankConfig = {
    1: { icon: '👑', badge: 'NO.1', textColor: '#FFD700', border: 'rgba(255,215,0,0.6)', bg: 'rgba(0,0,0,0.5)', shadow: '0 0 16px rgba(255,215,0,0.5)' },
    2: { icon: '👑', badge: 'NO.2', textColor: '#C0C0C0', border: 'rgba(192,192,192,0.5)', bg: 'rgba(0,0,0,0.45)', shadow: '0 0 12px rgba(192,192,192,0.4)' },
    3: { icon: '👑', badge: 'NO.3', textColor: '#CD7F32', border: 'rgba(205,127,50,0.5)', bg: 'rgba(0,0,0,0.42)', shadow: '0 0 10px rgba(205,127,50,0.35)' },
  };

  if (isTop3) {
    const cfg = rankConfig[rank];
    el.classList.add('danmaku-top3');
    el.style.color = cfg.textColor;
    el.style.fontSize = '17px';
    el.style.fontWeight = '800';
    el.style.border = `2px solid ${cfg.border}`;
    el.style.borderColor = cfg.border;
    el.style.background = cfg.bg;
    el.style.boxShadow = cfg.shadow;
    el.style.animation = 'danmakuEnter 0.6s ease-out, ' + (Math.random() > 0.5 ? 'danmakuLTR' : 'danmakuRTL') + ' ' + el.style.animationDuration + 's linear forwards';
    el.innerHTML = `${cfg.icon} <span class="danmaku-badge badge-${rank}">${cfg.badge}</span> <b>${item.nickname}</b> 获得 <b>${item.amount.toFixed(0)}</b> <img src="images/coin-front.png" class="danmaku-coin">`;
  } else {
    const fromRight = Math.random() > 0.5;
    el.style.top = (Math.random() * 80 + 5) + '%';
    if (fromRight) {
      el.style.right = '-400px';
      el.style.animationName = 'danmakuLTR';
    } else {
      el.style.left = '-400px';
      el.style.animationName = 'danmakuRTL';
    }
    el.innerHTML = `🎉 <b>${item.nickname}</b> 获得 <b>${item.amount.toFixed(0)}</b> <img src="images/coin-front.png" class="danmaku-coin">`;
  }

  // 前三名置顶展示3秒
  if (isTop3) {
    el.classList.add('danmaku-pinned');
    el.style.top = (8 + (rank - 1) * 28) + '%';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.animation = 'danmakuEnter 0.6s ease-out';
    el.style.opacity = '0.85';

    // 3秒后加入滚动
    setTimeout(() => {
      el.classList.remove('danmaku-pinned');
      el.style.opacity = '0.7';
      const fromRight = Math.random() > 0.5;
      const speeds = [6 + Math.random() * 3, 10 + Math.random() * 4, 15 + Math.random() * 5, 22 + Math.random() * 6];
      const dur = speeds[Math.floor(Math.random() * speeds.length)];
      el.style.animationDuration = dur + 's';
      el.style.animationName = fromRight ? 'danmakuRTL' : 'danmakuLTR';
      el.style.transition = 'none';
      el.style.top = (Math.random() * 80 + 5) + '%';
      el.style.left = fromRight ? 'auto' : '-400px';
      el.style.right = fromRight ? '-400px' : 'auto';
      el.style.transform = 'none';
      setTimeout(() => { el.remove(); }, (dur + 0.5) * 1000);
    }, 3000);
  } else {
    const speeds = [6 + Math.random() * 3, 10 + Math.random() * 4, 15 + Math.random() * 5, 22 + Math.random() * 6];
    const dur = speeds[Math.floor(Math.random() * speeds.length)];
    el.style.animationDuration = dur + 's';
    setTimeout(() => { el.remove(); }, (dur + 0.5) * 1000);
  }

  overlay.appendChild(el);
}

// ===== 滚动恭喜通知栏（已替换为弹幕） =====

// ===== 锦鲤币排行榜 =====
function loadLeaderboard() {
  const container = document.getElementById('leaderboardList');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  fetch(`${API}/matches/wins`).then(r => r.json()).then(data => {
    const wins = (data.data && data.data.leaderboard) || [];
    if (wins.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">暂无人获奖</div></div>';
      return;
    }

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    container.innerHTML = wins.map((w, i) => `
      <div class="leaderboard-card rank-${i + 1}">
        <div class="lb-rank">${medals[i] || `#${i + 1}`}</div>
        <div class="lb-info">
          <div class="lb-nickname">${w.nickname || w.account}</div>
          <div class="lb-stats">
            <span>中奖 ${w.win_count || 0} 次</span>
            <span class="lb-divider">|</span>
            <span>总锦鲤币 ${w.amount.toFixed(2)}</span>
          </div>
        </div>
        <div class="lb-amount">${w.amount.toFixed(2)} <img src="images/coin-front.png" class="coin-lb-icon"></div>
      </div>
    `).join('');
  }).catch(() => {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">加载失败</div></div>';
  });
}

// ===== 「我的」个人资料 =====
function loadProfile() {
  document.getElementById('profileNickname').textContent = currentUser.nickname || '-';
  document.getElementById('profileAccount').textContent = currentUser.account || '-';
  document.getElementById('profileAccId').textContent = currentUser.account || '-';
  document.getElementById('profileEmail').textContent = currentUser.email || '-';
  document.getElementById('profileNickDisplay').textContent = currentUser.nickname || '-';

  // 注册时间从服务器获取
  fetch(`${API}/auth/userinfo`, {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json()).then(d => {
    if (d.code === 200 && d.data.created_at) {
      document.getElementById('profileRegTime').textContent =
        new Date(d.data.created_at).toLocaleString('zh-CN');
    }
  }).catch(() => {});

  // 昵称编辑按钮
  document.getElementById('btnEditNickname').onclick = openNicknameEdit;
  // 密码修改入口
  document.getElementById('btnChangePwd').onclick = openPasswordEdit;
}

function openNicknameEdit() {
  const modal = document.getElementById('profileModal');
  document.getElementById('profileModalTitle').textContent = '修改昵称';
  document.getElementById('profileModalBody').innerHTML = `
    <div class="pwd-form-group">
      <label>新昵称</label>
      <input id="inputNewNickname" value="${currentUser.nickname || ''}" placeholder="请输入新昵称" maxlength="20">
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('btnProfileConfirm').onclick = async () => {
    const nickname = document.getElementById('inputNewNickname').value.trim();
    if (!nickname) return showToast('昵称不能为空');

    try {
      const res = await fetch(`${API}/account/nickname`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ nickname })
      });
      const data = await res.json();
      if (data.code === 200) {
        currentUser.nickname = nickname;
        document.getElementById('headerUsername').textContent = nickname;
        closeProfileModal();
        loadProfile();
        showToast('昵称修改成功');
      } else {
        showToast(data.msg);
      }
    } catch (e) {
      showToast('修改失败');
    }
  };
}

function openPasswordEdit() {
  const modal = document.getElementById('profileModal');
  document.getElementById('profileModalTitle').textContent = '修改密码';
  document.getElementById('profileModalBody').innerHTML = `
    <div class="pwd-form-group">
      <label>旧密码</label>
      <input type="password" id="inputOldPwd" placeholder="请输入当前密码">
    </div>
    <div class="pwd-form-group">
      <label>新密码</label>
      <input type="password" id="inputNewPwd" placeholder="至少6个字符">
    </div>
    <div class="pwd-form-group">
      <label>确认新密码</label>
      <input type="password" id="inputConfirmPwd" placeholder="再次输入新密码">
    </div>
  `;
  modal.classList.add('active');

  document.getElementById('btnProfileConfirm').onclick = async () => {
    const oldPassword = document.getElementById('inputOldPwd').value;
    const newPassword = document.getElementById('inputNewPwd').value;
    const confirmPassword = document.getElementById('inputConfirmPwd').value;

    if (!oldPassword || !newPassword || !confirmPassword) return showToast('请填写所有字段');
    if (newPassword.length < 6) return showToast('新密码至少6个字符');
    if (newPassword !== confirmPassword) return showToast('两次输入的新密码不一致');

    try {
      const res = await fetch(`${API}/account/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword })
      });
      const data = await res.json();
      if (data.code === 200) {
        closeProfileModal();
        showToast('密码修改成功');
      } else {
        showToast(data.msg);
      }
    } catch (e) {
      showToast('修改失败');
    }
  };
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('active');
}
