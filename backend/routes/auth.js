const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../database');
const emailService = require('../email-service');

const router = express.Router();
const JWT_SECRET = 'worldcup_betting_2026_secret_key';

// 生成系统账号（8位数字）
function generateAccountNumber() {
  const users = query.all('users');
  const existingIds = new Set(users.map(u => u.account));
  let num;
  do {
    num = String(10000000 + Math.floor(Math.random() * 90000000));
  } while (existingIds.has(num));
  return num;
}

// ===== 发送验证码 =====
router.post('/send-code', (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ code: 400, msg: '请输入有效的邮箱地址' });
    }

    // 检查邮箱是否已注册
    const existing = query.get('users', { email });
    if (existing) {
      return res.json({ code: 400, msg: '该邮箱已被注册' });
    }

    // 冷却检查
    const canSend = emailService.canResend(email);
    if (!canSend.allowed) {
      return res.json({ code: 400, msg: canSend.msg });
    }

    // 发送验证码
    emailService.sendVerificationCode(email).then(result => {
      res.json({
        code: 200,
        msg: result.msg,
        devCode: result.devCode // 开发模式下返回验证码便于调试
      });
    }).catch(err => {
      res.json({ code: 500, msg: '验证码发送失败' });
    });

  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// ===== 注册 =====
router.post('/register', async (req, res) => {
  try {
    const { email, code, nickname, password, password2 } = req.body;

    if (!email || !code || !password || !password2) {
      return res.json({ code: 400, msg: '请填写所有必填项' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ code: 400, msg: '邮箱格式不正确' });
    }

    if (password.length < 6) {
      return res.json({ code: 400, msg: '密码至少6个字符' });
    }

    if (password !== password2) {
      return res.json({ code: 400, msg: '两次密码不一致' });
    }

    // 验证验证码
    const verified = emailService.verifyCode(email, code);
    if (!verified.valid) {
      return res.json({ code: 400, msg: verified.msg });
    }

    // 检查邮箱是否已注册
    const existing = query.get('users', { email });
    if (existing) {
      return res.json({ code: 400, msg: '该邮箱已被注册' });
    }

    // 生成系统账号
    const account = generateAccountNumber();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const displayName = nickname || email.split('@')[0];

    const result = query.insert('users', {
      account,
      email,
      password: hashedPassword,
      nickname: displayName,
      balance: 1000,
      created_at: new Date().toISOString()
    });

    const token = jwt.sign(
      { id: result.id, account, email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      code: 200,
      msg: '注册成功',
      data: {
        token,
        user: {
          id: result.id,
          account,
          email,
          nickname: displayName,
          balance: 1000
        }
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// ===== 登录（账号+密码） =====
router.post('/login', (req, res) => {
  try {
    const { account, password } = req.body;

    if (!account || !password) {
      return res.json({ code: 400, msg: '请输入账号和密码' });
    }

    // 支持用账号或邮箱登录
    const user = query.get('users', { account }) || query.get('users', { email: account });

    if (!user) {
      return res.json({ code: 400, msg: '账号或密码错误' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.json({ code: 400, msg: '账号或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, account: user.account, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      code: 200,
      msg: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          account: user.account,
          email: user.email,
          nickname: user.nickname,
          balance: user.balance
        }
      }
    });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误: ' + err.message });
  }
});

// ===== 获取用户信息 =====
router.get('/userinfo', authenticateToken, (req, res) => {
  try {
    const user = query.get('users', { id: req.user.id });
    if (!user) return res.json({ code: 404, msg: '用户不存在' });

    const { password, ...safeUser } = user;
    res.json({ code: 200, data: safeUser });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.json({ code: 401, msg: '请先登录' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.json({ code: 403, msg: '登录已过期，请重新登录' });
    req.user = user;
    next();
  });
}

module.exports = { router, authenticateToken, JWT_SECRET };
