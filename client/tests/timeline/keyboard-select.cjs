const assert = require("node:assert/strict");

/** 按真实组合框的方向键和回车交互选择，不依赖组件未实现的Home／End行为。 */
exports.selectWithKeyboard = async (page, picker, label) => {
  await picker.focus(); await picker.press("Enter");
  const active = page.locator(".ant-select-dropdown:visible .ant-select-item-option-active .ant-select-item-option-content").last();
  await active.waitFor();
  for (let index = 0; index < 16; index++) {
    if ((await active.innerText()).trim() === label) { await picker.press("Enter"); return; }
    await picker.press("ArrowDown");
  }
  assert.fail("键盘未能激活目标轨道：" + label);
};
