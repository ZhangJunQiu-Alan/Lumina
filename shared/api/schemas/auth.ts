import { z } from 'zod';

export const SignInSchema = z.object({
  email: z.string().trim().min(1, '请输入邮箱和密码。'),
  password: z.string().min(1, '请输入邮箱和密码。'),
});

export const SignUpSchema = z.object({
  email: z.string().trim().email('请填写有效邮箱。'),
  password: z.string().min(8, '请填写有效邮箱和至少 8 位密码。'),
  fullName: z.string().trim().optional(),
});

export const UpdatePasswordSchema = z.object({
  password: z.string().min(8, '密码至少需要 8 位。'),
});

export const ResetPasswordSchema = z.object({
  email: z.string().trim().min(1, '请输入邮箱。'),
});

export type SignInInput = z.infer<typeof SignInSchema>;
export type SignUpInput = z.infer<typeof SignUpSchema>;
export type UpdatePasswordInput = z.infer<typeof UpdatePasswordSchema>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
