const text = (value = '') => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function mountAccount(root, { api, icon }) {
  let user = null;
  let mode = 'login';
  let available = true;
  let active = true;

  function render(message = '') {
    if (!active) return;
    if (user) {
      root.innerHTML = '<div class="lab-account-summary"><span class="lab-record-icon">' + icon('user-round') +
        '</span><div>' + (user.name ? '<strong>' + text(user.name) + '</strong>' : '') + '<p>' + text(user.email) +
        '</p></div><button class="lab-secondary" type="button" data-account-action="logout">' + icon('log-out') + '退出登录</button></div>' +
        '<p class="lab-form-feedback" role="status" data-account-feedback></p>';
    } else {
      const register = mode === 'register';
      root.innerHTML = '<div class="lab-segments" role="group" aria-label="账号操作"><button type="button" data-account-action="login" aria-pressed="' +
        String(!register) + '">登录</button><button type="button" data-account-action="register" aria-pressed="' + String(register) +
        '">注册</button></div><form class="lab-account-form">' +
        (register ? '<label>昵称（选填）<input name="name" autocomplete="nickname" maxlength="60"></label>' : '') +
        '<label>邮箱<input name="email" type="email" autocomplete="username" required maxlength="254"></label>' +
        '<label>密码<input name="password" type="password" required minlength="6" maxlength="72" autocomplete="' +
        (register ? 'new-password' : 'current-password') + '"' +
        (register ? ' placeholder="至少 6 位"' : '') + '></label>' +
        '<div class="lab-form-actions"><button class="lab-primary" type="submit">' +
        icon(register ? 'user-round-plus' : 'log-in') + (register ? '注册并登录' : '邮箱登录') + '</button></div>' +
        '<p class="lab-form-feedback" role="status" data-account-feedback></p></form>';
    }
    feedback(message);
  }

  function feedback(message) {
    const line = root.querySelector('[data-account-feedback]');
    if (line) line.textContent = message;
  }

  function showError(error) {
    available = error.status !== 404;
    if (active) feedback(available ? error.message : '当前预览尚未连接团队的邮箱登录服务');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const inputs = form.querySelectorAll('input');
    const payload = Object.fromEntries(new FormData(form));
    button.disabled = true;
    inputs.forEach(input => { input.readOnly = true; });
    feedback(mode === 'register' ? '正在注册…' : '正在登录…');
    try {
      const reply = await api('auth/' + mode, 'POST', payload);
      user = reply.user;
      render('已登录');
    } catch (error) {
      showError(error);
    } finally {
      form.querySelector('[name="password"]').value = '';
      inputs.forEach(input => { input.readOnly = false; });
      button.disabled = false;
    }
  }

  async function handleClick(event) {
    const button = event.target.closest('[data-account-action]');
    if (!button) return;
    const action = button.dataset.accountAction;
    if (action !== 'logout') {
      if (root.querySelector('button[type="submit"]')?.disabled || mode === action) return;
      const email = root.querySelector('[name="email"]')?.value;
      mode = action;
      render(available ? '' : '当前预览尚未连接团队的邮箱登录服务');
      if (email) root.querySelector('[name="email"]').value = email;
      root.querySelector('[data-account-action="' + mode + '"]')?.focus();
      return;
    }
    button.disabled = true;
    try {
      await api('auth/logout', 'POST');
      user = null;
      mode = 'login';
      render('已退出登录');
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('submit', handleSubmit);
  root.textContent = '正在读取登录状态…';
  api('auth/me').then(reply => {
    user = reply.user;
    render();
  }).catch(error => {
    render();
    showError(error);
  });
  return () => {
    active = false;
    root.removeEventListener('click', handleClick);
    root.removeEventListener('submit', handleSubmit);
  };
}
