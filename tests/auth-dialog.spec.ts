import { test, expect } from "@playwright/test";

test("account dialog stays on the lesson page and supports eight-character registration and recovery", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://cognito-idp.eu-north-1.amazonaws.com/**", async (route) => {
    const target = route.request().headers()["x-amz-target"]?.split(".").pop() ?? "";
    requests.push(target);
    await route.fulfill({ status: 200, contentType: "application/x-amz-json-1.1", body: JSON.stringify(
      target === "SignUp" ? { UserConfirmed: false, UserSub: "test-user", CodeDeliveryDetails: { Destination: "t***@example.com", DeliveryMedium: "EMAIL", AttributeName: "email" } }
      : target === "ForgotPassword" ? { CodeDeliveryDetails: { Destination: "t***@example.com", DeliveryMedium: "EMAIL", AttributeName: "email" } } : {}) });
  });
  await page.goto("/?role=teacher");
  await page.evaluate(async () => {
    // Mount the real dialog with the real SDK; only the external Cognito HTTP
    // responses are simulated, so this never registers a real account.
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { Amplify } = await import("/node_modules/.vite/deps/aws-amplify.js");
    const { AuthDialog } = await import("/src/auth/AuthDialog.tsx");
    Amplify.configure({ Auth: { Cognito: { userPoolId: "eu-north-1_TestPool", userPoolClientId: "testclient" } } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); root.render(React.createElement(AuthDialog, { onClose: () => root.unmount() }));
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Email", { exact: true }).fill("test@example.com");
  await dialog.getByLabel("Password", { exact: true }).fill("abcdefg");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  expect(requests).toEqual([]);
  await dialog.getByLabel("Password", { exact: true }).fill("abcdefgh");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Check your email");
  await dialog.getByLabel("Email verification code").fill("123456");
  await dialog.getByRole("button", { name: "Verify email" }).click();
  await expect(dialog.getByRole("status")).toContainText("Email verified");
  await dialog.getByRole("button", { name: "Forgot password?" }).click();
  await dialog.getByRole("button", { name: "Send reset code" }).click();
  await dialog.getByLabel("Email verification code").fill("123456");
  await dialog.getByLabel("Password", { exact: true }).fill("ijklmnop");
  await dialog.getByRole("button", { name: "Save password" }).click();
  await expect(dialog.getByRole("status")).toContainText("Password updated");
  expect(requests).toEqual(["SignUp", "ConfirmSignUp", "ForgotPassword", "ConfirmForgotPassword"]);
  await expect(page).toHaveURL(/\/?\?role=teacher$/);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
