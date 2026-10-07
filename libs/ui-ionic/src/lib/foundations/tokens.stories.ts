import type { Meta, StoryObj } from '@storybook/angular';
import { TokensPage } from '../../../../../tools/storybook/tokens-page';

/** docs/03 ui-tokens "Storybook page documenting every token group". */
const meta: Meta<TokensPage> = {
  title: 'Foundations/Tokens',
  component: TokensPage,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<TokensPage>;

export const AllTokens: Story = { args: { groups: null } };
export const Color: Story = { args: { groups: ['color'] } };
export const Spacing: Story = { args: { groups: ['space'] } };
export const Typography: Story = {
  args: { groups: ['font-size', 'font-weight', 'line-height', 'font-family'] },
};
export const Radius: Story = { args: { groups: ['radius'] } };
export const Shadow: Story = { args: { groups: ['shadow'] } };
export const Motion: Story = { args: { groups: ['motion'] } };
export const BreakpointsAndZ: Story = { args: { groups: ['breakpoint', 'z'] } };
