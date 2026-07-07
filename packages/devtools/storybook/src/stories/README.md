# Shared UI Storybook

This Storybook instance is configured to use components from the `../shared-ui` package.

## Directory Structure

Stories can be placed in either:

- This directory (`src/stories/`) for example and demo stories
- Directly alongside your components in the `shared-ui/src` package for component-specific stories

Both locations are configured in `.storybook/main.ts`.

## Creating Stories

### For React Components

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { YourComponent } from "@shared-ui/path/to/component";

const meta = {
  title: "Category/ComponentName",
  component: YourComponent,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof YourComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    // your props here
  },
};
```

### For VSCode Web Components

Since VSCode Elements are web components, you'll need to create wrapper components:

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import "@shared-ui/components"; // This imports VSCode Elements

const ButtonExample = ({ label }: { label: string }) => (
  <vscode-button>{label}</vscode-button>
);

const meta = {
  title: "VSCode/Button",
  component: ButtonExample,
} satisfies Meta<typeof ButtonExample>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    label: "Click me",
  },
};
```

## Available Imports

- `@shared-ui/*` - Path alias to `../shared-ui/src/*`
- All shared-ui components and utilities are available for import

## Running Storybook

```bash
pnpm storybook
```

This will start Storybook on port 6006.

## Building Storybook

```bash
pnpm build-storybook
```

This will build a static version of Storybook.
