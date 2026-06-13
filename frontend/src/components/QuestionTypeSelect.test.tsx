import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionTypeSelect } from './QuestionTypeSelect';

describe('QuestionTypeSelect', () => {
  it('shows All when every type is selected and closes on outside click', () => {
    const onChange = vi.fn();
    render(
      <div>
        <QuestionTypeSelect
          value={['multiple_choice', 'true_false', 'multi_select', 'free_text']}
          onChange={onChange}
        />
        <button>outside</button>
      </div>
    );

    fireEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(screen.getByText('Free Text')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByText('Free Text')).not.toBeInTheDocument();
  });

  it('does not allow removing the last selected type', () => {
    const onChange = vi.fn();
    render(
      <QuestionTypeSelect
        value={['multiple_choice']}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /multiple choice/i }));
    fireEvent.click(screen.getByLabelText('Multiple Choice'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
