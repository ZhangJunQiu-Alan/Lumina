import { isAuthApiError } from '@supabase/supabase-js';

export interface AuthErrorCopy {
  text: string;
  hint?: string;
}

function matchByMessage(raw: string): AuthErrorCopy | null {
  const lower = raw.toLowerCase();

  if (lower.includes('invalid') && lower.includes('email')) {
    return { text: '邮箱格式无效', hint: '请检查邮箱地址是否完整，例如 name@example.com。' };
  }
  if (lower.includes('already') && (lower.includes('registered') || lower.includes('exists'))) {
    return { text: '邮箱已注册', hint: '直接登录，或用"忘记密码"找回。' };
  }
  if (
    lower.includes('password') &&
    (lower.includes('short') || lower.includes('weak') || lower.includes('6 characters'))
  ) {
    return { text: '密码未达到要求', hint: '至少 8 位，尽量混合字母和数字。' };
  }
  if (lower.includes('rate') && lower.includes('limit')) {
    return { text: '尝试次数过多', hint: '请稍后重试。' };
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return { text: '邮箱或密码错误', hint: '请检查邮箱和密码，或选择“忘记密码”。' };
  }
  if (lower.includes('email not confirmed')) {
    return { text: '邮箱尚未验证', hint: '请通过确认邮件验证邮箱后登录。' };
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return { text: '网络连接失败', hint: '请检查网络连接后重试。' };
  }

  return null;
}

export function describeAuthError(error: unknown): AuthErrorCopy {
  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'email_address_invalid':
        return { text: '邮箱格式无效', hint: '请检查邮箱地址是否完整，例如 name@example.com。' };
      case 'user_already_exists':
      case 'email_exists':
      case 'user_already_registered':
        return { text: '邮箱已注册', hint: '直接登录，或用"忘记密码"找回。' };
      case 'weak_password':
        return { text: '密码未达到要求', hint: '至少 8 位，尽量混合字母和数字。' };
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return { text: '尝试次数过多', hint: '请稍后重试。' };
      case 'invalid_credentials':
        return { text: '邮箱或密码错误', hint: '请检查邮箱和密码，或选择“忘记密码”。' };
      case 'email_not_confirmed':
        return { text: '邮箱尚未验证', hint: '请通过确认邮件验证邮箱后登录。' };
      case 'signup_disabled':
        return { text: '注册暂不可用', hint: '请稍后重试，或联系支持。' };
      default:
        break;
    }
  }

  if (error instanceof Error) {
    const matched = matchByMessage(error.message);
    if (matched) return matched;
  }

  return { text: '账号操作失败，请重试。' };
}

export function formatAuthErrorFeedback(error: unknown): string {
  const { text, hint } = describeAuthError(error);
  return hint ? `${text}。${hint}` : text;
}
