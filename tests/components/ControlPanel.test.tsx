// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ControlPanel from "@/components/ControlPanel";
import type { FilterState } from "@/lib/types";

const defaultFilter: FilterState = { maxDepth: 10, minScore: 0 };

function renderPanel(overrides: Partial<Parameters<typeof ControlPanel>[0]> = {}) {
  const onFilterChange = vi.fn();
  const result = render(
    <ControlPanel
      filter={defaultFilter}
      onFilterChange={onFilterChange}
      maxAvailableDepth={20}
      totalNodes={150}
      visibleNodes={120}
      {...overrides}
    />
  );
  return { ...result, onFilterChange };
}

describe("ControlPanel", () => {
  it("renders depth slider with correct value", () => {
    renderPanel();
    const slider = screen.getByLabelText(/max depth/i);
    expect(slider).toBeDefined();
    expect((slider as HTMLInputElement).value).toBe("10");
  });

  it("renders score slider with correct value", () => {
    renderPanel();
    const slider = screen.getByLabelText(/min score/i);
    expect(slider).toBeDefined();
    expect((slider as HTMLInputElement).value).toBe("0");
  });

  it("calls onFilterChange when depth slider changes", () => {
    const { onFilterChange } = renderPanel();
    const slider = screen.getByLabelText(/max depth/i);

    fireEvent.change(slider, { target: { value: "5" } });

    expect(onFilterChange).toHaveBeenCalledWith({ maxDepth: 5, minScore: 0 });
  });

  it("calls onFilterChange when score slider changes", () => {
    const { onFilterChange } = renderPanel();
    const slider = screen.getByLabelText(/min score/i);

    fireEvent.change(slider, { target: { value: "25" } });

    expect(onFilterChange).toHaveBeenCalledWith({ maxDepth: 10, minScore: 25 });
  });

  it("displays node count summary", () => {
    renderPanel({ totalNodes: 500, visibleNodes: 350 });
    expect(screen.getByText("350")).toBeDefined();
    expect(screen.getByText(/of 500 comments/)).toBeDefined();
  });

  it("renders sentiment color legend with all three categories", () => {
    renderPanel();
    expect(screen.getByText("Positive")).toBeDefined();
    expect(screen.getByText("Neutral")).toBeDefined();
    expect(screen.getByText("Negative")).toBeDefined();
  });

  it("has accessible region role and label", () => {
    renderPanel();
    const panel = screen.getByRole("region", { name: /graph controls/i });
    expect(panel).toBeDefined();
  });

  it("depth slider respects maxAvailableDepth", () => {
    renderPanel({ maxAvailableDepth: 8 });
    const slider = screen.getByLabelText(/max depth/i) as HTMLInputElement;
    expect(slider.max).toBe("8");
  });
});
