import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Button as AnimalButton, Card as AnimalCard, Input as AnimalInput } from 'animal-island-ui';
import { cx } from './LearningUI';

type IslandTone = 'primary' | 'mint' | 'yellow' | 'danger' | 'neutral' | 'ghost';
type IslandSize = 'small' | 'middle' | 'large';

interface IslandButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  htmlType?: ButtonHTMLAttributes<HTMLButtonElement>['type'];
  tone?: IslandTone;
  size?: IslandSize;
  block?: boolean;
  icon?: ReactNode;
}

export function IslandButton({
  htmlType = 'button',
  tone = 'primary',
  size = 'middle',
  block = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: IslandButtonProps) {
  const animalType = tone === 'ghost' ? 'text' : tone === 'neutral' ? 'default' : 'primary';

  return (
    <AnimalButton
      {...props}
      htmlType={htmlType}
      type={animalType}
      danger={tone === 'danger'}
      size={size}
      block={block}
      disabled={disabled}
      icon={icon}
      className={cx('lumina-island-button', `lumina-island-button--${tone}`, block && 'w-full', className)}
    >
      {children}
    </AnimalButton>
  );
}

interface IslandPanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'header';
  variant?: 'default' | 'elevated' | 'title' | 'dashed';
}

export function IslandPanel({
  as: Component = 'section',
  variant = 'default',
  className,
  children,
  ...props
}: IslandPanelProps) {
  return (
    <Component
      {...props}
      className={cx(
        'lumina-island-panel',
        `lumina-island-panel--${variant}`,
        variant === 'elevated' && 'glass-elevated',
        variant === 'default' && 'glass',
        className,
      )}
    >
      {children}
    </Component>
  );
}

interface IslandCardProps extends HTMLAttributes<HTMLDivElement> {
  color?:
    | 'default'
    | 'app-blue'
    | 'app-yellow'
    | 'app-orange'
    | 'app-teal'
    | 'app-green'
    | 'app-red'
    | 'warm-peach-pink';
}

export function IslandCard({ color = 'default', className, children, ...props }: IslandCardProps) {
  return (
    <AnimalCard {...props} color={color} className={cx('lumina-island-card', className)}>
      {children}
    </AnimalCard>
  );
}

interface IslandInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: IslandSize;
  prefix?: ReactNode;
  suffix?: ReactNode;
  allowClear?: boolean;
  onClear?: () => void;
  status?: 'error' | 'warning';
}

export function IslandInput({ className, ...props }: IslandInputProps) {
  return <AnimalInput {...props} className={cx('lumina-island-input', className)} />;
}

interface IslandBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: IslandTone | 'green' | 'orange' | 'blue' | 'red';
}

export function IslandBadge({ tone = 'neutral', className, children, ...props }: IslandBadgeProps) {
  return (
    <span {...props} className={cx('lumina-island-badge', `lumina-island-badge--${tone}`, className)}>
      {children}
    </span>
  );
}

export function IslandIconButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} type={props.type ?? 'button'} className={cx('lumina-island-icon-button', className)}>
      {children}
    </button>
  );
}

export function IslandModalShell({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('lumina-island-modal-shell', className)}>
      {children}
    </div>
  );
}
