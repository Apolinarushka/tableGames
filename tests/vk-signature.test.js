const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

process.env.VK_APP_ID = "12345678";
process.env.VK_APP_SECRET = "local-test-secret";
const {verifyVkLaunchParams} = require("../online-server");

function signedLaunchParams(overrides = {}) {
  const values = {
    vk_access_token_settings: "",
    vk_app_id: process.env.VK_APP_ID,
    vk_are_notifications_enabled: "0",
    vk_is_app_user: "1",
    vk_language: "ru",
    vk_platform: "desktop_web",
    vk_ref: "other",
    vk_ts: "1785866400",
    vk_user_id: "100000001",
    ...overrides
  };
  const ordered = Object.entries(values).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const query = new URLSearchParams(ordered).toString();
  const sign = crypto.createHmac("sha256", process.env.VK_APP_SECRET)
    .update(query)
    .digest("base64url");
  return `${query}&sign=${encodeURIComponent(sign)}`;
}

test("принимает корректно подписанный запуск VK", () => {
  assert.deepEqual(verifyVkLaunchParams(signedLaunchParams()), {
    appId: "12345678",
    userId: "100000001"
  });
});

test("отклоняет изменённый VK user id", () => {
  const valid = signedLaunchParams();
  const modified = valid.replace("vk_user_id=100000001", "vk_user_id=100000002");
  assert.throws(() => verifyVkLaunchParams(modified), /vk_signature_invalid/);
});

test("отклоняет запуск другого приложения", () => {
  assert.throws(
    () => verifyVkLaunchParams(signedLaunchParams({vk_app_id: "87654321"})),
    /vk_launch_params_invalid/
  );
});
