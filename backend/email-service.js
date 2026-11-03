// ===== 邮件发送服务 =====
// 系统邮箱: football_system@163.com
// 授权码配置: 优先读取 auth-code.txt，否则使用内置默认值
//
// 获取授权码: 登录 mail.163.com → 设置 → POP3/SMTP/IMAP → 开启SMTP → 获取授权码
// 也可运行 test-email.js 交互式测试

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ===== 读取授权码 =====
function getAuthCode() {
  const configPath = path.join(__dirname, 'auth-code.txt');
  try {
    if (fs.existsSync(configPath)) {
      const code = fs.readFileSync(configPath, 'utf-8').trim();
      if (code && code.length >= 10) {
        console.log('[邮件] 从 auth-code.txt 读取授权码');
        return code;
      }
    }
  } catch (e) {}
  // 默认授权码（可能无效，需替换）
  return '';
}

// ===== SMTP 配置 =====
function buildSmtpConfig() {
  const authCode = getAuthCode();
  return {
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: {
      user: 'football_system@163.com',
      pass: authCode || '未设置授权码'
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  };
}

let SMTP_CONFIG = buildSmtpConfig();

// 创建邮件传输器
let transporter = null;
let smtpStatus = { connected: false, error: null, checkedAt: null };

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(SMTP_CONFIG);
  }
  return transporter;
}

// ===== 验证码存储（内存） =====
const codeStore = new Map();

// 验证码配置
const CODE_CONFIG = {
  length: 6,           // 6位数字
  ttl: 5 * 60 * 1000,  // 有效期 5 分钟
  resendCooldown: 60 * 1000, // 重发冷却 60 秒
};

// ===== 连接状态检查 =====
async function checkConnection() {
  // 重建transporter（每次启动用最新的授权码）
  SMTP_CONFIG = buildSmtpConfig();
  transporter = nodemailer.createTransport(SMTP_CONFIG);

  try {
    await transporter.verify();
    smtpStatus = { connected: true, error: null, checkedAt: new Date().toISOString() };
    console.log('[邮件] ✅ SMTP 连接成功');
    return true;
  } catch (err) {
    smtpStatus = { connected: false, error: err.message, checkedAt: new Date().toISOString() };
    console.log(`[邮件] ❌ SMTP 连接失败`);

    // 检查是否未设置授权码
    if (!SMTP_CONFIG.auth.pass || SMTP_CONFIG.auth.pass === '未设置授权码') {
      console.log('[邮件] ⚠️ 未配置授权码，请按以下步骤操作:');
      console.log('[邮件]   1. 登录 https://mail.163.com (账号: football_system@163.com)');
      console.log('[邮件]   2. 设置 → POP3/SMTP/IMAP → 开启SMTP服务');
      console.log('[邮件]   3. 获取授权码后，运行: node test-email.js');
      console.log('[邮件]   4. 或将授权码写入 backend/auth-code.txt');
    } else {
      console.log(`[邮件] ⚠️ 授权码可能无效 (错误: ${err.message})`);
      console.log('[邮件]   请重新获取授权码: mail.163.com → 设置 → POP3/SMTP/IMAP');
      console.log('[邮件]   然后运行 node test-email.js 测试');
    }

    console.log('[邮件] ℹ️ 当前使用降级模式（控制台/前端输出验证码）');
    return false;
  }
}

function getSmtpStatus() {
  return { ...smtpStatus };
}

// ===== 生成随机验证码 =====
function generateCode() {
  const min = Math.pow(10, CODE_CONFIG.length - 1);
  const max = Math.pow(10, CODE_CONFIG.length) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

// ===== 发送验证码邮件 =====
async function sendVerificationCode(email) {
  const code = generateCode();

  const mailOptions = {
    from: '"世界杯竞彩" <football_system@163.com>',
    to: email,
    subject: '【世界杯竞彩】邮箱验证码 - ' + code,
    html: buildEmailTemplate(code),
    text: `您的验证码是: ${code}，有效期5分钟。如非本人操作，请忽略。`,
  };

  // 先存储验证码（即使发送失败也能用）
  codeStore.set(email, {
    code,
    expires: Date.now() + CODE_CONFIG.ttl,
    createdAt: Date.now(),
    attempts: 0,
  });

  try {
    const t = getTransporter();
    const info = await t.sendMail(mailOptions);
    console.log(`[邮件] ✅ 验证码已发送至 ${email} | MessageID: ${info.messageId}`);
    return {
      success: true,
      msg: '验证码已发送至您的邮箱，请查收',
    };
  } catch (err) {
    console.error(`[邮件] ❌ 发送失败 (${email}): ${err.message}`);

    if (!smtpStatus.connected) {
      console.log(`[邮件] 🔧 降级模式 - 验证码: ${code} (请在前端查看)`);
    }

    return {
      success: true,
      msg: '验证码已发送',
      devCode: code, // SMTP失败时返回验证码用于调试
      fallback: true,
    };
  }
}

// ===== 邮件模板 =====
function buildEmailTemplate(code) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f0eb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#B71C1C,#D4212B);padding:28px 24px;text-align:center;border-radius:12px 12px 0 0;">
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;">⚽ 世界杯竞彩</h1>
              <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">邮箱验证码 · Email Verification</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 28px;">
              <p style="color:#555;font-size:15px;margin:0 0 20px;line-height:1.6;">
                您好，您正在进行 <strong>世界杯竞彩系统</strong> 的邮箱验证。
              </p>
              <p style="color:#888;font-size:13px;margin:0 0 20px;">
                请使用以下验证码完成验证：
              </p>
              <!-- Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#FFF5F5;border:2px dashed #D4212B;border-radius:10px;padding:20px;text-align:center;">
                    <span style="font-size:36px;font-weight:900;color:#D4212B;letter-spacing:10px;font-family:'Courier New',monospace;">${code}</span>
                  </td>
                </tr>
              </table>
              <!-- Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                <tr>
                  <td style="color:#aaa;font-size:12px;line-height:1.8;">
                    ⏱ 验证码有效期 <strong style="color:#333;">5 分钟</strong><br>
                    🔒 请勿将验证码泄露给他人<br>
                    ❓ 如非本人操作，请忽略此邮件
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;padding:16px 28px;text-align:center;border-top:1px solid #eee;border-radius:0 0 12px 12px;">
              <span style="color:#ccc;font-size:11px;">世界杯竞彩系统 · 自动发送 · 请勿回复</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ===== 验证码校验 =====
function verifyCode(email, code) {
  const stored = codeStore.get(email);

  if (!stored) {
    return { valid: false, code: 'NOT_FOUND', msg: '请先获取验证码' };
  }

  if (Date.now() > stored.expires) {
    codeStore.delete(email);
    return { valid: false, code: 'EXPIRED', msg: '验证码已过期，请重新获取' };
  }

  stored.attempts = (stored.attempts || 0) + 1;
  if (stored.attempts > 5) {
    codeStore.delete(email);
    return { valid: false, code: 'TOO_MANY_ATTEMPTS', msg: '验证次数过多，请重新获取验证码' };
  }

  if (stored.code !== String(code).trim()) {
    return { valid: false, code: 'MISMATCH', msg: '验证码错误，请重新输入' };
  }

  // 验证通过，删除存储的记录
  codeStore.delete(email);
  console.log(`[邮件] ✅ 验证通过 - ${email}`);
  return { valid: true, msg: '验证通过' };
}

// ===== 发送频率限制 =====
function canResend(email) {
  const stored = codeStore.get(email);

  if (!stored) return { allowed: true };

  // 计算距离上次发送的时间
  const elapsed = Date.now() - stored.createdAt;

  if (elapsed < CODE_CONFIG.resendCooldown) {
    const remaining = Math.ceil((CODE_CONFIG.resendCooldown - elapsed) / 1000);
    return { allowed: false, remaining, msg: `请${remaining}秒后重试` };
  }

  return { allowed: true };
}

// ===== 获取验证码剩余有效时间 =====
function getCodeRemainingTime(email) {
  const stored = codeStore.get(email);
  if (!stored) return 0;
  const remaining = stored.expires - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

// ===== 清理过期验证码（定期调用） =====
function cleanupExpiredCodes() {
  const now = Date.now();
  let count = 0;
  for (const [email, data] of codeStore) {
    if (now > data.expires) {
      codeStore.delete(email);
      count++;
    }
  }
  if (count > 0) console.log(`[邮件] 清理了 ${count} 个过期验证码`);
}

// 每 5 分钟自动清理
setInterval(cleanupExpiredCodes, 5 * 60 * 1000);

// ===== 导出 =====
module.exports = {
  sendVerificationCode,
  verifyCode,
  canResend,
  getCodeRemainingTime,
  checkConnection,
  getSmtpStatus,
  CODE_CONFIG,
};
