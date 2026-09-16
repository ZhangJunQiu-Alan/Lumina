import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { AuthView } from './AuthView';

type MockButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  icon?: ReactNode;
  block?: boolean;
  danger?: boolean;
  size?: unknown;
  type?: unknown;
};

type MockCardProps = HTMLAttributes<HTMLDivElement> & {
  color?: unknown;
};

vi.mock('animal-island-ui', () => ({
  Button: ({
    children,
    htmlType = 'button',
    icon,
    block: _block,
    danger: _danger,
    size: _size,
    type: _type,
    ...props
  }: MockButtonProps) => (
    <button {...props} type={htmlType as 'button' | 'submit' | 'reset'}>
      {icon}
      {children}
    </button>
  ),
  Card: ({ children, color: _color, ...props }: MockCardProps) => <div {...props}>{children}</div>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

const authMock = vi.hoisted(() => ({
  value: {
    session: null,
    user: null,
    isAuthenticated: false,
    isAuthLoading: false,
    isPasswordRecovery: false,
    signInWithGoogle: vi.fn(),
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    resendSignupConfirmation: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authMock.value,
}));

function resetAuthMock() {
  authMock.value = {
    session: null,
    user: null,
    isAuthenticated: false,
    isAuthLoading: false,
    isPasswordRecovery: false,
    signInWithGoogle: vi.fn(),
    signInWithPassword: vi.fn(),
    signUpWithPassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    resendSignupConfirmation: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderAuthView(entry = '/auth') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/auth" element={<AuthView />} />
        <Route path="/" element={<div>Landing</div>} />
        <Route path="/app/home" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthView URL mode', () => {
  beforeEach(() => {
    resetAuthMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the register form on the initial /auth?mode=register paint', () => {
    renderAuthView('/auth?mode=register');

    expect(screen.getByRole('tab', { name: '注册' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('昵称')).toBeInTheDocument();
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建账号/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '用邮箱登录' })).not.toBeInTheDocument();
  });

  it('lets password recovery markers override the requested auth mode on the initial paint', () => {
    renderAuthView('/auth?mode=register&type=recovery');

    expect(screen.getByLabelText('新密码')).toBeInTheDocument();
    expect(screen.getByLabelText('确认新密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /更新密码并继续/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('昵称')).not.toBeInTheDocument();
  });
});
