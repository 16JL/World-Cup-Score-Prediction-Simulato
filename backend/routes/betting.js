const express = require('express');
const { query, saveDB } = require('../database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// 下注
router.post('/place', authenticateToken, (req, res) => {
  try {
    const { match_id, bet_type, bet_option, bet_amount } = req.body;
    const userId = req.user.id;

    if (!match_id || !bet_type || !bet_option || !bet_amount) {
      return res.json({ code: 400, msg: '参数不完整' });
    }
    if (bet_amount < 2) {
      return res.json({ code: 400, msg: '最低投注2元' });
    }
    if (bet_amount > 50000) {
      return res.json({ code: 400, msg: '单注最高50000元' });
    }

    const match = query.get('matches', { id: match_id });
    if (!match) {
      return res.json({ code: 404, msg: '比赛不存在' });
    }
    if (match.status !== 'upcoming' && match.status !== 'live') {
      return res.json({ code: 400, msg: '该比赛已截止投注' });
    }

    const user = query.get('users', { id: userId });
    if (user.balance < bet_amount) {
      return res.json({ code: 400, msg: '余额不足，请先充值' });
    }

    // 获取赔率
    let odds = 0;
    let betOptionName = '';
    switch (bet_type) {
      case 'spf':
        if (bet_option === 'win') { odds = match.spf_win; betOptionName = '胜'; }
        else if (bet_option === 'draw') { odds = match.spf_draw; betOptionName = '平'; }
        else if (bet_option === 'lose') { odds = match.spf_lose; betOptionName = '负'; }
        break;
      case 'rqspf':
        if (bet_option === 'win') { odds = match.rqspf_win; betOptionName = '让胜'; }
        else if (bet_option === 'draw') { odds = match.rqspf_draw; betOptionName = '让平'; }
        else if (bet_option === 'lose') { odds = match.rqspf_lose; betOptionName = '让负'; }
        break;
      case 'dxq':
        if (bet_option === 'over') { odds = match.dxq_over; betOptionName = '大球'; }
        else if (bet_option === 'under') { odds = match.dxq_under; betOptionName = '小球'; }
        break;
    }

    if (odds === 0) {
      return res.json({ code: 400, msg: '无效的投注选项' });
    }

    const potentialWin = parseFloat((bet_amount * odds).toFixed(2));

    // 扣款
    query.update('users', userId, { balance: user.balance - bet_amount });
    const afterBalance = user.balance - bet_amount;

    query.insert('transactions', {
      user_id: userId,
      type: 'bet',
      amount: -bet_amount,
      balance_after: afterBalance,
      description: `投注 ${match.home_team} vs ${match.away_team} [${betOptionName}] @${odds}`,
      created_at: new Date().toISOString()
    });

    const betResult = query.insert('bets', {
      user_id: userId,
      match_id,
      bet_type,
      bet_option,
      bet_amount,
      odds,
      potential_win: potentialWin,
      status: 'pending',
      result: null,
      win_amount: 0,
      created_at: new Date().toISOString(),
      settled_at: null
    });

    res.json({
      code: 200,
      msg: '投注成功',
      data: {
        bet_id: betResult.id,
        match: `${match.home_team} vs ${match.away_team}`,
        bet_type,
        bet_option: betOptionName,
        bet_amount,
        odds,
        potential_win: potentialWin,
        balance: afterBalance
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// 投注记录
router.get('/history', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;

    let bets = query.all('bets', { user_id: userId });

    if (status && status !== 'all') {
      bets = bets.filter(b => b.status === status);
    }

    bets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = bets.length;
    const pageBets = bets.slice(offset, offset + Number(pageSize));

    // 关联比赛信息
    const list = pageBets.map(bet => {
      const match = query.get('matches', { id: bet.match_id });
      return {
        ...bet,
        home_team: match ? match.home_team : '未知',
        away_team: match ? match.away_team : '未知',
        home_flag: match ? match.home_flag : '',
        away_flag: match ? match.away_flag : '',
        home_score: match ? match.home_score : null,
        away_score: match ? match.away_score : null,
        stage: match ? match.stage : '',
        match_time: match ? match.match_time : ''
      };
    });

    res.json({
      code: 200,
      data: { list, total, page: Number(page), pageSize: Number(pageSize) }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// 投注统计
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const bets = query.all('bets', { user_id: userId });

    const totalBets = bets.length;
    const totalAmount = bets.reduce((sum, b) => sum + b.bet_amount, 0);
    const winCount = bets.filter(b => b.result === 'win').length;
    const loseCount = bets.filter(b => b.result === 'lose').length;
    const pendingCount = bets.filter(b => b.status === 'pending').length;
    const totalWin = bets.reduce((sum, b) => sum + (b.win_amount || 0), 0);
    const settledCount = winCount + loseCount;
    const winRate = settledCount > 0 ? parseFloat((winCount / settledCount * 100).toFixed(1)) : 0;
    const maxWin = Math.max(0, ...bets.filter(b => b.result === 'win').map(b => b.win_amount || 0));
    const maxBet = Math.max(0, ...bets.map(b => b.bet_amount));

    // 按玩法
    const byTypeMap = {};
    for (const b of bets) {
      if (!byTypeMap[b.bet_type]) {
        byTypeMap[b.bet_type] = { bet_type: b.bet_type, count: 0, amount: 0, wins: 0, win_amount: 0 };
      }
      byTypeMap[b.bet_type].count++;
      byTypeMap[b.bet_type].amount += b.bet_amount;
      if (b.result === 'win') {
        byTypeMap[b.bet_type].wins++;
        byTypeMap[b.bet_type].win_amount += (b.win_amount || 0);
      }
    }

    // 趋势
    const trendMap = {};
    for (const b of bets) {
      const date = b.created_at ? b.created_at.slice(0, 10) : 'unknown';
      if (!trendMap[date]) {
        trendMap[date] = { date, count: 0, amount: 0, win_amount: 0 };
      }
      trendMap[date].count++;
      trendMap[date].amount += b.bet_amount;
      trendMap[date].win_amount += (b.win_amount || 0);
    }

    const trend = Object.values(trendMap).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

    res.json({
      code: 200,
      data: {
        overview: { total_bets: totalBets, total_amount: totalAmount, win_count: winCount, lose_count: loseCount, pending_count: pendingCount, total_win: totalWin, win_rate: winRate, max_win: maxWin, max_bet: maxBet },
        byType: Object.values(byTypeMap),
        trend
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

module.exports = router;
