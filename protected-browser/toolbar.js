'use strict';

const address = document.getElementById('address');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const form = document.getElementById('address-form');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const result = await window.browser.navigate(address.value);
  if (result && result.error) address.title = result.error;
  else address.title = '';
});
back.addEventListener('click', () => void window.browser.back());
forward.addEventListener('click', () => void window.browser.forward());
document.getElementById('reload').addEventListener('click', () => void window.browser.reload());
document.getElementById('home').addEventListener('click', () => void window.browser.home());
window.browser.onState(state => {
  if (document.activeElement !== address && state.url) address.value = state.url;
  back.disabled = !state.canGoBack;
  forward.disabled = !state.canGoForward;
});
window.browser.onFocusAddress(() => { address.focus(); address.select(); });
