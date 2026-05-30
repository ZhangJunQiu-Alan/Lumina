import { isAuthApiError } from '@supabase/supabase-js';

export interface AuthErrorCopy {
  text: string;
  hint?: string;
}

function matchByMessage(raw: string): AuthErrorCopy | null {
  const lower = raw.toLowerCase();

  if (lower.includes('invalid') && lower.includes('email')) {
    return { text: '这个邮箱格式我们识别不了', hint: '换个常见邮箱（Gmail/Outlook/QQ）再试一次。' };
  }
  if (lower.includes('already') && (lower.includes('registered') || lower.includes('exists'))) {
    return { text: '这个邮箱已经注册过了', hint: '直接登录，或用"忘记密码"找回。' };
  }
  if (
    lower.includes('password') &&
    (lower.includes('short') || lower.includes('weak') || lower.includes('6 characters'))
  ) {
    return { text: '密码再强一点更安全', hint: '至少 8 位，尽量混合字母和数字。' };
  }
  if (lower.includes('rate') && lower.includes('limit')) {
    return { text: '短时间内尝试太多次了', hint: '等 1 分钟再试。' };
  }
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return { text: '邮箱或密码不对', hint: '确认没打错大小写，或用"忘记密码"。' };
  }
  if (lower.includes('email not confirmed')) {
    return { text: '邮箱还没确认', hint: '去邮箱收一下确认信，再回来登录。' };
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return { text: '网络没接通', hint: '检查一下网络再试，或稍后再来。' };
  }

  return null;
}

export function describeAuthError(error: unknown): AuthErrorCopy {
  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'email_address_invalid':
        return { text: '这个邮箱格式我们识别不了', hint: '换个常见邮箱（Gmail/Outlook/QQ）再试一次。' };
      case 'user_already_exists':
      case 'email_exists':
      case 'user_already_registered':
        return { text: '这个邮箱已经注册过了', hint: '直接登录，或用"忘记密码"找回。' };
      case 'weak_password':
        return { text: '密码再强一点更安全', hint: '至少 8 位，尽量混合字母和数字。' };
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return { text: '短时间内尝试太多次了', hint: '等 1 分钟再试。' };
      case 'invalid_credentials':
        return { text: '邮箱或密码不对', hint: '确认没打错大小写，或用"忘记密码"。' };
      case 'email_not_confirmed':
        return { text: '邮箱还没确认', hint: '去邮箱收一下确认信，再回来登录。' };
      case 'signup_disabled':
        return { text: '注册入口暂时关了', hint: '过一会儿再试，或联系支持。' };
      default:
        break;
    }
  }

  if (error instanceof Error) {
    const matched = matchByMessage(error.message);
    if (matched) return matched;
  }

  return { text: '这次没有接上账号，再试一次看看。' };
}

export function formatAuthErrorFeedback(error: unknown): string {
  const { text, hint } = describeAuthError(error);
  return hint ? `${text}。${hint}` : text;
}
