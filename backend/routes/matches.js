const express = require('express');
const { query, saveDB } = require('../database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// 比赛自动管理配置
const AUTO_END_HOURS = 3.5;       // 比赛开始3.5小时后自动结束
const NEXT_MATCH_OVERLAP_HOURS = 0.5; // 下一场开始0.5小时后上一场自动结束
const MAX_LIVE_OVERLAP_HOURS = 0.5;   // 最多两场同时进行中，重叠不超0.5小时

// 获取北京时间 (UTC+8)
function getBeijingTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

// 自动结束比赛（写入比分并标记finished）
function forceEndMatch(matchId, reason) {
  const match = query.get('matches', { id: matchId });
  if (!match || match.status === 'finished') return;

  // 生成模拟比分
  if (match.home_score == null) match.home_score = Math.floor(Math.random() * 4);
  if (match.away_score == null) match.away_score = Math.floor(Math.random() * 3);

  query.update('matches', matchId, {
    status: 'finished',
    home_score: match.home_score,
    away_score: match.away_score
  });

  console.log(`[自动结算] 比赛#${matchId} ${match.home_team} ${match.home_score}:${match.away_score} ${match.away_team} | 原因: ${reason}`);
  saveDB();
}

// 比赛状态自动管理（支持多场同时进行 + 30分钟自动结束）
function manageMatchStates() {
  const now = getBeijingTime();
  const matches = query.all('matches');
  matches.sort((a, b) => new Date(a.match_time) - new Date(b.match_time));

  let changed = false;

  // ===== 自动开始 =====
  for (const m of matches) {
    if (m.status === 'finished' || m.status === 'live' || m.status_manual || m.status === 'drawn') continue;
    const matchTime = new Date(m.match_time);
    if (now >= matchTime) {
      query.update('matches', m.id, {
        status: 'live',
        home_score: m.home_score || 0,
        away_score: m.away_score || 0,
      });
      console.log(`[自动开始] #${m.id} ${m.home_team} vs ${m.away_team}`);
      changed = true;
    }
  }

  // ===== 30分钟自动结束：下一场比赛开始前30分钟自动结束上一场 =====
  if (changed) saveDB();
  const liveMatches = query.all('matches').filter(m => m.status === 'live' && !m.status_manual);
  liveMatches.sort((a, b) => new Date(a.match_time) - new Date(b.match_time));

  for (const live of liveMatches) {
    // 找到紧接在这场比赛之后的下一个未开始的比赛
    const nextMatch = matches.find(m =>
      m.status === 'upcoming' &&
      new Date(m.match_time) > new Date(live.match_time)
    );
    if (!nextMatch) continue;

    const nextStart = new Date(nextMatch.match_time);
    const minutesUntilNext = (nextStart - now) / (1000 * 60);

    // 下一场在30分钟内 → 自动结束本场
    if (minutesUntilNext <= 30 && minutesUntilNext > -60) {
      query.update('matches', live.id, { status: 'finished' });
      console.log(`[自动结束] #${live.id} ${live.home_team} vs ${live.away_team} | 下一场30分后开始(${nextMatch.home_team}vs${nextMatch.away_team})`);
      changed = true;
    }
  }

  if (changed) saveDB();
}

// 自动更新比赛状态（每次请求list时调用）
function autoUpdateMatchStatus(match) {
  // 状态管理由 manageMatchStates 统一处理
  return match;
}

// 获取北京时间API
router.get('/time', (req, res) => {
  const now = getBeijingTime();
  res.json({
    code: 200,
    data: {
      iso: now.toISOString(),
      timestamp: now.getTime(),
      beijing: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
      date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      time: now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    }
  });
});

// 获取获奖排行榜（前5名）
router.get('/wins', (req, res) => {
  try {
    const users = query.all('users').filter(u => u.role !== 'admin');
    const transactions = query.all('transactions').filter(t => t.type === 'win');

    // 按用户汇总中奖金额
    const userWins = {};
    transactions.forEach(t => {
      if (!userWins[t.user_id]) userWins[t.user_id] = { amount: 0, count: 0 };
      userWins[t.user_id].amount += t.amount || 0;
      userWins[t.user_id].count++;
    });

    // 构建排行榜
    let leaderboard = users.map(u => ({
      account: u.account,
      nickname: u.nickname || u.account,
      amount: (userWins[u.id]?.amount || 0),
      win_count: (userWins[u.id]?.count || 0),
    }));

    // 按总奖金降序，取前5
    leaderboard.sort((a, b) => b.amount - a.amount);
    const top5 = leaderboard.filter(w => w.amount > 0).slice(0, 5);

    // 最新中奖记录（按时间倒序，取最近10条）
    const latestWins = transactions
      .filter(t => t.amount > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(t => {
        const user = users.find(u => u.id === t.user_id);
        return {
          nickname: user ? (user.nickname || user.account) : '用户',
          amount: t.amount || 0,
          win_count: 1,
          created_at: t.created_at,
        };
      })
      .slice(0, 10);

    res.json({ code: 200, data: { leaderboard: top5, latest: latestWins } });
  } catch (err) {
    res.json({ code: 500, msg: err.message });
  }
});

// 获取所有比赛
router.get('/list', (req, res) => {
  try {
    const { stage, status, group } = req.query;

    let matches = query.all('matches');

    // 先执行自动状态管理
    manageMatchStates();

    // 重新获取（状态可能已变更）
    matches = query.all('matches');

    if (stage && stage !== 'all') {
      matches = matches.filter(m => m.stage === stage);
    }
    if (status && status !== 'all') {
      matches = matches.filter(m => m.status === status);
    }
    if (group && group !== 'all') {
      matches = matches.filter(m => m.group_name === group);
    }

    // 自动更新比赛状态（基于北京时间）
    matches = matches.map(m => autoUpdateMatchStatus(m));

    matches.sort((a, b) => new Date(a.match_time) - new Date(b.match_time));

    res.json({ code: 200, data: matches, serverTime: getBeijingTime().toISOString() });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// 比赛详情
router.get('/detail/:id', (req, res) => {
  try {
    const match = query.get('matches', { id: parseInt(req.params.id) });
    if (!match) {
      return res.json({ code: 404, msg: '比赛不存在' });
    }
    res.json({ code: 200, data: match });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 获取各阶段统计
router.get('/stages', (req, res) => {
  try {
    const matches = query.all('matches');
    const stagesMap = {};

    for (const m of matches) {
      const key = `${m.stage}|${m.group_name || ''}`;
      if (!stagesMap[key]) {
        stagesMap[key] = {
          stage: m.stage,
          group_name: m.group_name,
          match_count: 0,
          finished_count: 0,
          live_count: 0,
          upcoming_count: 0
        };
      }
      stagesMap[key].match_count++;
      if (m.status === 'finished') stagesMap[key].finished_count++;
      else if (m.status === 'live') stagesMap[key].live_count++;
      else stagesMap[key].upcoming_count++;
    }

    res.json({ code: 200, data: Object.values(stagesMap) });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 模拟结算单场比赛
router.post('/settle/:id', (req, res) => {
  try {
    const matchId = parseInt(req.params.id);
    const match = query.get('matches', { id: matchId });
    if (!match) {
      return res.json({ code: 404, msg: '比赛不存在' });
    }
    if (match.status === 'finished') {
      return res.json({ code: 400, msg: '比赛已结算' });
    }

    // 如果是进行中的比赛，在现有比分基础上加
    let homeScore, awayScore;
    if (match.status === 'live') {
      homeScore = (match.home_score || 0) + Math.floor(Math.random() * 3);
      awayScore = (match.away_score || 0) + Math.floor(Math.random() * 2);
    } else {
      homeScore = Math.floor(Math.random() * 5);
      awayScore = Math.floor(Math.random() * 4);
    }

    query.update('matches', matchId, {
      status: 'finished',
      home_score: homeScore,
      away_score: awayScore
    });

    settleBets(matchId, homeScore, awayScore);

    res.json({
      code: 200,
      msg: '比赛结算完成',
      data: { home_score: homeScore, away_score: awayScore }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// 批量结算
router.post('/settle-batch', (req, res) => {
  try {
    let settled = 0;

    // 结算进行中的比赛
    const liveMatches = query.all('matches', { status: 'live' });
    for (const match of liveMatches) {
      const homeScore = (match.home_score || 0) + Math.floor(Math.random() * 4);
      const awayScore = (match.away_score || 0) + Math.floor(Math.random() * 3);

      query.update('matches', match.id, {
        status: 'finished',
        home_score: homeScore,
        away_score: awayScore
      });
      settleBets(match.id, homeScore, awayScore);
      settled++;
    }

    // 结算部分即将开始的（过了时间的）
    const now = new Date().toISOString();
    const upcomingMatches = query.all('matches', { status: 'upcoming' })
      .filter(m => m.match_time <= now)
      .slice(0, 3);

    for (const match of upcomingMatches) {
      const homeScore = Math.floor(Math.random() * 4);
      const awayScore = Math.floor(Math.random() * 3);

      query.update('matches', match.id, {
        status: 'finished',
        home_score: homeScore,
        away_score: awayScore
      });
      settleBets(match.id, homeScore, awayScore);
      settled++;
    }

    res.json({ code: 200, msg: '批量结算完成', data: { settled } });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// 结算投注
function settleBets(matchId, homeScore, awayScore) {
  const match = query.get('matches', { id: matchId });
  const bets = query.all('bets', { match_id: matchId, status: 'pending' });

  const totalGoals = homeScore + awayScore;
  const goalDiff = homeScore - awayScore;

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
      const user = query.get('users', { id: bet.user_id });
      if (user) {
        query.update('users', user.id, { balance: user.balance + winAmount });
        query.insert('transactions', {
          user_id: bet.user_id,
          type: 'win',
          amount: winAmount,
          balance_after: user.balance + winAmount,
          description: `中奖-${resultDesc}`,
          related_bet_id: bet.id,
          created_at: new Date().toISOString()
        });
      }
    } else {
      query.insert('transactions', {
        user_id: bet.user_id,
        type: 'lose',
        amount: 0,
        balance_after: query.get('users', { id: bet.user_id }).balance,
        description: `未中奖-${resultDesc}`,
        related_bet_id: bet.id,
        created_at: new Date().toISOString()
      });
    }
  }
}

module.exports = router;
