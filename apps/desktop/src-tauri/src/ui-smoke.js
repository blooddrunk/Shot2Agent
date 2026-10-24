/* global document */
(() => {
  const shell = document.querySelector('.app-shell[data-backend-ready="true"]');
  const visible = (element) => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const buttons = [...document.querySelectorAll('button')];
  return visible(shell) && ['截取所选显示器', '输入剪贴板文本'].every((label) => {
    const button = buttons.find((item) => item.textContent.trim() === label);
    return visible(button) && !button.disabled;
  });
})()
