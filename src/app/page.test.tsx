import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LocaleProvider } from "@/components/LocaleProvider";
import Page from "../app/page";

test("Page", () => {
  // Page 通过 useT() 消费 LocaleContext，渲染时必须包在 LocaleProvider 内，
  // 与真实应用（layout.tsx）一致。
  render(
    <LocaleProvider>
      <Page />
    </LocaleProvider>,
  );
  expect(screen.getByRole("main")).toBeDefined();
});
