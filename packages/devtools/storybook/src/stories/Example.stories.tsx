import type { Meta, StoryObj } from "@storybook/react"

/**
 * Example story demonstrating the Storybook setup.
 *
 * This shows how to create stories that can use components from the shared-ui package.
 * Import components using the @shared-ui path alias.
 */

// Simple example component
const ExampleComponent = ({
  text,
  variant
}: {
  text: string
  variant?: "primary" | "secondary"
}) => {
  return (
    <div
      style={{
        padding: "20px",
        backgroundColor: variant === "primary" ? "#007acc" : "#5a5a5a",
        color: "white",
        borderRadius: "4px",
        fontFamily: "var(--vscode-font-family)"
      }}
    >
      {text}
    </div>
  )
}

const meta = {
  title: "Example/Basic Component",
  component: ExampleComponent,
  parameters: {
    layout: "centered"
  },
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary"]
    }
  }
} satisfies Meta<typeof ExampleComponent>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: {
    text: "This is a primary example",
    variant: "primary"
  }
}

export const Secondary: Story = {
  args: {
    text: "This is a secondary example",
    variant: "secondary"
  }
}
