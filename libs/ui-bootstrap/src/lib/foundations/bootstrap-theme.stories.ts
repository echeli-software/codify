import type { Meta, StoryObj } from '@storybook/angular';

/**
 * Bootstrap's compiled `$primary`-based classes rendered through the
 * ui-bootstrap theme bridge (src/scss/bootstrap.scss). The Storybook
 * test-runner runs axe on this story in the light AND dark theme, so it is
 * the contrast check that these classes follow `theme-dark`.
 */
const meta: Meta = {
  title: 'Foundations/Bootstrap Theme',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

export const PrimaryClasses: Story = {
  render: () => ({
    template: `
      <div class="d-flex flex-column gap-3" style="max-width: 640px">
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary">Primary</button>
          <button type="button" class="btn btn-outline-primary">Outline</button>
          <button type="button" class="btn btn-link">Link button</button>
          <button type="button" class="btn btn-primary" disabled>Disabled</button>
        </div>

        <p class="mb-0">
          Body text with <a href="#bootstrap-theme">a default link</a>,
          a <a class="link-primary" href="#bootstrap-theme">.link-primary</a>
          link and <span class="text-primary">.text-primary</span> text.
        </p>

        <div class="d-flex flex-wrap gap-2 align-items-center">
          <span class="badge text-bg-primary">text-bg-primary</span>
          <span class="badge rounded-pill text-bg-primary">pill</span>
          <span class="p-2 bg-primary-subtle text-primary-emphasis rounded">
            bg-primary-subtle / text-primary-emphasis
          </span>
          <span class="p-2 border border-primary rounded">border-primary</span>
        </div>

        <div class="alert alert-primary mb-0" role="status">
          An <strong>alert-primary</strong> with an
          <a href="#bootstrap-theme" class="alert-link">alert link</a>.
        </div>

        <ul class="nav nav-pills" aria-label="Pills">
          <li class="nav-item">
            <a class="nav-link active" aria-current="page" href="#bootstrap-theme">Active</a>
          </li>
          <li class="nav-item"><a class="nav-link" href="#bootstrap-theme">Pill</a></li>
        </ul>

        <nav aria-label="Pagination">
          <ul class="pagination mb-0">
            <li class="page-item"><a class="page-link" href="#bootstrap-theme">1</a></li>
            <li class="page-item active" aria-current="page">
              <span class="page-link">2</span>
            </li>
            <li class="page-item"><a class="page-link" href="#bootstrap-theme">3</a></li>
          </ul>
        </nav>

        <div class="progress" role="progressbar" aria-label="Progress" aria-valuenow="60"
             aria-valuemin="0" aria-valuemax="100" style="height: 1.25rem">
          <div class="progress-bar" style="width: 60%">60%</div>
        </div>

        <div class="list-group">
          <button type="button" class="list-group-item list-group-item-action active" aria-current="true">
            Active list item
          </button>
          <button type="button" class="list-group-item list-group-item-action">List item</button>
        </div>

        <ul class="dropdown-menu show position-static" aria-label="Dropdown">
          <li><a class="dropdown-item active" href="#bootstrap-theme">Active item</a></li>
          <li><a class="dropdown-item" href="#bootstrap-theme">Item</a></li>
        </ul>

        <div class="d-flex flex-wrap gap-3">
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="bt-check" checked />
            <label class="form-check-label" for="bt-check">Checked</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" id="bt-radio" checked />
            <label class="form-check-label" for="bt-radio">Radio</label>
          </div>
          <div class="form-check form-switch">
            <input class="form-check-input" type="checkbox" role="switch" id="bt-switch" checked />
            <label class="form-check-label" for="bt-switch">Switch</label>
          </div>
        </div>
      </div>
    `,
  }),
};
