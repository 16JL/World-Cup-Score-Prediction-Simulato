const express = require('express');
const bcrypt = require('bcryptjs');
const { query, saveDB } = require('../database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// 账户信息
router.get('/info', authenticateToken, (req, res) => {
  try {
    const user = query.get('users', { id: req.user.id });
    if (!user) return res.json({ code: 404, msg: '用户不存在' });

    const bets = query.all('bets', { user_id: user.id });
    const pendingBets = bets.filter(b => b.status === 'pending');
    const pendingCount = pendingBets.length;
    const pendingAmount = pendingBets.reduce((s, b) => s + b.bet_amount, 0);

    const today = new Date().toISOString().slice(0, 10);
    const txns = query.all('transactions', { user_id: user.id });

    let todayBet = 0, todayWin = 0;
    for (const t of txns) {
      if (!t.created_at || !t.created_at.startsWith(today)) continue;
      if (t.type === 'bet') todayBet += Math.abs(t.amount);
      else if (t.type === 'win') todayWin += t.amount;
    }

    const { password, ...safeUser } = user;
    res.json({
      code: 200,
      data: {
        ...safeUser,
        pending_bets_count: pendingCount,
        pending_bets_amount: pendingAmount,
        today_bet: todayBet,
        today_win: todayWin,
        today_profit: todayWin - todayBet
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 充值
router.post('/recharge', authenticateToken, (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.json({ code: 400, msg: '充值金额必须大于0' });
    }
    if (amount > 100000) {
      return res.json({ code: 400, msg: '单次最高充值100000元' });
    }

    const user = query.get('users', { id: userId });
    const newBalance = user.balance + amount;
    query.update('users', userId, { balance: newBalance });

    query.insert('transactions', {
      user_id: userId,
      type: 'recharge',
      amount,
      balance_after: newBalance,
      description: '账户充值',
      created_at: new Date().toISOString()
    });

    res.json({ code: 200, msg: `成功充值${amount}元`, data: { balance: newBalance } });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 提现
router.post('/withdraw', authenticateToken, (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.json({ code: 400, msg: '提现金额必须大于0' });
    }

    const user = query.get('users', { id: userId });
    if (user.balance < amount) {
      return res.json({ code: 400, msg: '余额不足' });
    }

    const newBalance = user.balance - amount;
    query.update('users', userId, { balance: newBalance });

    query.insert('transactions', {
      user_id: userId,
      type: 'withdraw',
      amount: -amount,
      balance_after: newBalance,
      description: '账户提现',
      created_at: new Date().toISOString()
    });

    res.json({ code: 200, msg: `成功提现${amount}元`, data: { balance: newBalance } });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 交易记录
router.get('/transactions', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id;
    const { type, page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;

    let txns = query.all('transactions', { user_id: userId });

    if (type && type !== 'all') {
      txns = txns.filter(t => t.type === type);
    }

    txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const total = txns.length;
    const pageTxns = txns.slice(offset, offset + Number(pageSize));

    res.json({
      code: 200,
      data: { list: pageTxns, total, page: Number(page), pageSize: Number(pageSize) }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// ===== 修改昵称 =====
router.put('/nickname', authenticateToken, (req, res) => {
  try {
    const { nickname } = req.body;
    if (!nickname || !nickname.trim()) {
      return res.json({ code: 400, msg: '昵称不能为空' });
    }
    if (nickname.length > 20) {
      return res.json({ code: 400, msg: '昵称最长20个字符' });
    }

    query.update('users', req.user.id, { nickname: nickname.trim() });
    res.json({ code: 200, msg: '昵称修改成功', data: { nickname: nickname.trim() } });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// ===== 修改密码 =====
router.put('/password', authenticateToken, (req, res) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;

    if (!oldPassword || !newPassword || !confirmPassword) {
      return res.json({ code: 400, msg: '请填写所有密码字段' });
    }
    if (newPassword.length < 6) {
      return res.json({ code: 400, msg: '新密码至少6个字符' });
    }
    if (newPassword !== confirmPassword) {
      return res.json({ code: 400, msg: '两次输入的新密码不一致' });
    }

    const user = query.get('users', { id: req.user.id });
    if (!user) return res.json({ code: 404, msg: '用户不存在' });

    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.json({ code: 400, msg: '旧密码错误' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    query.update('users', req.user.id, { password: hashedPassword });

    res.json({ code: 200, msg: '密码修改成功，请继续使用新密码' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;
