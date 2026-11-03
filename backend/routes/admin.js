const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, saveDB } = require('../database');
const syncService = require('../sync-service');
const emailService = require('../email-service');
const liveScoreSync = require('../live-score-sync');

const router = express.Router();
const ADMIN_JWT_SECRET = 'admin_worldcup_betting_2026_operator_secret';

// 预设庄家账号
const DEFAULT_ADMINS = [
  { username: 'admin', password: 'admin888', nickname: '超级庄家' },
  { username: 'operator', password: 'operate666', nickname: '运营庄家' },
];

// 种子庄家账号
function seedAdminAccounts() {
  for (const admin of DEFAULT_ADMINS) {
    const existing = query.get('users', { username: admin.username });
    if (!existing) {
      query.insert('users', {
        username: admin.username,
        password: bcrypt.hashSync(admin.password, 10),
        nickname: admin.nickname,
        balance: 0,
        role: 'admin',
        created_at: new Date().toISOString()
      });
      console.log(`  📌 庄家账号: ${admin.username} / ${admin.password}`);
    } else if (!existing.role) {
      // 更新已有用户为admin
      existing.role = 'admin';
      existing.password = bcrypt.hashSync(admin.password, 10);
      saveDB();
    }
  }
}

// 庄家认证中间件
function adminAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.json({ code: 401, msg: '未授权访问' });
  }

  jwt.verify(token, ADMIN_JWT_SECRET, (err, decoded) => {
    if (err) return res.json({ code: 403, msg: '会话已过期' });
    req.adminUser = decoded;
    next();
  });
}

// 庄家登录
router.post('/login', (req, res) => {
  try {
    const { username, password, twoFactorCode } = req.body;

    if (!username || !password || !twoFactorCode) {
      return res.json({ code: 400, msg: '参数不完整' });
    }

    // 二次验证码校验（默认888888）
    if (twoFactorCode !== '888888') {
      return res.json({ code: 403, msg: '安全码错误，访问被拒绝' });
    }

    const user = query.get('users', { username });
    if (!user || user.role !== 'admin') {
      return res.json({ code: 403, msg: '非庄家账号，禁止访问' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.json({ code: 403, msg: '密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'admin' },
      ADMIN_JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      code: 200,
      msg: '身份验证通过',
      data: {
        token,
        user: { id: user.id, username: user.username, nickname: user.nickname }
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 验证庄家身份
router.get('/verify', adminAuthenticate, (req, res) => {
  const user = query.get('users', { id: req.adminUser.id });
  if (!user || user.role !== 'admin') {
    return res.json({ code: 403, msg: '非庄家账号' });
  }
  res.json({
    code: 200,
    data: { id: user.id, username: user.username, nickname: user.nickname }
  });
});

// 数据清零
router.post('/reset-stats', adminAuthenticate, (req, res) => {
  try {
    const { query, saveDB } = require('../database');
    const allBets = query.all('bets');
    const allTxns = query.all('transactions');
    allBets.forEach(b => query.remove('bets', b.id));
    allTxns.forEach(t => query.remove('transactions', t.id));
    saveDB();
    console.log(`[清零] 删除 ${allBets.length} 投注 + ${allTxns.length} 流水`);
    res.json({ code: 200, msg: `已清除 ${allBets.length} 投注 + ${allTxns.length} 流水` });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 获取IP
router.get('/ip', adminAuthenticate, (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
             req.headers['x-real-ip'] ||
             req.socket.remoteAddress ||
             'unknown';
  res.json({ code: 200, data: { ip } });
});

// 仪表盘数据
router.get('/dashboard', adminAuthenticate, (req, res) => {
  try {
    const users = query.all('users');
    const bets = query.all('bets');
    const matches = query.all('matches');
    const txns = query.all('transactions');

    const totalUsers = users.filter(u => u.role !== 'admin').length;
    const totalBalance = users.filter(u => u.role !== 'admin').reduce((s, u) => s + (u.balance || 0), 0);
    const totalBets = bets.length;
    const totalPayout = bets.filter(b => b.result === 'win').reduce((s, b) => s + (b.win_amount || 0), 0);
    const totalBetAmount = bets.reduce((s, b) => s + (b.bet_amount || 0), 0);
    const platformProfit = totalBetAmount - totalPayout;
    const liveMatches = matches.filter(m => m.status === 'live').length;

    const today = new Date().toISOString().slice(0, 10);
    const todayTxns = txns.filter(t => t.created_at && t.created_at.startsWith(today));
    const todayBets = bets.filter(b => b.created_at && b.created_at.startsWith(today));
    const todayUsers = users.filter(u => u.role !== 'admin' && u.created_at && u.created_at.startsWith(today));

    const todayData = {
      newUsers: todayUsers.length,
      bets: todayBets.length,
      betAmount: todayBets.reduce((s, b) => s + (b.bet_amount || 0), 0),
      payout: todayBets.filter(b => b.result === 'win').reduce((s, b) => s + (b.win_amount || 0), 0),
      profit: 0,
      recharge: todayTxns.filter(t => t.type === 'recharge').reduce((s, t) => s + (t.amount || 0), 0)
    };
    todayData.profit = todayData.betAmount - todayData.payout;

    // 最近投注
    const recentBets = [...bets]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map(b => {
        const u = query.get('users', { id: b.user_id });
        const m = query.get('matches', { id: b.match_id });
        return {
          ...b,
          username: u ? (u.nickname || u.account || '未知') : '未知',
          home_team: m ? m.home_team : '-',
          away_team: m ? m.away_team : '-'
        };
      });

    res.json({
      code: 200,
      data: {
        totalUsers, totalBalance, totalBets, totalPayout, platformProfit, liveMatches,
        today: todayData,
        recentBets
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 获取所有比赛（管理视图）
router.get('/matches', adminAuthenticate, (req, res) => {
  try {
    const { status, stage } = req.query;
    let matches = query.all('matches');

    if (status && status !== 'all') {
      const statuses = status.split(',').map(s => s.trim());
      matches = matches.filter(m => statuses.includes(m.status));
    }
    if (stage && stage !== 'all') {
      matches = matches.filter(m => m.stage === stage);
    }

    matches.sort((a, b) => new Date(a.match_time) - new Date(b.match_time));
    res.json({ code: 200, data: matches });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 更新赔率
router.put('/odds/:id', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const match = query.get('matches', { id: matchId });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });

    const allowed = ['spf_win', 'spf_draw', 'spf_lose', 'handicap', 'rqspf_win', 'rqspf_draw', 'rqspf_lose', 'over_under_line', 'dxq_over', 'dxq_under'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = parseFloat(req.body[key]);
      }
    }

    query.update('matches', matchId, updates);
    res.json({ code: 200, msg: '赔率已更新' });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 用户列表
router.get('/users', adminAuthenticate, (req, res) => {
  try {
    const { search } = req.query;
    let users = query.all('users');

    if (search) {
      users = users.filter(u => u.username.includes(search) || (u.nickname && u.nickname.includes(search)));
    }

    const bets = query.all('bets');
    const userBetCounts = {};
    bets.forEach(b => {
      userBetCounts[b.user_id] = (userBetCounts[b.user_id] || 0) + 1;
    });

    const list = users
      .filter(u => u.role !== 'admin')
      .sort((a, b) => b.id - a.id)
      .map(u => ({
        ...u,
        password: undefined,
        bet_count: userBetCounts[u.id] || 0
      }));

    res.json({ code: 200, data: list });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 按账号充值
router.post('/recharge', adminAuthenticate, (req, res) => {
  try {
    const { account, amount, note } = req.body;

    if (!account || !amount || amount <= 0) {
      return res.json({ code: 400, msg: '请输入有效账号和金额' });
    }

    if (amount > 100000) {
      return res.json({ code: 400, msg: '单次充值最高100000元' });
    }

    // 按账号或邮箱查找用户
    const user = query.get('users', { account }) || query.get('users', { email: account });
    if (!user) {
      return res.json({ code: 404, msg: '未找到该账号对应的用户' });
    }

    if (user.role === 'admin') {
      return res.json({ code: 400, msg: '不能为管理员账号充值' });
    }

    const newBalance = user.balance + amount;
    query.update('users', user.id, { balance: newBalance });

    query.insert('transactions', {
      user_id: user.id,
      type: 'recharge',
      amount: amount,
      balance_after: newBalance,
      description: `管理员充值: ${note || '线下充值'}`,
      created_at: new Date().toISOString()
    });

    console.log(`[充值] 管理员为 ${user.account}(${user.email}) 充值 ${amount}元, 余额: ${user.balance} → ${newBalance}`);

    res.json({
      code: 200,
      msg: `成功为账号 ${user.account} 充值 ${amount} 元`,
      data: {
        account: user.account,
        nickname: user.nickname,
        amount: amount,
        balance_before: user.balance,
        balance_after: newBalance
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 调整用户余额
router.put('/users/:id/balance', adminAuthenticate, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { amount, note } = req.body;

    const user = query.get('users', { id: userId });
    if (!user) return res.json({ code: 404, msg: '用户不存在' });

    const newBalance = user.balance + amount;
    if (newBalance < 0) return res.json({ code: 400, msg: '余额不能为负' });

    query.update('users', userId, { balance: newBalance });

    query.insert('transactions', {
      user_id: userId,
      type: amount >= 0 ? 'recharge' : 'withdraw',
      amount: amount,
      balance_after: newBalance,
      description: `管理员调整: ${note || '余额调整'}`,
      created_at: new Date().toISOString()
    });

    res.json({ code: 200, msg: '余额已调整', data: { balance: newBalance } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 全部交易
// 资金流水（含庄家余额快照）
// 庄家视角：充值/投注=收入(+), 中奖/退款=支出(-)
function getBankerNet(t) {
  const amt = Math.abs(t.amount || 0);
  switch (t.type) {
    case 'recharge': return amt;      // 用户充值 → 庄家收入
    case 'bet':     return amt;      // 用户投注 → 庄家收入
    case 'win':     return -amt;     // 用户中奖 → 庄家支出
    case 'draw':    return -amt;     // 退款 → 庄家支出
    case 'adjust':  return t.amount; // 调整直接取正负
    default:        return 0;
  }
}

router.get('/transactions', adminAuthenticate, (req, res) => {
  try {
    const { type, username, startDate, endDate, page, pageSize } = req.query;
    const pg = parseInt(page) || 1;
    const ps = Math.min(parseInt(pageSize) || 50, 200);
    let txns = query.all('transactions');
    const users = query.all('users');

    // 关联用户名和余额快照
    txns = txns.map(t => {
      const u = users.find(u => u.id === t.user_id);
      return {
        ...t,
        username: u ? (u.nickname || u.account || '未知') : '未知',
        balance_after: t.balance_after != null ? t.balance_after : 0
      };
    });

    // 筛选
    if (type && type !== 'all') txns = txns.filter(t => t.type === type);
    if (username) txns = txns.filter(t => t.username.includes(username));
    if (startDate) txns = txns.filter(t => t.created_at && t.created_at >= startDate);
    if (endDate) txns = txns.filter(t => t.created_at && t.created_at <= endDate + 'T23:59:59');

    // 排序（旧→新计算庄家余额）
    txns.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    // 计算庄家视角的每笔净影响及累积余额
    let bankerBalance = 0;
    txns.forEach(t => {
      const bankerNet = getBankerNet(t);
      t.banker_net = bankerNet;
      bankerBalance += bankerNet;
      t.balance_after = bankerBalance;
    });

    // 排回新→旧
    txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = txns.length;
    const totalPages = Math.ceil(total / ps);
    const list = txns.slice((pg - 1) * ps, pg * ps);

    // 统计摘要（庄家视角）
    const income = txns.filter(t => t.banker_net > 0).reduce((s, t) => s + t.banker_net, 0);
    const expense = txns.filter(t => t.banker_net < 0).reduce((s, t) => s - t.banker_net, 0);

    res.json({ code: 200, data: { list, total, page: pg, pageSize: ps, totalPages, stats: { income, expense, net: income - expense } } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 资金流水导出CSV
router.get('/transactions/export', adminAuthenticate, (req, res) => {
  try {
    const { type, username, startDate, endDate } = req.query;
    let txns = query.all('transactions');
    const users = query.all('users');

    txns = txns.map(t => {
      const u = users.find(u => u.id === t.user_id);
      return {
        ...t,
        username: u ? (u.nickname || u.account || '未知') : '未知'
      };
    });

    if (type && type !== 'all') txns = txns.filter(t => t.type === type);
    if (username) txns = txns.filter(t => t.username.includes(username));
    if (startDate) txns = txns.filter(t => t.created_at && t.created_at >= startDate);
    if (endDate) txns = txns.filter(t => t.created_at && t.created_at <= endDate + 'T23:59:59');

    txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const typeLabel = { recharge: '充值', bet: '投注', win: '中奖', draw: '退款', adjust: '调整', settle: '结算' };
    const amtLabel = (t) => {
      if (t.type === 'recharge' || t.type === 'win' || t.type === 'draw') return '+' + (t.amount || 0);
      if (t.type === 'bet') return '-' + Math.abs(t.amount || 0);
      if (t.type === 'adjust') return (t.amount || 0) >= 0 ? '+' + t.amount : '' + t.amount;
      return '' + (t.amount || 0);
    };

    let csv = '\uFEFF交易时间,增减金额,交易后余额,交易类型,关联用户,交易详情\n';
    txns.forEach(t => {
      const time = t.created_at ? new Date(t.created_at).toLocaleString('zh-CN') : '-';
      const row = [time, amtLabel(t), (t.balance_after || 0).toFixed(2), typeLabel[t.type] || t.type, t.username, t.note || t.desc || '-'];
      csv += row.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=funds_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 全部投注
router.get('/bets', adminAuthenticate, (req, res) => {
  try {
    const { status } = req.query;
    let bets = query.all('bets');

    if (status && status !== 'all') {
      bets = bets.filter(b => b.status === status);
    }

    bets.sort((a, b) => new Date(b.created_at) - new Date(b.created_at));

    const list = bets.slice(0, 100).map(b => {
      const u = query.get('users', { id: b.user_id });
      const m = query.get('matches', { id: b.match_id });
      return {
        ...b,
        username: u ? (u.nickname || u.account || '未知') : '未知',
        home_team: m ? m.home_team : '-',
        away_team: m ? m.away_team : '-'
      };
    });

    res.json({ code: 200, data: list });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 待结算投注数量
router.get('/pending-bets-count', adminAuthenticate, (req, res) => {
  try {
    const bets = query.all('bets', { status: 'pending' });
    const counts = {};
    bets.forEach(b => {
      counts[b.match_id] = (counts[b.match_id] || 0) + 1;
    });

    const result = Object.entries(counts).map(([match_id, cnt]) => ({
      match_id: parseInt(match_id),
      cnt
    }));

    res.json({ code: 200, data: result });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 开奖（手动触发，结算投注+发放奖金）
router.post('/draw/:id', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const match = query.get('matches', { id: matchId });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });
    if (match.status === 'drawn') return res.json({ code: 400, msg: '本场比赛已开奖' });
    if (match.home_score == null || match.away_score == null) {
      return res.json({ code: 400, msg: '请先录入最终比分' });
    }

    const adminUser = req.adminUser || { username: 'admin' };
    const homeScore = match.home_score;
    const awayScore = match.away_score;

    // 执行结算逻辑
    const result = performSettle(matchId, homeScore, awayScore);

    // 记录开奖日志（控制台 + 比赛记录）
    query.update('matches', matchId, {
      status: 'drawn',
      drawn_at: new Date().toISOString(),
      drawn_by: adminUser.username || 'admin'
    });

    console.log(`[开奖] #${matchId} ${match.home_team} ${homeScore}:${awayScore} ${match.away_team}`);
    console.log(`[开奖]   总投注:${result.totalBets} | 中奖:${result.winCount} | 未中:${result.loseCount} | 派奖:¥${result.totalPrize.toFixed(2)}`);
    console.log(`[开奖]   操作员:${adminUser.username} | 时间:${new Date().toLocaleString('zh-CN')}`);

    res.json({
      code: 200,
      msg: '开奖完成',
      data: {
        match: `${match.home_team} ${homeScore}:${awayScore} ${match.away_team}`,
        total_bets: result.totalBets,
        win_count: result.winCount,
        lose_count: result.loseCount,
        total_prize: result.totalPrize.toFixed(2),
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 执行结算（纯逻辑，可复用）
function performSettle(matchId, homeScore, awayScore) {
  const match = query.get('matches', { id: matchId });
  const bets = query.all('bets', { match_id: matchId, status: 'pending' });
  const totalGoals = homeScore + awayScore;
  const goalDiff = homeScore - awayScore;

  let winCount = 0, loseCount = 0, totalPrize = 0;

  for (const bet of bets) {
    let win = false;
    let resultDesc = '';

    switch (bet.bet_type) {
      case 'spf':
        if (bet.bet_option === 'win' && homeScore > awayScore) win = true;
        else if (bet.bet_option === 'draw' && homeScore === awayScore) win = true;
        else if (bet.bet_option === 'lose' && homeScore < awayScore) win = true;
        resultDesc = `${homeScore}:${awayScore}`;
        break;
      case 'rqspf': {
        const adjustedDiff = goalDiff + match.handicap;
        if (bet.bet_option === 'win' && adjustedDiff > 0) win = true;
        else if (bet.bet_option === 'draw' && adjustedDiff === 0) win = true;
        else if (bet.bet_option === 'lose' && adjustedDiff < 0) win = true;
        const hText = match.handicap > 0 ? `+${match.handicap}` : match.handicap;
        resultDesc = `让${hText}球 ${homeScore}:${awayScore}`;
        break;
      }
      case 'dxq':
        if (bet.bet_option === 'over' && totalGoals > match.over_under_line) win = true;
        else if (bet.bet_option === 'under' && totalGoals < match.over_under_line) win = true;
        resultDesc = `总进球${totalGoals} 盘口${match.over_under_line}`;
        break;
    }

    const winAmount = win ? (bet.bet_amount * bet.odds) : 0;

    query.update('bets', bet.id, {
      status: 'settled',
      result: win ? 'win' : 'lose',
      win_amount: winAmount,
      settled_at: new Date().toISOString()
    });

    if (win) {
      winCount++;
      totalPrize += winAmount;
      const user = query.get('users', { id: bet.user_id });
      if (user) {
        query.update('users', user.id, { balance: user.balance + winAmount });
        query.insert('transactions', {
          user_id: bet.user_id,
          type: 'win',
          amount: winAmount,
          balance_after: user.balance + winAmount,
          description: `中奖: ${match.home_team} vs ${match.away_team} (${resultDesc}), 投注¥${bet.bet_amount} 赔率${bet.odds}`,
          related_bet_id: bet.id,
          created_at: new Date().toISOString()
        });
      }
    } else {
      loseCount++;
      query.insert('transactions', {
        user_id: bet.user_id,
        type: 'bet_result',
        amount: -bet.bet_amount,
        balance_after: query.get('users', { id: bet.user_id })?.balance || 0,
        description: `未中奖: ${match.home_team} vs ${match.away_team} (${resultDesc})`,
        related_bet_id: bet.id,
        created_at: new Date().toISOString()
      });
    }
  }

  saveDB();

  return {
    totalBets: bets.length,
    winCount,
    loseCount,
    totalPrize,
  };
}

// ===== 赔率同步管理 =====

// 获取同步状态
router.get('/sync/status', adminAuthenticate, (req, res) => {
  try {
    const status = syncService.getSyncStatus();
    const mode = syncService.getSyncMode();
    res.json({ code: 200, data: { ...status, mode } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 切换同步模式
router.post('/sync/mode', adminAuthenticate, (req, res) => {
  try {
    const { mode } = req.body;
    const result = syncService.setSyncMode(mode);
    if (result.success) {
      res.json({ code: 200, msg: result.msg, data: { mode: result.newMode } });
    } else {
      res.json({ code: 400, msg: result.msg });
    }
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 手动触发同步
router.post('/sync/trigger', adminAuthenticate, (req, res) => {
  try {
    const result = syncService.performSync();
    if (result.success) {
      res.json({ code: 200, msg: result.msg, data: { mode: result.mode, count: result.count } });
    } else {
      res.json({ code: 400, msg: result.msg });
    }
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 手动设置赔率（仅手动模式）
router.put('/sync/odds/:id', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const result = syncService.setManualOdds(matchId, req.body);
    if (result.success) {
      res.json({ code: 200, msg: result.msg });
    } else {
      res.json({ code: 400, msg: result.msg });
    }
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 获取缓存赔率（快速查看最新数据源）
router.get('/sync/cached-odds', adminAuthenticate, (req, res) => {
  try {
    const cached = syncService.getCachedOdds();
    res.json({ code: 200, data: cached });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// ===== 比赛结果同步 =====

// 获取最新比赛结果
router.get('/results', adminAuthenticate, (req, res) => {
  try {
    const results = syncService.getMatchResults();
    // 获取已结束的比赛结果
    const finishedMatches = query.all('matches', { status: 'finished' })
      .sort((a, b) => b.id - a.id)
      .slice(0, 20)
      .map(m => ({
        id: m.id,
        home_team: m.home_team,
        away_team: m.away_team,
        home_flag: m.home_flag,
        away_flag: m.away_flag,
        home_score: m.home_score,
        away_score: m.away_score,
        stage: m.stage,
        group_name: m.group_name,
        match_time: m.match_time,
      }));

    res.json({
      code: 200,
      data: {
        live: results.data,
        finished: finishedMatches,
        source: results.source,
        updated: results.timestamp
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 更新比赛比分（模拟官方结果更新）
router.post('/results/update-score', adminAuthenticate, (req, res) => {
  try {
    const { match_id, home_score, away_score } = req.body;
    if (!match_id || home_score === undefined || away_score === undefined) {
      return res.json({ code: 400, msg: '参数不完整' });
    }

    const match = query.get('matches', { id: parseInt(match_id) });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });
    if (match.status === 'finished') return res.json({ code: 400, msg: '比赛已结算，不可修改比分' });

    query.update('matches', parseInt(match_id), {
      home_score: parseInt(home_score),
      away_score: parseInt(away_score),
    });

    res.json({
      code: 200,
      msg: '比分已更新',
      data: { home_score: parseInt(home_score), away_score: parseInt(away_score) }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// ===== 邮件服务状态 =====
router.get('/email-status', adminAuthenticate, (req, res) => {
  try {
    const status = emailService.getSmtpStatus();
    res.json({
      code: 200,
      data: {
        ...status,
        codeConfig: emailService.CODE_CONFIG,
        systemEmail: 'football_system@163.com',
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 重新测试邮件连接
router.post('/email-test', adminAuthenticate, async (req, res) => {
  try {
    const ok = await emailService.checkConnection();
    res.json({
      code: 200,
      data: { connected: ok, status: emailService.getSmtpStatus() }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// ===== 实时比分同步状态 =====
router.get('/live-score/status', adminAuthenticate, (req, res) => {
  try {
    const state = liveScoreSync.getSyncState();
    res.json({ code: 200, data: state });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

router.post('/live-score/trigger', adminAuthenticate, (req, res) => {
  try {
    const result = liveScoreSync.performScoreSync();
    res.json({ code: 200, data: result });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// ===== 比赛状态管理 =====

// 切换比赛状态
router.put('/match/:id/status', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const { status } = req.body;
    const validStatuses = ['upcoming', 'live', 'finished', 'paused'];

    if (!validStatuses.includes(status)) {
      return res.json({ code: 400, msg: '无效状态，仅支持: upcoming/live/finished/paused' });
    }

    const match = query.get('matches', { id: matchId });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });

    query.update('matches', matchId, {
      status,
      status_manual: true  // 管理员手动设置，系统不再自动覆盖
    });
    console.log(`[比赛管理] #${matchId} ${match.home_team} vs ${match.away_team} → ${status}`);
    res.json({ code: 200, msg: `已切换为: ${status}`, data: { id: matchId, status } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 批量切换状态
router.post('/match/batch-status', adminAuthenticate, (req, res) => {
  try {
    const { ids, status } = req.body;
    const validStatuses = ['upcoming', 'live', 'finished', 'paused'];

    if (!Array.isArray(ids) || !validStatuses.includes(status)) {
      return res.json({ code: 400, msg: '参数错误' });
    }

    let count = 0;
    ids.forEach(id => {
      const match = query.get('matches', { id: parseInt(id) });
      if (match) {
        query.update('matches', parseInt(id), {
          status,
          status_manual: true
        });
        count++;
      }
    });

    res.json({ code: 200, msg: `已更新 ${count} 场比赛状态为: ${status}`, data: { count } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 切换比分模式
router.put('/match/:id/score-mode', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const { mode } = req.body;

    if (!['auto', 'manual'].includes(mode)) {
      return res.json({ code: 400, msg: '模式仅支持 auto/manual' });
    }

    const match = query.get('matches', { id: matchId });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });

    query.update('matches', matchId, {
      score_mode: mode,
      score_mode_changed_at: new Date().toISOString()
    });

    console.log(`[比分模式] #${matchId} ${match.home_team} vs ${match.away_team} → ${mode}`);
    res.json({ code: 200, msg: `比分模式: ${mode}`, data: { id: matchId, mode } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 手动录入比分
router.put('/match/:id/score', adminAuthenticate, (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const { home_score, away_score } = req.body;

    if (home_score === undefined || away_score === undefined) {
      return res.json({ code: 400, msg: '请提供完整比分' });
    }

    const match = query.get('matches', { id: matchId });
    if (!match) return res.json({ code: 404, msg: '比赛不存在' });
    if (match.score_mode === 'auto') {
      return res.json({ code: 400, msg: '自动同步模式下不能手动修改比分' });
    }

    query.update('matches', matchId, {
      home_score: parseInt(home_score),
      away_score: parseInt(away_score),
      score_updated_at: new Date().toISOString()
    });

    console.log(`[手动比分] #${matchId} ${match.home_team} ${home_score}:${away_score} ${match.away_team}`);
    res.json({
      code: 200,
      msg: `比分已更新: ${home_score}:${away_score}`,
      data: { id: matchId, home_score: parseInt(home_score), away_score: parseInt(away_score) }
    });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 批量设置比分模式
router.post('/match/batch-score-mode', adminAuthenticate, (req, res) => {
  try {
    const { ids, mode } = req.body;
    if (!Array.isArray(ids) || !['auto', 'manual'].includes(mode)) {
      return res.json({ code: 400, msg: '参数错误' });
    }

    let count = 0;
    ids.forEach(id => {
      const match = query.get('matches', { id: parseInt(id) });
      if (match) {
        query.update('matches', parseInt(id), { score_mode: mode, score_mode_changed_at: new Date().toISOString() });
        count++;
      }
    });

    res.json({ code: 200, msg: `已设置 ${count} 场比赛为: ${mode}`, data: { count } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// ===== 玩法开关控制 =====
const _fs = require('fs');
const _path = require('path');
const _dbPath = _path.join(__dirname, '..', 'worldcup_data.json');

function _getPlayConfig() {
  try {
    if (_fs.existsSync(_dbPath)) {
      const raw = JSON.parse(_fs.readFileSync(_dbPath, 'utf8'));
      if (!raw.config) raw.config = { playTypes: { spf: true, rqspf: true, dxq: true } };
      return raw.config;
    }
  } catch(e) {}
  return { playTypes: { spf: true, rqspf: true, dxq: true } };
}

function _setPlayConfig(config) {
  try {
    if (_fs.existsSync(_dbPath)) {
      const raw = JSON.parse(_fs.readFileSync(_dbPath, 'utf8'));
      raw.config = config;
      _fs.writeFileSync(_dbPath, JSON.stringify(raw, null, 2));
      return true;
    }
  } catch(e) {}
  return false;
}

router.get('/play-types', adminAuthenticate, (req, res) => {
  res.json({ code: 200, data: _getPlayConfig().playTypes });
});

router.put('/play-types', adminAuthenticate, (req, res) => {
  const { key, enabled } = req.body;
  if (!['spf', 'rqspf', 'dxq'].includes(key)) return res.json({ code: 400, msg: '无效玩法' });
  const cfg = _getPlayConfig();
  cfg.playTypes[key] = !!enabled;
  _setPlayConfig(cfg);
  console.log(`[玩法开关] ${key} → ${enabled ? 'ON' : 'OFF'}`);
  res.json({ code: 200, data: cfg.playTypes });
});

// 客户端公开接口
router.get('/play-types/public', (req, res) => {
  res.json({ code: 200, data: _getPlayConfig().playTypes });
});

module.exports = { router, adminAuthenticate, seedAdminAccounts };
