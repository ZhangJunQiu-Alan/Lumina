import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ClozePrompt } from '../../lib/cloze';
import { Round2ClozePrompt } from './Round2ClozePrompt';

const prompt: ClozePrompt = {
  blankedSentence: 'Good teams _____ scarce resources carefully.',
  translation: '优秀团队会谨慎分配稀缺资源。',
  expectedForm: 'allocate',
  baseForm: 'allocate',
  formLabel: '原型',
  senseIndex: 0,
};

describe('Round2ClozePrompt', () => {
  it('shows the cloze sentence, typed progress, form hint, and translation', () => {
    render(<Round2ClozePrompt prompt={prompt} inputValue="allo" phonetic="/ˈæləkeɪt/" />);

    expect(screen.getByText('根据语境复现单词')).toBeInTheDocument();
    expect(screen.getByLabelText('当前词音标')).toHaveTextContent('/ˈæləkeɪt/');
    expect(screen.getByText('Good teams')).toBeInTheDocument();
    expect(screen.getByText('scarce resources carefully.')).toBeInTheDocument();
    expect(screen.getByLabelText('blank')).toHaveTextContent('allo____');
    expect(screen.getByText('原型')).toBeInTheDocument();
    expect(screen.getByText('优秀团队会谨慎分配稀缺资源。')).toBeInTheDocument();
  });

  it('lets the user play the full sentence only when audio is available', async () => {
    const user = userEvent.setup();
    const onPlaySentence = vi.fn();
    const { rerender } = render(
      <Round2ClozePrompt prompt={prompt} inputValue="" onPlaySentence={onPlaySentence} canPlaySentenceAudio={false} />,
    );

    const disabledButton = screen.getByRole('button', { name: '播放完整例句' });
    expect(disabledButton).toBeDisabled();
    await user.click(disabledButton);
    expect(onPlaySentence).not.toHaveBeenCalled();

    rerender(<Round2ClozePrompt prompt={prompt} inputValue="" onPlaySentence={onPlaySentence} canPlaySentenceAudio />);

    await user.click(screen.getByRole('button', { name: '播放完整例句' }));
    expect(onPlaySentence).toHaveBeenCalledTimes(1);
  });
});
